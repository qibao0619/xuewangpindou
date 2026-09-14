/** 起本地服务器，逐个请求 sw.js 预缓存清单里的每一项，确认都能 200 拿到。
 *  离线可用性的前提就是这些文件必须全部可达。 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5188;

const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const child = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

let bad = 0;
console.log('=== 预缓存清单可达性（离线可用的前提）===');
for (const item of shell) {
  const url = 'http://127.0.0.1:' + PORT + '/' + item.replace(/^\.\//, '');
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const okType = res.headers.get('content-type') || '';
    const good = res.ok && buf.byteLength > 0;
    if (!good) bad++;
    console.log((good ? '  ✓ ' : '  ✗ ') + item.padEnd(34) + res.status + '  ' + okType.split(';')[0] + '  ' + buf.byteLength + 'B');
  } catch (e) {
    bad++;
    console.log('  ✗ ' + item.padEnd(34) + '请求失败: ' + e.message);
  }
}

// manifest 里声明的图标也必须可达
const mf = JSON.parse(readFileSync(resolve(ROOT, 'manifest.webmanifest'), 'utf8'));
console.log('\n=== manifest 图标可达性 ===');
for (const ic of mf.icons) {
  const url = 'http://127.0.0.1:' + PORT + '/' + ic.src.replace(/^\.\//, '');
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const good = res.ok && buf.byteLength > 0;
    if (!good) bad++;
    console.log((good ? '  ✓ ' : '  ✗ ') + ic.src.padEnd(34) + res.status + '  ' + buf.byteLength + 'B  ' + (ic.sizes || ''));
  } catch (e) {
    bad++;
    console.log('  ✗ ' + ic.src.padEnd(34) + '请求失败: ' + e.message);
  }
}

child.kill();
console.log('\n' + (bad ? '✗ ' + bad + ' 项不可达' : '✓ 全部可达，离线预缓存没问题'));
// 用 exitCode 而不是 process.exit()：避免 Windows 上 libuv 在句柄关闭途中被强杀而报 assertion
process.exitCode = bad ? 1 : 0;
