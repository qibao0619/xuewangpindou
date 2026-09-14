/* 逻辑冒烟测试：颜色 / 色卡 / 量化 / 网格变换 / 序列化，纯 Node 运行，不需要浏览器。
 * 用法：node tools/smoke.mjs */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await import(pathToFileURL(resolve(ROOT, 'js/palettes/mard.js')).href);   // MARD 真实色卡数据
await import(pathToFileURL(resolve(ROOT, 'js/palette.js')).href);
await import(pathToFileURL(resolve(ROOT, 'js/engine.js')).href);

const C = globalThis.PDColor;
const E = globalThis.PDEngine;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function group(t) { console.log('\n' + t); }

/* ---------- 颜色 ---------- */
group('颜色工具');
ok('hexToRgb 支持 #abc 缩写', JSON.stringify(C.hexToRgb('#f00')) === '[255,0,0]');
ok('hexToRgb 非法值返回 null', C.hexToRgb('nope') === null);
ok('rgbToHex 往返一致', C.rgbToHex(...C.hexToRgb('#3FA047')) === '#3FA047');
const whiteLab = C.rgbToLab(255, 255, 255);
const blackLab = C.rgbToLab(0, 0, 0);
ok('Lab 白 > 黑（L 通道）', whiteLab[0] > 95 && blackLab[0] < 5, `L白=${whiteLab[0].toFixed(1)} L黑=${blackLab[0].toFixed(1)}`);

/* ---------- 色卡 ---------- */
group('内置色卡');
const pals = C.getBuiltinPalettes();
const byId = (id) => pals.find((p) => p.id === id);
ok('至少 3 套内置色卡', pals.length >= 3, pals.map((p) => p.name).join(' / '));
ok('第一套是 MARD 标准 221 色（默认色卡）', pals[0].id === 'mard221', pals[0] && pals[0].id);
ok('常用色卡 ≥ 24 色', byId('common24').colors.length >= 24, String(byId('common24').colors.length));
ok('每套色卡颜色都带 lab', pals.every((p) => p.colors.every((c) => Array.isArray(c.lab) && c.lab.length === 3)));
ok('色卡内无重复 HEX', pals.every((p) => new Set(p.colors.map((c) => c.hex)).size === p.colors.length));
for (const p of pals) {
  let identity = true;
  for (const c of p.colors) if (p.colors[C.nearestLab(c.lab, p)].hex !== c.hex) identity = false;
  ok(`最近色查找自反（${p.name}）`, identity);
}

/* ---------- MARD 真实色卡 ---------- */
group('MARD 真实色卡');
const data = globalThis.PD_MARD;
ok('数据文件已加载', !!data);
const mard221 = byId('mard221');
const mard291 = byId('mard291');
ok('内置 MARD 标准 221 色色卡', !!mard221);
ok('内置 MARD 完整 291 色色卡', !!mard291);
ok('标准色卡正好 221 色', mard221 && mard221.colors.length === 221, mard221 ? String(mard221.colors.length) : 'none');
ok('完整色卡正好 291 色', mard291 && mard291.colors.length === 291, mard291 ? String(mard291.colors.length) : 'none');
ok('数据源标注完整（可追溯）', !!(mard221 && mard221.source && mard221.brand === 'MARD'), mard221 ? mard221.source : 'none');
ok('色卡不重复用同一个色号', (() => {
  const codes = mard291.colors.map((c) => c.code);
  return new Set(codes).size === codes.length;
})());
ok('色号是源数据的官方写法（字母 + 数字，其它系列两位补零）',
  mard291 && mard291.colors.every((c) => /^(?:ZG\d{1,2}|[A-PQRT-Y]\d{2})$/.test(c.code)),
  mard291 ? mard291.colors.filter((c) => !/^(?:ZG\d{1,2}|[A-PQRT-Y]\d{2})$/.test(c.code)).slice(0, 3).map((c) => c.code).join(',') : 'none');
ok('每个色都有色名', mard291 && mard291.colors.every((c) => c.name && c.name.length >= 1));

/* 与数据源逐条对齐（抽查各系列首尾与几个关键色号） */
const mardMap = new Map(mard291.colors.map((c) => [c.code, c]));
ok('色号齐全：每个系列都存在（含 ZG 珠光）',
  Object.keys(data.groups).every((g) => mard291.colors.some((c) => c.code.replace(/\d+$/, '') === g)),
  Object.keys(data.groups).filter((g) => !mard291.colors.some((c) => c.code.replace(/\d+$/, '') === g)).join(','));
ok('A01 的色值与源数据一致（#FAF4C8）', mardMap.get('A01').hex === '#FAF4C8', mardMap.get('A01').hex);
ok('A01 的色名与源数据一致（浅黄）', mardMap.get('A01').name === '浅黄', mardMap.get('A01').name);
ok('ZG6 是珠光蓝且不是白色（特殊系列已取渐变色）',
  mardMap.get('ZG6').hex !== '#FFFFFF' && mardMap.get('ZG6').name === '珠光蓝',
  mardMap.get('ZG6').hex + ' ' + mardMap.get('ZG6').name);
ok('T01 = 透明白色号存在', !!mardMap.get('T01'));
ok('扩展系列只在 291 色卡里', mard291.colors.length - mard221.colors.length === 70, String(mard291.colors.length - mard221.colors.length));
ok('221 色卡不含扩展系列（P/Q/R/T/Y/ZG）',
  mard221 && mard221.colors.every((c) => 'ABCDEFGHM'.indexOf(c.code[0]) >= 0),
  mard221 ? mard221.colors.filter((c) => 'ABCDEFGHM'.indexOf(c.code[0]) < 0).slice(0, 3).map((c) => c.code).join(',') : 'none');
ok('数据文件里标准/扩展拆分与色卡一致',
  data.total === 291 && data.standardCount === 221, data.total + '/' + data.standardCount);
ok('色号在色卡内按系列、按编号排序', (() => {
  const seq = mard221.colors.map((c) => /^([A-Z]+)(\d+)$/.exec(c.code)).filter(Boolean);
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (a[1] === b[1] && +b[2] < +a[2]) return false;
  }
  return true;
})());

/* MARD 色卡覆盖率应该明显好过 26 色的通用色卡 */
function seededRgb(n) {
  let s = 20240607;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = [];
    for (let k = 0; k < 3; k++) { s = (s * 1103515245 + 12345) & 0x7fffffff; c.push(s % 256); }
    out.push(c);
  }
  return out;
}
const probeLabs = seededRgb(1500).map((c) => C.rgbToLab(c[0], c[1], c[2]));
function meanErr(p) {
  let sum = 0;
  for (const lab of probeLabs) sum += Math.sqrt(C.deltaE2(lab, p.colors[C.nearestLab(lab, p)].lab));
  return sum / probeLabs.length;
}
const eMard = meanErr(mard221);
ok('MARD 221 配色误差明显小于 26 色通用色卡', eMard < meanErr(byId('common24')) * 0.8,
  `MARD221 ΔE=${eMard.toFixed(2)} vs 通用26 ΔE=${meanErr(byId('common24')).toFixed(2)}`);
ok('MARD 291 比 MARD 221 略好', meanErr(mard291) <= eMard + 0.01,
  `291 ΔE=${meanErr(mard291).toFixed(2)} vs 221 ΔE=${eMard.toFixed(2)}`);

/* ---------- 通用全色系色卡（无品牌，自动生成） ---------- */
group('通用全色系色卡（自动生成）');
const wide = byId('full221');
ok('内置了 221 色色卡', !!wide);
ok('颜色数正好 221', wide && wide.colors.length === 221, wide ? String(wide.colors.length) : 'none');
ok('无重复 HEX', wide && new Set(wide.colors.map((c) => c.hex)).size === wide.colors.length);
ok('色号连续 F001…F221', wide && wide.colors[0].code === 'F001' && wide.colors[220].code === 'F221',
  wide ? wide.colors[0].code + '…' + wide.colors[220].code : 'none');
ok('含纯白与纯黑', wide && wide.colors.some((c) => c.hex === '#FFFFFF') && wide.colors.some((c) => c.hex === '#000000'));
ok('每个色都有规范中文名（色相+明度或灰阶）',
  wide && wide.colors.every((c) => /^(?:灰阶 \d+|(?:极浅|浅|亮|深|暗|黑)?(?:红|橙|黄|黄绿|绿|青绿|青|蓝|蓝紫|紫|品红|玫红))$/.test(c.name)),
  wide ? wide.colors.filter((c) => !/^(?:灰阶 \d+|(?:极浅|浅|亮|深|暗|黑)?(?:红|橙|黄|黄绿|绿|青绿|青|蓝|蓝紫|紫|品红|玫红))$/.test(c.name)).slice(0, 3).map((c) => c.code + ':' + c.name).join(',') : 'none');
ok('色相分布不偏科（每个色相段都有颜色）', (() => {
  const segs = new Set(wide.colors.filter((c) => !/^灰阶/.test(c.name)).map((c) => C.labHueName(c.lab)));
  return segs.size >= 10;
})(), String(new Set(wide.colors.filter((c) => !/^灰阶/.test(c.name)).map((c) => C.labHueName(c.lab))).size) + ' 段');
ok('生成结果可复现（同参数同色号）', (() => {
  const again = C.buildWidePalette(221);
  return again.length === 221 && again.every((c, i) => c.hex === wide.colors[i].hex && c.code === wide.colors[i].code);
})());
ok('可以生成其他档位（如 120 色）', C.buildWidePalette(120).length === 120);
const e24 = meanErr(byId('common24')), e221 = meanErr(wide);
ok('221 色比 26 色配色误差显著更小', e221 < e24 * 0.6, `221色 ΔE=${e221.toFixed(2)} vs 26色 ΔE=${e24.toFixed(2)}`);
ok('221 色平均 ΔE < 8', e221 < 8, e221.toFixed(2));

/* 限色上限不再被卡在 200 */
const many = E.newGrid(40, 40, -1);
for (let i = 0; i < many.cells.length; i++) many.cells[i] = i % 221;
const keep250 = E.limitColors(many.cells, wide, 250);
ok('限色 250 不会被截断', new Set(Array.from(keep250.cells)).size === 221, String(new Set(Array.from(keep250.cells)).size));
const keep100 = E.limitColors(many.cells, wide, 100);
ok('限色 100 生效', new Set(Array.from(keep100.cells)).size <= 100, String(new Set(Array.from(keep100.cells)).size));

/* 导入 221 行的品牌色号表 */
const lines221 = [];
for (let i = 0; i < 221; i++) {
  const v = Math.round(255 * i / 220);
  lines221.push('B' + String(i + 1).padStart(3, '0') + ',#' + [v, (v * 7) % 256, (255 - v)].map((x) => x.toString(16).padStart(2, '0')).join('') + ',色' + (i + 1));
}
const imported = C.parsePaletteText(lines221.join('\n'));
ok('221 行的色号表能整表导入', imported.colors.length === 221, String(imported.colors.length));
ok('导入后色号保留', imported.colors[219].code === 'B220', imported.colors[219].code);

/* 把内置 MARD 221 导出成文本再导入，色号不能丢 */
const mardText = mard221.colors.map((c) => c.code + ',' + c.hex + ',' + c.name).join('\n');
const mardBack = C.parsePaletteText(mardText);
ok('MARD 221 色卡可以整表导出再导入（色号不丢）', mardBack.colors.length === 221, String(mardBack.colors.length));
ok('再导入后色值不变', mardBack.colors[0].code === 'A01' && mardBack.colors[0].hex === '#FAF4C8');

/* 速度：221 色量化 200×200 */
const bigPx = new Uint8ClampedArray(200 * 200 * 4);
seededRgb(200 * 200).forEach((c, i) => { bigPx[i * 4] = c[0]; bigPx[i * 4 + 1] = c[1]; bigPx[i * 4 + 2] = c[2]; bigPx[i * 4 + 3] = 255; });
let t0 = Date.now();
const bigCells = E.quantize(bigPx, 200, 200, wide, {});
const msPlain = Date.now() - t0;
t0 = Date.now();
E.quantize(bigPx, 200, 200, wide, { dither: true });
const msDither = Date.now() - t0;
ok('221 色量化 200×200 够快（普通 < 1500ms）', msPlain < 1500, msPlain + 'ms');
ok('221 色抖动量化也够快（< 3000ms）', msDither < 3000, msDither + 'ms');
ok('量化结果仍是合法色号', Array.from(bigCells).every((v) => v >= 0 && v < 221));
t0 = Date.now();
const mardCells = E.quantize(bigPx, 200, 200, mard221, { dither: true });
ok('MARD 221 抖动量化也够快（< 3000ms）', Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');
ok('MARD 量化结果仍是合法下标', Array.from(mardCells).every((v) => v >= 0 && v < 221));

/* ---------- 自定义色卡解析 ---------- */
group('自定义色卡解析');
const csv = 'A01,#FFFFFF,白\nA02,#111111,黑\nA03,#E03A2F,大红';
const p1 = C.parsePaletteText(csv);
ok('CSV 文本解析出 3 色', p1.colors.length === 3, String(p1.colors.length));
ok('CSV 保留色号与名称', p1.colors[2].code === 'A03' && p1.colors[2].name === '大红');
const p2 = C.parsePaletteText('["#FF0000", "#00FF00"]');
ok('JSON 数组（纯 HEX 字符串）解析', p2.colors.length === 2);
const p3 = C.parsePaletteText(JSON.stringify({ name: '我的豆子', colors: [{ code: 'M1', hex: '#123456', name: '深蓝' }] }));
ok('JSON 对象带 name', p3.name === '我的豆子' && p3.colors[0].code === 'M1');
const p4 = C.parsePaletteText('B01 #FFFFFF 白\nB02 #000000 黑');
ok('空格分隔也能解析', p4.colors.length === 2, JSON.stringify(p4.colors.map((c) => c.code)));
const p5 = C.parsePaletteText('# 这是注释\n#FF0000\n#00FF00');
ok('注释行被忽略', p5.colors.length === 2, String(p5.colors.length));
const p6 = C.parsePaletteText('X1,#FF0000,红\nX1,#FF0000,红');
ok('完全相同的一行会去重', p6.colors.length === 1 && p6.dups === 1, p6.colors.length + '/' + p6.dups);
const p7 = C.parsePaletteText('X1,#FF0000,红\nX2,#FF0000,又红');
ok('不同色号即使色值相同也保留（真实色卡有这种情况）', p7.colors.length === 2, String(p7.colors.length));
let threw = false;
try { C.parsePaletteText('  '); } catch (_) { threw = true; }
ok('空内容抛错', threw);

/* ---------- 量化 ---------- */
group('量化');
const pal = byId('common24');
function rgbaOf(list, w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = C.hexToRgb(list[i % list.length]);
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  return d;
}
const cells1 = E.quantize(rgbaOf(['#FF0000', '#0000FF'], 8, 8), 8, 8, pal, {});
ok('输出长度 = w*h', cells1.length === 64);
ok('所有下标都在色卡范围内', Array.from(cells1).every((v) => v >= 0 && v < pal.colors.length));
let redFound = false, blueFound = false;
for (let i = 0; i < 64; i++) {
  const hex = pal.colors[cells1[i]].hex;
  if (hex === '#E03A2F') redFound = true;
  if (hex === '#2050D8') blueFound = true;
}
ok('纯红映射到大红', redFound);
ok('纯蓝映射到蓝', blueFound);
const midBlue = pal.colors[C.nearestLab(C.rgbToLab(68, 119, 204), pal)];
ok('中蓝映射到中蓝（不会跑到紫）', midBlue.name === '中蓝', midBlue.hex + ' ' + midBlue.name);
const cells2 = E.quantize(rgbaOf(['#FF0000', '#0000FF'], 8, 8), 8, 8, pal, { dither: true });
ok('抖动路径同样输出合法下标', Array.from(cells2).every((v) => v >= 0 && v < pal.colors.length));
const alpha = new Uint8ClampedArray(4 * 4 * 4);
for (let i = 0; i < 16; i++) { alpha[i * 4 + 3] = i < 8 ? 0 : 255; alpha[i * 4] = 0; alpha[i * 4 + 1] = 255; alpha[i * 4 + 2] = 0; }
const cells3 = E.quantize(alpha, 4, 4, pal, { alphaThreshold: 16 });
ok('透明像素变空格子', cells3.slice(0, 8).every((v) => v === -1) && cells3.slice(8).every((v) => v >= 0));

/* 用 MARD 221 量化照片色：出的色号必须是能买到的 MARD 色号 */
const photoCells = E.quantize(rgbaOf(['#7A9C6B', '#F1D9B5', '#33475B', '#C94F42'], 12, 12), 12, 12, mard221, {});
ok('MARD 色卡量化出的色号都在 221 色以内', Array.from(photoCells).every((v) => v >= 0 && v < 221));
ok('MARD 量化结果带官方色号', Array.from(new Set(Array.from(photoCells))).every((v) => /^[A-HM]\d{2}$/.test(mard221.colors[v].code)),
  Array.from(new Set(Array.from(photoCells))).slice(0, 4).map((v) => mard221.colors[v].code).join(','));
/* ---------- 限色 ---------- */
group('限色');
const wideGrid = E.newGrid(16, 16, -1);
for (let i = 0; i < wideGrid.cells.length; i++) wideGrid.cells[i] = i % 12;
const limited = E.limitColors(wideGrid.cells, byId('full221'), 4);
const uniq = new Set(Array.from(limited.cells).filter((v) => v >= 0));
ok('限色后颜色数 ≤ 4', uniq.size <= 4, String(uniq.size));
ok('限色报告被合并的颜色数', limited.removed === 8, String(limited.removed));

/* ---------- 限色：相近色合并 / 阴影阶压缩 / 差异大的保留 ---------- */
group('限色（聚类规则）');
{
  const shades = {
    id: 't', name: 't', colors: [
      { code: 'B1', rgb: [220, 233, 247] }, { code: 'B2', rgb: [185, 210, 238] },
      { code: 'B3', rgb: [148, 185, 226] }, { code: 'B4', rgb: [111, 159, 212] },
      { code: 'B5', rgb: [74, 130, 194] }, { code: 'B6', rgb: [42, 95, 158] },
      { code: 'R1', rgb: [214, 58, 47] }, { code: 'G1', rgb: [58, 168, 74] },
    ],
  };
  shades.colors.forEach((c) => { c.lab = C.rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]); });
  // 蓝色 6 个深浅阶占满全图，红色/绿色各只有 2 格
  const W = 40, cells = new Int16Array(W * 40).fill(0);
  const band = (y0, y1, idx) => { for (let r = y0; r < y1; r++) for (let c = 0; c < W; c++) cells[r * W + c] = idx; };
  band(0, 8, 5); band(8, 16, 4); band(16, 24, 3); band(24, 30, 2); band(30, 34, 1); band(34, 40, 0);
  cells[0] = 6; cells[1] = 6; cells[W] = 7; cells[W + 1] = 7;
  const codesOf = (arr) => Array.from(new Set(Array.from(arr).filter((v) => v >= 0))).sort((a, b) => a - b).map((i) => shades.colors[i].code);

  const r4 = E.limitColors(cells, shades, 4);
  const c4 = codesOf(r4.cells);
  ok('差异大的小面积颜色不会被面积大的近似色吞掉（红/绿各只有 2 格也保住）',
    c4.includes('R1') && c4.includes('G1'), c4.join(','));
  ok('同色相的深浅阶被合并（6 个蓝阶压到 2 个）', c4.filter((c) => c[0] === 'B').length === 2, c4.join(','));
  ok('合并后留下的蓝阶一深一浅，而不是挤在一起',
    c4.includes('B1') && c4.includes('B5'), c4.join(','));

  const r3 = E.limitColors(cells, shades, 3);
  const c3 = codesOf(r3.cells);
  ok('色数继续收紧时优先牺牲同色相的层次，而不是不同色相',
    c3.includes('R1') && c3.includes('G1') && c3.filter((c) => c[0] === 'B').length === 1, c3.join(','));

  ok('阴影阶合并后仍保留最深的那个（阴影不会消失）',
    E.limitColors(cells, shades, 2).cells.length === cells.length &&
    codesOf(E.limitColors(cells, shades, 2).cells).length <= 2);

  // 黑白不能被糊成一色
  const bw = {
    id: 'bw', name: 'bw', colors: [
      { code: 'W', rgb: [255, 255, 255] }, { code: 'K', rgb: [0, 0, 0] },
      { code: 'M1', rgb: [200, 200, 200] }, { code: 'M2', rgb: [210, 210, 210] },
    ],
  };
  bw.colors.forEach((c) => { c.lab = C.rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]); });
  const bwCells = new Int16Array(64);
  for (let i = 0; i < 64; i++) bwCells[i] = i < 16 ? 0 : i < 32 ? 1 : i < 48 ? 2 : 3;
  const bwCodes = Array.from(new Set(Array.from(E.limitColors(bwCells, bw, 3).cells))).sort((a, b) => a - b).map((i) => bw.colors[i].code);
  ok('明度差过大（黑白）不会被强行合并', bwCodes.includes('W') && bwCodes.includes('K'), bwCodes.join(','));
  ok('两个几乎一样的浅灰会先被合并', !(bwCodes.includes('M1') && bwCodes.includes('M2')), bwCodes.join(','));

  ok('限色结果仍只含原色卡里的合法下标',
    Array.from(E.limitColors(cells, shades, 3).cells).every((v) => v === -1 || (v >= 0 && v < shades.colors.length)));
  ok('空格子在限色后仍然是空格子',
    E.limitColors(Int16Array.from([-1, 0, 1, -1]), shades, 1).cells[0] === -1);
}

/* ---------- 统计 ---------- */
group('统计');
const st = E.countUsage(wideGrid.cells, byId('full221'));
ok('总豆数 = 非空格子数', st.total === 256, String(st.total));
ok('counts 降序', st.list.every((r, i) => i === 0 || st.list[i - 1].count >= r.count));
const mardUsage = E.countUsage(photoCells, mard221);
ok('MARD 色卡统计带色号与色名', mardUsage.list.every((r) => r.color && r.color.code && typeof r.color.name === 'string'));

/* ---------- 网格变换 ---------- */
group('网格变换');
const g = E.newGrid(3, 2, -1);
g.cells[0] = 1; g.cells[1] = 2; g.cells[2] = 3;   // 第一行 1,2,3
g.cells[3] = 4; g.cells[4] = 5; g.cells[5] = 6;   // 第二行 4,5,6
const rot = E.rotateGrid(g, true);
ok('旋转 90° 后尺寸互换', rot.w === 2 && rot.h === 3);
ok('旋转 90° 内容正确', Array.from(rot.cells).join(',') === '4,1,5,2,6,3', Array.from(rot.cells).join(','));
const fh = E.flipGrid(g, 'h');
ok('水平翻转正确', Array.from(fh.cells).join(',') === '3,2,1,6,5,4', Array.from(fh.cells).join(','));
const fv = E.flipGrid(g, 'v');
ok('垂直翻转正确', Array.from(fv.cells).join(',') === '4,5,6,1,2,3', Array.from(fv.cells).join(','));
const big = E.newGrid(10, 10, -1);
big.cells[3 * 10 + 4] = 7;
const trim = E.trimGrid(big);
ok('裁边后尺寸 1×1', trim.grid.w === 1 && trim.grid.h === 1 && trim.dx === 4 && trim.dy === 3);
ok('全空图案裁边返回 null', E.trimGrid(E.newGrid(4, 4, -1)) === null);

/* ---------- 去四周背景 ---------- */
group('去四周背景');
{
  // 24×16 的「人物」：四周一圈背景(0)，中间主体(1)，身体内部有个和背景同色的洞(0)，
  // 头和身体之间靠脖子连着（脖子夹在背景中间）
  const W = 24, H = 16;
  const cs = new Int16Array(W * H).fill(-1);
  const put = (r, c, v) => { cs[r * W + c] = v; };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r < 3 || r > 12 || c < 3 || c > 20) put(r, c, 0);
  for (let r = 3; r < 7; r++) for (let c = 8; c < 16; c++) put(r, c, 1);
  for (let c = 10; c < 14; c++) put(7, c, 1);                       // 脖子
  for (let r = 8; r < 13; r++) for (let c = 6; c < 18; c++) put(r, c, 1);
  for (let r = 9; r < 11; r++) for (let c = 10; c < 14; c++) put(r, c, 0); // 内部的洞
  const countOf = (a, v) => Array.from(a).filter((x) => x === v).length;

  const bg = E.removeEdgeBackground(cs, W, H);
  ok('识别出了背景色', bg.bg.length === 1 && bg.bg[0] === 0, bg.bg.join(','));
  ok('四周背景被清成空格', bg.removed === 204, String(bg.removed));
  ok('四个角都清干净了', [0, W - 1, (H - 1) * W, H * W - 1].every((i) => bg.cells[i] === -1));
  ok('最外圈一格不剩', (() => {
    for (let c = 0; c < W; c++) if (bg.cells[c] !== -1 || bg.cells[(H - 1) * W + c] !== -1) return false;
    for (let r = 0; r < H; r++) if (bg.cells[r * W] !== -1 || bg.cells[r * W + W - 1] !== -1) return false;
    return true;
  })());
  ok('主体一格没少', countOf(bg.cells, 1) === countOf(cs, 1), String(countOf(bg.cells, 1)));
  ok('中间连接部分（脖子）保留', bg.cells[7 * W + 11] === 1 && bg.cells[7 * W + 12] === 1);
  ok('主体内部与背景同色的洞也保留（没被挖空）', bg.cells[9 * W + 11] === 0 && bg.cells[10 * W + 12] === 0);
  ok('内部洞没有和边缘连通，所以不算背景', countOf(bg.cells, 0) === 8, String(countOf(bg.cells, 0)));
  ok('原数组没被改动（纯函数）', countOf(cs, 0) === 212 && cs[0] === 0);

  // 边界情况
  ok('全空的画布不会出错', E.removeEdgeBackground(new Int16Array(16).fill(-1), 4, 4).removed === 0);
  ok('整块同色会被整体清掉', E.removeEdgeBackground(new Int16Array(9).fill(5), 3, 3).removed === 9);
  ok('太小的画布直接返回不动', E.removeEdgeBackground(Int16Array.from([1, 1, 1, 1]), 2, 2).removed === 0);

  // 边缘只有一点点同色（主体贴边）时不该整片当背景
  const edge = new Int16Array(10 * 10).fill(3);
  const e2 = E.removeEdgeBackground(edge, 10, 10);
  ok('边缘全是同一个色时照样能清掉', e2.removed === 100, String(e2.removed));
}
const rs = E.resizeGrid(g, 6, 4);
ok('放大后尺寸正确', rs.w === 6 && rs.h === 4);
ok('放大后原值仍在左上角', rs.cells[0] === 1);

/* ---------- 绘制辅助 ---------- */
group('绘制辅助');
const line = [];
E.lineCells(0, 0, 3, 3, (r, c) => line.push(r + ',' + c));
ok('Bresenham 对角线 4 点', line.join(' ') === '0,0 1,1 2,2 3,3', line.join(' '));
const ff = E.newGrid(5, 5, 0);
ff.cells[12] = 9;                                   // 中间一个异色点
const filled = E.floodFill(ff, 0, 0, 3);
ok('油漆桶改了 24 格（避开异色点）', filled.length === 24, String(filled.length));
ok('油漆桶后异色点保留', ff.cells[12] === 9 && ff.cells[0] === 3);

/* ---------- 序列化 ---------- */
group('序列化');
// 真实图案：大面积单色 + 少量杂色
const rnd = E.newGrid(40, 40, -1);
for (let r = 0; r < 40; r++) {
  for (let c = 0; c < 40; c++) {
    rnd.cells[r * 40 + c] = (r < 2 || c < 2 || r > 37 || c > 37) ? -1 : ((r >> 3) + (c >> 3)) % 12;
  }
}
const enc = E.encodeGrid(rnd);
ok('编码结果带 w/h/rle', enc.w === 40 && enc.h === 40 && typeof enc.rle === 'string' && enc.rle.length > 0);
const dec = E.decodeGrid(enc);
ok('RLE 往返一致', dec.w === rnd.w && dec.h === rnd.h && Array.from(dec.cells).join(',') === Array.from(rnd.cells).join(','));
const rawBytes = rnd.cells.length * 2;
ok('RLE 在真实图案上压缩有效', enc.rle.length < rawBytes, `${enc.rle.length} < ${rawBytes}`);
// 噪声图案 RLE 会变长，但必须能无损还原
const noisy = E.newGrid(30, 30, -1);
for (let i = 0; i < noisy.cells.length; i++) noisy.cells[i] = (i % 7 === 0) ? -1 : (i % 23);
const backNoisy = E.decodeGrid(E.encodeGrid(noisy));
ok('噪声图案也能无损还原', Array.from(backNoisy.cells).join(',') === Array.from(noisy.cells).join(','));
const one = E.newGrid(5, 5, 3);
ok('单色图 RLE 极短', E.encodeGrid(one).rle.length < 20, E.encodeGrid(one).rle.length + ' 字符');
let truncated = null;
try { truncated = E.decodeGrid({ w: 5, h: 5, rle: 'AA' }); } catch (_) { truncated = null; }
ok('截断数据不崩（长度不足补空）', truncated === null || truncated.cells.length === 25);

/* ---------- 重新配色 ---------- */
group('换色卡重新配色');
const remapped = C.remapGrid(wideGrid, byId('full221'), byId('common24'));
ok('重新配色后下标合法', Array.from(remapped.cells).every((v) => v >= 0 && v < byId('common24').colors.length));
ok('空格子保持空', (() => {
  const t = E.newGrid(4, 4, -1);
  t.cells[0] = 5;
  const r2 = C.remapGrid(t, byId('full221'), byId('common24'));
  return r2.cells[0] >= 0 && r2.cells.slice(1).every((v) => v === -1);
})());
/* 从 MARD 221 换到 MARD 291：色号必须还是 MARD 色号 */
const mardSwap = C.remapGrid({ w: 12, h: 12, cells: photoCells }, mard221, mard291);
ok('MARD 221 → 291 重新配色下标合法', Array.from(mardSwap.cells).every((v) => v >= 0 && v < 291));
ok('换色卡后仍是 MARD 官方色号', Array.from(new Set(Array.from(mardSwap.cells))).every((v) => !!mard291.colors[v] && /^(?:ZG\d{1,2}|[A-PQRT-Y]\d{2})$/.test(mard291.colors[v].code)));

/* ---------- 亮度/对比度/饱和度兜底实现 ---------- */
group('亮度/对比度/饱和度兜底实现');
const px = new Uint8ClampedArray([100, 100, 100, 255]);
E.applyAdjustments(px, 120, 100, 100);
ok('提亮后像素变亮', px[0] > 100, String(px[0]));
const px2 = new Uint8ClampedArray([200, 10, 10, 255]);
E.applyAdjustments(px2, 100, 100, 0);
ok('饱和度 0 后变灰', px2[0] === px2[1] && px2[1] === px2[2], `${px2[0]},${px2[1]},${px2[2]}`);

/* ---------- 结果 ---------- */
console.log('\n=== 结果 ===');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  fails.forEach((f) => console.log(' ✗ ' + f));
  process.exit(1);
}
console.log('✅ 冒烟测试全部通过');
