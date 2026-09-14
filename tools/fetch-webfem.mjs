/* 抓 webfem 的 MARD 色号表数据（构建期用，一次性）：
 *   node tools/fetch-webfem.mjs
 * 页面是客户端渲染的，色号数据一般在 JS 资源里，所以这里把页面和它引用的
 * 脚本/JSON 都下下来，逐个检查哪个文件里含色号-色值数据。 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/webfem');
mkdirSync(OUT, { recursive: true });

const PAGE = 'https://webfem.com/tools/pindou/mard-color-chart/';
const UA = 'Mozilla/5.0 (compatible; PindouStudio/1.0 data-import)';

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}

const html = await get(PAGE);
writeFileSync(resolve(OUT, 'page.html'), html);
console.log('页面 ' + html.length + ' 字符');

/* 资产清单 */
const assets = new Set();
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assets.add(m[1]);
for (const m of html.matchAll(/<link[^>]+href="([^"]+\.(?:js|json|mjs))"/g)) assets.add(m[1]);
for (const m of html.matchAll(/["'](\/[^"']*\.(?:js|json|mjs))["']/g)) assets.add(m[1]);
console.log('发现资源 ' + assets.size + ' 个');

const abs = (u) => (u.startsWith('http') ? u : new URL(u, PAGE).href);
const scored = [];
for (const a of assets) {
  const url = abs(a);
  try {
    const text = await get(url);
    const name = 'asset-' + a.replace(/[^\w.-]+/g, '_').slice(-70);
    writeFileSync(resolve(OUT, name), text);
    const hexes = text.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    const hasA1 = /["'>]A1["'<,:\s]/.test(text);
    const hasZG = /ZG1|"ZG"|'ZG'/.test(text);
    const hasMard = /mard/i.test(text);
    scored.push({ a, url, bytes: text.length, hexes: hexes.length, hasA1, hasZG, hasMard, name });
  } catch (err) {
    scored.push({ a, url, error: err.message });
  }
}

console.log('\n各资源里的色值数量（找数据文件）：');
scored.sort((x, y) => (y.hexes || 0) - (x.hexes || 0));
for (const s of scored) {
  if (s.error) { console.log('  ERR  ' + s.a + ' : ' + s.error); continue; }
  console.log(`  ${String(s.hexes).padStart(5)} 个 HEX  A1:${s.hasA1 ? 'Y' : 'n'} ZG:${s.hasZG ? 'Y' : 'n'} mard:${s.hasMard ? 'Y' : 'n'}  ${(s.bytes / 1024).toFixed(0)}KB  ${s.name}`);
}

/* 页面内联脚本里有没有直接嵌数据 */
const inline = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
console.log('\n内联脚本合计 ' + inline.length + ' 字符，其中 HEX 数量 ' + ((inline.match(/#[0-9A-Fa-f]{6}\b/g) || []).length));
const probe = html.indexOf('F9F0CD');
console.log('页面 HTML 里 F9F0CD（pixel-beads 的 A1）位置：' + (probe < 0 ? '未出现' : probe));
const probe2 = html.indexOf('FAF5CD');
console.log('页面 HTML 里 FAF5CD（公开汇总版的 A1）位置：' + (probe2 < 0 ? '未出现' : probe2));
