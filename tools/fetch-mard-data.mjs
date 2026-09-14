/* 拉取 MARD 色号数据（构建期用，一次性）：
 *   node tools/fetch-mard-data.mjs
 * 数据源：HansBug/pindou-color-data（公开色号数据汇总仓库，含来源与跨源差异说明）。
 * 拉下来后由 tools/build-palette-data.mjs 生成 js/palettes/mard.js。 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://cdn.jsdelivr.net/gh/HansBug/pindou-color-data@main/';
const FILES = [
  ['mard-291-github/colors.json', 'data/mard-291.json'],
  ['mard-221-github/colors.json', 'data/mard-221.json'],
  ['mard-221-alfonse-doudou/colors.json', 'data/mard-221-alfonse.json'],
  ['Mard-221-source-differences.json', 'data/mard-source-differences.json'],
  ['README.md', 'data/README-pindou-color-data.md'],
];

mkdirSync(resolve(ROOT, 'data'), { recursive: true });
let failed = 0;
for (const [src, out] of FILES) {
  try {
    const res = await fetch(BASE + src, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    writeFileSync(resolve(ROOT, out), text);
    console.log('OK   ' + out + '  ' + text.length + ' 字符');
  } catch (err) {
    failed++;
    console.log('FAIL ' + out + ' : ' + err.message);
  }
}
process.exit(failed ? 1 : 0);
