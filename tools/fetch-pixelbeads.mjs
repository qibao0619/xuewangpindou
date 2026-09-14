/* 抓取 pixel-beads.com 的 MARD 色号页并保存原始 HTML（构建期用，一次性）：
 *   node tools/fetch-pixelbeads.mjs
 * 页面正文被 web_fetch 类工具截断，但直接抓 HTML 再自己解析就没有长度限制。 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  ['https://www.pixel-beads.com/zh/mard-bead-color-chart', 'data/pixel-beads-mard.html'],
];

mkdirSync(resolve(ROOT, 'data'), { recursive: true });
for (const [url, out] of PAGES) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PindouStudio/1.0 data-import)', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  if (!res.ok) { console.log('FAIL ' + url + ' HTTP ' + res.status); process.exit(1); }
  const html = await res.text();
  writeFileSync(resolve(ROOT, out), html);
  console.log('OK ' + out + '  ' + html.length + ' 字符');

  // 诊断：这份 HTML 里色号-色值是怎么写的
  const pairs = [...html.matchAll(/([A-Z]{1,2})(\d{1,3})[^\w#]{0,16}(#[0-9A-Fa-f]{6})/g)];
  console.log('  形如 "A1 … #RRGGBB" 的匹配数：' + pairs.length);
  const jsonish = [...html.matchAll(/"code"\s*:\s*"([^"]+)"\s*,\s*"hex"\s*:\s*"([^"]+)"/g)];
  console.log('  形如 "code"/"hex" JSON 字段的匹配数：' + jsonish.length);
  const probe = html.indexOf('F9F0CD');
  console.log('  探针 F9F0CD（pixel-beads 的 A1）：' + (probe < 0 ? '未出现' : '第 ' + probe + ' 字符处'));
  if (probe >= 0) console.log('  上下文：…' + html.slice(Math.max(0, probe - 220), probe + 60).replace(/\s+/g, ' ') + '…');
  const probe2 = html.indexOf('00BD35');
  console.log('  探针 00BD35（pixel-beads 的 B5）：' + (probe2 < 0 ? '未出现' : '第 ' + probe2 + ' 字符处'));
  if (probe2 >= 0) console.log('  上下文：…' + html.slice(Math.max(0, probe2 - 220), probe2 + 60).replace(/\s+/g, ' ') + '…');
}
