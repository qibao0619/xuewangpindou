/* 由抓下来的原始数据生成 js/palettes/mard.js（构建期用）
 *   node tools/fetch-webfem.mjs && node tools/build-palette-data.mjs
 *   node tools/build-palette-data.mjs --source=pixel-beads   # 换成另一个源
 *   node tools/build-palette-data.mjs --source=github        # 公开汇总仓库版
 *
 * 数据源优先级（默认 webfem：带色名、色号零填充、221/291 分组齐全）：
 *   1) data/webfem/asset-._mard-colors.js  —— webfem MARD 色号表（291 色）
 *   2) data/pixel-beads-mard.html          —— MARD 拼豆色号大全（2026 修订版）
 *   3) data/mard-291.json                  —— 公开数据汇总仓库版
 * 脚本会校验总色数、各系列色数、色号唯一性，并打印三个源的差异统计。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
};
const source = arg('source', 'webfem');

/* 标称的每系列色数，用来校验解析完整性 */
const EXPECT = { A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15, P: 23, Q: 5, R: 28, T: 1, Y: 5, ZG: 8 };
const STANDARD = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'];
const SERIES_CN = {
  A: '黄橙', B: '绿', C: '蓝', D: '紫', E: '粉', F: '红', G: '棕', H: '黑白灰',
  M: '浊色', P: '肤色', Q: '荧光', R: '扩展', T: '透明', Y: '马卡龙', ZG: '珠光',
};
const normCode = (c) => c.replace(/^([A-Z]+)0*(\d+)$/, '$1$2');

function avgHex(list) {
  const sum = [0, 0, 0];
  for (const h of list) for (let i = 0; i < 3; i++) sum[i] += parseInt(h.substr(1 + i * 2, 2), 16);
  return '#' + sum.map((v) => Math.round(v / list.length).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ---- 源 1：webfem（默认）---- */
function parseWebfem() {
  const text = readFileSync(resolve(ROOT, 'data/webfem/asset-._mard-colors.js'), 'utf8');
  const json = JSON.parse(text.slice(text.indexOf('=') + 1).replace(/;\s*$/, ''));
  const rows = json.colors.map((c) => ({
    code: c.key,
    hex: String(c.hex).toUpperCase(),
    name: c.name || '',
    group: c.series,
    standard: c.set === 221,
  }));
  return {
    rows,
    meta: {
      source: 'webfem.com/tools/pindou/mard-color-chart',
      title: 'MARD 拼豆色号表 ' + json.total + ' 色（标准 ' + json.core + ' + 扩展 ' + json.extra + '）',
      updated: json.updated || '',
    },
  };
}

/* ---- 源 2：pixel-beads ---- */
function parsePixelBeads() {
  const html = readFileSync(resolve(ROOT, 'data/pixel-beads-mard.html'), 'utf8');
  const rows = [];
  for (const card of html.split('<article').slice(1)) {
    const style = (card.match(/style="(background-color:[^"]*)"/) || [])[1] || '';
    const code = (card.match(/aria-label="复制色号\s*([^"]+)"/) || [])[1];
    if (!style || !code) continue;
    const c = code.trim();
    if (!/^(?:ZG|[A-HMPQRTY])\d{1,3}$/.test(c)) continue;
    const lin = (style.match(/linear-gradient\([^;"]*\)/) || [])[0] || '';
    const linHex = (lin.match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase());
    const base = ((style.match(/background-color:(#[0-9A-Fa-f]{6})/) || [])[1] || '').toUpperCase();
    // 珠光等特殊系列是双色渐变卡片（底色写成白），取渐变色均值当屏幕近似值
    const group = c.replace(/\d+$/, '');
    rows.push({
      code: group + String(c.match(/\d+$/)[0]).padStart(2, '0'),
      hex: linHex.length >= 2 ? avgHex(linHex) : base,
      name: '',
      group,
      standard: STANDARD.includes(group),
    });
  }
  return { rows, meta: { source: 'pixel-beads.com/zh/mard-bead-color-chart', title: 'MARD 拼豆色号大全（2026 重新修订版）', updated: '' } };
}

/* ---- 源 3：公开汇总仓库 ---- */
function parseRepoJson() {
  const json = JSON.parse(readFileSync(resolve(ROOT, 'data/mard-291.json'), 'utf8'));
  return {
    rows: json.colors.map((c) => ({
      code: normCode(c.code).replace(/^([A-Z]+)(\d+)$/, (m, a, b) => a + b.padStart(2, '0')),
      hex: String(c.hex).toUpperCase(),
      name: '',
      group: c.group,
      standard: STANDARD.includes(c.group),
    })),
    meta: { source: 'github.com/HansBug/pindou-color-data (mard-291-github)', title: 'MARD 291 色（公开数据汇总版）', updated: '' },
  };
}

const PARSERS = { webfem: parseWebfem, 'pixel-beads': parsePixelBeads, github: parseRepoJson };

function validate(data, label) {
  const { rows } = data;
  const problems = [];
  const codes = new Set();
  const counts = {};
  for (const r of rows) {
    if (codes.has(r.code)) problems.push('重复色号 ' + r.code);
    codes.add(r.code);
    if (!/^#[0-9A-F]{6}$/.test(r.hex)) problems.push('非法色值 ' + r.code + ' ' + r.hex);
    if (!EXPECT[r.group]) problems.push('未知系列 ' + r.group + '（' + r.code + '）');
    counts[r.group] = (counts[r.group] || 0) + 1;
  }
  for (const [g, n] of Object.entries(EXPECT)) {
    if ((counts[g] || 0) !== n) problems.push(`系列 ${g} 色数 ${counts[g] || 0} ≠ 标称 ${n}`);
  }
  const standard = rows.filter((r) => r.standard).length;
  if (rows.length !== 291) problems.push('总色数 ' + rows.length + ' ≠ 291');
  if (standard !== 221) problems.push('标准系列色数 ' + standard + ' ≠ 221');
  if (rows.filter((r) => r.standard !== STANDARD.includes(r.group)).length) problems.push('standard 标记与系列不一致');
  const dupHex = rows.length - new Set(rows.map((r) => r.hex)).size;
  const withName = rows.filter((r) => r.name).length;
  console.log(`[${label}] 共 ${rows.length} 色 / 标准 ${standard} / 扩展 ${rows.length - standard} / 重色值 ${dupHex} 组 / 有色名 ${withName} / 系列 ${Object.keys(counts).length}`);
  if (problems.length) {
    console.log('  ✗ 校验失败：');
    problems.forEach((p) => console.log('    - ' + p));
    process.exit(1);
  }
  console.log('  ✓ 总色数、标准/扩展拆分、各系列色数全部对得上');
  return { counts, standard, dupHex, withName };
}

const chosen = PARSERS[source]();
if (!chosen) { console.log('未知数据源：' + source); process.exit(1); }
const info = validate(chosen, source);

/* 三个源交叉比对，如实报告差异（不自动择一） */
const cmpTargets = Object.entries(PARSERS).filter(([k]) => k !== source);
const chosenMap = new Map(chosen.rows.map((r) => [normCode(r.code), r.hex]));
for (const [label, parser] of cmpTargets) {
  let other;
  try { other = parser(); } catch { continue; }
  const map = new Map(other.rows.map((r) => [normCode(r.code), r.hex]));
  let same = 0, diff = 0, miss = 0, sum = 0, max = 0;
  for (const [code, hex] of chosenMap) {
    const o = map.get(code);
    if (!o) { miss++; continue; }
    if (o === hex) { same++; continue; }
    const d = [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(hex.substr(i, 2), 16) - parseInt(o.substr(i, 2), 16)), 0);
    diff++; sum += d; if (d > max) max = d;
  }
  console.log(`  与 ${label} 对照：一致 ${same}，不同 ${diff}，缺号 ${miss}，平均三通道差 ${(sum / (diff || 1)).toFixed(1)}，最大 ${max}`);
}
if (source !== 'webfem' && existsSync(resolve(ROOT, 'data/webfem/asset-._mard-colors.js'))) {
  console.log('  提示：官方推荐源是 webfem（带色名），当前用的是 ' + source);
}

/* 输出运行时数据文件 */
const groups = {};
for (const r of chosen.rows) {
  const entry = r.name ? `['${r.code}','${r.hex}','${r.name}']` : `['${r.code}','${r.hex}']`;
  (groups[r.group] = groups[r.group] || []).push(entry);
}
const ordered = Object.keys(EXPECT).filter((g) => groups[g]);
const lines = ordered.map((g) => {
  const tag = STANDARD.includes(g) ? '标准' : '扩展';
  return `    /* ${g} 系列（${SERIES_CN[g]}，${groups[g].length} 色，${tag}） */\n    ${g}: [${groups[g].join(', ')}],`;
});

const out = `/* 自动生成，请勿手改！重新生成：
 *   node tools/fetch-webfem.mjs && node tools/build-palette-data.mjs
 *
 * 色号数据来源：${chosen.meta.source}
 *   标题：${chosen.meta.title}${chosen.meta.updated ? '\n *   源数据更新：' + chosen.meta.updated : ''}
 *   生成时间：${new Date().toISOString().slice(0, 10)}
 *   校验：总计 ${chosen.rows.length} 色 = 标准 ${info.standard} + 扩展 ${chosen.rows.length - info.standard}；15 个系列色数全部与源页标称一致
 *
 * 数组格式：[色号, HEX, 色名?]，色名为空时省略。
 * HEX 是屏幕近似值，不等于实物颜色；实物请以店家色号与实物色卡为准。 */
globalThis.PD_MARD = {
  source: ${JSON.stringify(chosen.meta.source)},
  title: ${JSON.stringify(chosen.meta.title)},
  updated: ${JSON.stringify(chosen.meta.updated || '')},
  generatedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
  total: ${chosen.rows.length},
  standardCount: ${info.standard},
  standardGroups: ${JSON.stringify(STANDARD)},
  seriesNames: ${JSON.stringify(SERIES_CN)},
  groups: {
${lines.join('\n')}
  },
};
`;

mkdirSync(resolve(ROOT, 'js/palettes'), { recursive: true });
writeFileSync(resolve(ROOT, 'js/palettes/mard.js'), out);
console.log('\n✓ 已写入 js/palettes/mard.js（' + out.length + ' 字符，' + ordered.length + ' 个系列，' + info.withName + ' 个色名）');
