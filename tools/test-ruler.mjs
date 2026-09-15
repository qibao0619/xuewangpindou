/**
 * 刻度防重叠的回归测试。
 *
 * 注意：这个测试**不复制** editor.js 的逻辑，而是把 _drawRulers 真的跑一遍，
 * 用一个假的 canvas context 把 fillText 的坐标录下来再检查间距。
 * （之前写的第一版是复制一份逻辑来测，结果改坏了代码测试照样绿——那种测试没有意义。）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info ? ' → ' + info : '')); }
};

/** 造一个够用的假 context，记录所有 fillText */
function fakeCtx() {
  const texts = [];
  return {
    texts,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect() {}, clearRect() {}, rect() {}, fill() {}, clip() {},
    arc() {}, closePath() {}, translate() {}, scale() {}, rotate() {},
    setLineDash() {}, drawImage() {}, measureText: (s) => ({ width: String(s).length * 6 }),
    fillText(t, x, y) { texts.push({ t: String(t), x, y }); },
  };
}

/** 从真实的 editor.js 里把 Editor 类挖出来（不跑整个页面） */
const src = readFileSync(resolve(ROOT, 'js/editor.js'), 'utf8');
const sandbox = {
  window: {}, document: { addEventListener() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  console,
};
vm.createContext(sandbox);
// editor.js 末尾是 (function (root) {...})(globalThis)，
// 在 vm 里没有 globalThis 时用 sandbox 自己当 root。
vm.runInContext('var globalThis = this;\n' + src, sandbox);
const Editor = sandbox.PDEditor;
if (typeof Editor !== 'function') { console.error('没能从 editor.js 里拿到 PDEditor，sandbox keys: ' + Object.keys(sandbox).join(',')); process.exit(2); }

const M = { left: 36, top: 22, right: 12, bottom: 12 };   // 与 editor.js 里的 M 保持一致

/** 直接调 _drawRulers，返回它画出来的刻度 */
function runRulers({ w, h, zoom, boardSize = 29, cssW = 900, cssH = 700 }) {
  const ed = Object.create(Editor.prototype);
  ed.opts = { boardSize };
  ed.grid = { w, h, cells: new Int16Array(w * h).fill(-1) };
  ed.view = { zoom, ox: 0, oy: 0 };
  ed.cssW = cssW; ed.cssH = cssH;
  ed.hover = null;
  ed.dpr = 1;
  const ctx = fakeCtx();
  ed._drawRulers(ctx, M.left, M.top, zoom, 0, w, 0, h);
  return ctx.texts;
}

console.log('=== 刻度防重叠（直接跑 editor.js 的真实代码）===');

const CASES = [4, 6, 8, 10, 12, 14, 16, 20, 30];
for (const zoom of CASES) {
  const texts = runRulers({ w: 87, h: 87, zoom, cssW: 1200, cssH: 900 });
  // 顶部刻度画在 y = M.top/2（11 附近）且 x 随格子变化；
  // 左侧刻度画在 x = M.left-6（30 附近）且 y 随格子变化。按坐标分开，别混在一起比。
  const top = texts.filter((t) => Math.abs(t.y - M.top / 2) < 2).sort((a, b) => a.x - b.x);
  const left = texts.filter((t) => Math.abs(t.x - (M.left - 6)) < 2).sort((a, b) => a.y - b.y);
  ok('zoom=' + zoom + '：顶部刻度有内容', top.length > 0, top.length + ' 个');
  let minTop = Infinity, worst = '';
  for (let i = 1; i < top.length; i++) {
    const d = top[i].x - top[i - 1].x;
    if (d < minTop) { minTop = d; worst = top[i - 1].t + '↔' + top[i].t; }
  }
  let minLeft = Infinity;
  for (let i = 1; i < left.length; i++) minLeft = Math.min(minLeft, left[i].y - left[i - 1].y);
  ok('zoom=' + zoom + '：顶部刻度不重叠（最小间距 ≥16）',
    top.length < 2 || minTop >= 16, '最小 ' + minTop + (worst ? '，最挤的是 ' + worst : ''));
  ok('zoom=' + zoom + '：左侧刻度不重叠（最小间距 ≥16）',
    left.length < 2 || minLeft >= 16, '最小 ' + minLeft);
}

// 板号保留
{
  const texts = runRulers({ w: 87, h: 87, zoom: 6, cssW: 1200, cssH: 900 });
  const top = texts.filter((t) => Math.abs(t.y - M.top / 2) < 2).map((t) => t.t);
  const hasAll = ['29', '58', '87'].every((n) => top.includes(n));
  ok('小缩放下 29 / 58 / 87 板号都在', hasAll, top.join(','));
}

// 放大后要密集，不能误删
{
  const texts = runRulers({ w: 87, h: 87, zoom: 30, cssW: 4000, cssH: 4000 });
  const top = texts.filter((t) => Math.abs(t.y - M.top / 2) < 2);
  ok('放大后刻度变密（≥60 个）', top.length >= 60, top.length + ' 个');
}

// 旧 bug：29 和 31 撞在一起 —— 两者的 x 必须拉开
{
  const texts = runRulers({ w: 87, h: 87, zoom: 6, cssW: 1200, cssH: 900 });
  const top = texts.filter((t) => Math.abs(t.y - M.top / 2) < 2);
  const t29 = top.find((t) => t.t === '29');
  const t31 = top.find((t) => t.t === '31');
  ok('29 和 31 不同时出现（旧 bug 就是这俩糊在一起）', !(t29 && t31),
    t29 && t31 ? '两者都在，间距 ' + Math.abs(t29.x - t31.x).toFixed(0) : '只保留了一个');
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过（' + pass + ' 项）'));
process.exitCode = fail ? 1 : 0;
