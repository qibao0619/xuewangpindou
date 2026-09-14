/* DOM 装配测试：用 jsdom 真正加载 index.html 并执行全部脚本，
 * 用桩 canvas 2D 上下文跑通启动、示例图案、清单渲染、撤销重做、导出等交互。
 * 用法：node tools/domtest.mjs
 * jsdom 从 DSH 自带的 node_modules 借用（本项目本身零依赖）。
 * 优先用本机临时 HTTP 服务加载页面（这样 localStorage 可用），失败则退回 file://。 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadJsdom() {
  const candidates = [
    'jsdom',
    'E:/dsh/DSH Desktop/resources/app/node_modules/jsdom',
    process.env.DSH_APP_ROOT ? join(process.env.DSH_APP_ROOT, 'node_modules/jsdom') : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* 试下一个 */ }
  }
  return null;
}

const jsdomMod = loadJsdom();
if (!jsdomMod) {
  console.log('⚠️  没找到 jsdom，跳过 DOM 装配测试（逻辑部分见 tools/smoke.mjs）');
  process.exit(0);
}
const { JSDOM, VirtualConsole } = jsdomMod;

/* ---------- 桩：canvas 2D 上下文 ---------- */
const textCalls = [];     // 记录所有 fillText，用来验证「格子里画色号」
const rectCalls = [];     // 记录 rect()（fill/stroke 之前）用来验证高亮绘制
const fillRectCalls = []; // 记录 fillRect，用来验证压暗遮罩
function fakeContext(canvas) {
  const noop = () => {};
  const ctx = {
    canvas,
    filter: 'none',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    setTransform: noop, resetTransform: noop, clearRect: noop,
    fillRect(x, y, w, h) { fillRectCalls.push({ x, y, w, h, fillStyle: String(ctx.fillStyle) }); },
    strokeRect: noop, save: noop, restore: noop, beginPath: noop, closePath: noop,
    rect(x, y, w, h) { rectCalls.push({ x, y, w, h }); },
    fill: noop, moveTo: noop, lineTo: noop, stroke: noop, clip: noop,
    arc: noop, strokeText: noop, drawImage: noop, setLineDash: noop,
    translate: noop, scale: noop, rotate: noop,
    fillText(s) { textCalls.push(String(s)); },
    // 近似等宽字体：字宽约 0.6em，跟随当前 ctx.font 的像素大小（比固定 6px/字更接近真实）
    measureText(s) {
      const m = /(\d+(?:\.\d+)?)px/.exec(String(ctx.font));
      const em = m ? parseFloat(m[1]) : 10;
      return { width: String(s).length * em * 0.6 };
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4).fill(128) }),
    putImageData: noop,
  };
  return ctx;
}

/* ---------- 临时静态服务 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
let server = null;
let baseUrl = pathToFileURL(resolve(ROOT, 'index.html')).href;
try {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/index.html';
} catch (_) {
  server = null;
}
const httpMode = baseUrl.startsWith('http');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message ? e.message : String(e))));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: baseUrl,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return fakeContext(this); };
    window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgo='; };
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob(['x'], { type: 'image/png' })); };
    window.confirm = () => true;
    window.alert = () => {};
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    // jsdom 不能真的下载，改成记录
    window.HTMLAnchorElement.prototype.click = function () {
      (window.__downloads = window.__downloads || []).push({ filename: this.download, href: String(this.href).slice(0, 24) });
    };
    if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));
  },
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const useTool = (t) => doc.querySelector('[data-tool="' + t + '"]');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => {
  if (doc.readyState === 'complete') r();
  else window.addEventListener('load', r);
});
await tick(80);

console.log('加载方式：' + (httpMode ? '临时 HTTP 服务（localStorage 可用）' : 'file://（localStorage 不可用，验证降级）'));

console.log('\n启动装配');
ok('全部脚本已执行（命名空间齐全）', !!(window.PDColor && window.PDEngine && window.PDEditor && window.PDExport));
ok('index.html 的脚本标签全部被加载', doc.querySelectorAll('script[src]').length === 6, String(doc.querySelectorAll('script[src]').length));
ok('MARD 色卡数据已注入', !!window.PD_MARD && window.PD_MARD.total === 291);
ok('色卡下拉已填充', $('paletteSelect').options.length >= 3, String($('paletteSelect').options.length));
const optCount = +(($('paletteSelect').options[$('paletteSelect').selectedIndex].textContent.match(/（(\d+) 色）/) || [])[1] || 0);
ok('色板格子数 = 当前色卡颜色数', $('swatches').children.length === optCount && optCount > 0, `${$('swatches').children.length} vs ${optCount}`);
ok('缩放标签已显示百分比', /%$/.test($('zoomLabel').textContent), $('zoomLabel').textContent);
ok('尺寸状态栏已填充', /×/.test($('statusSize').textContent), $('statusSize').textContent);
ok('撤销/重做初始禁用', $('btnUndo').disabled === true && $('btnRedo').disabled === true);
ok('空画布给出提示', /空/.test($('countsBody').textContent), $('countsBody').textContent.trim().slice(0, 40));
ok('启动阶段无脚本错误', errors.length === 0, errors.slice(0, 3).join(' || '));

console.log('\n工具与色板交互');
click(useTool('eraser'));
ok('切到橡皮后按钮高亮', useTool('eraser').classList.contains('active'));
click(useTool('brush'));
ok('切回画笔', useTool('brush').classList.contains('active') && !useTool('eraser').classList.contains('active'));
click($('swatches').children[5]);
ok('点色板后当前颜色更新', $('colorCode').textContent !== '—', $('colorCode').textContent);
ok('色板选中态跟随', $('swatches').children[5].classList.contains('sel'));

console.log('\n预览模式（默认只读，不会误触）');
const cv = $('grid');
ok('默认是预览模式', $('statusMode').textContent === '预览模式', $('statusMode').textContent);
ok('默认预览时「编辑」按钮不是激活态', !$('modeEdit').classList.contains('active'));
ok('body 上有 mode-preview 类', doc.body.classList.contains('mode-preview'));
{
  // 在预览模式下手绘：应该一点都画不上去
  const r2 = { left: 0, top: 0, width: 900, height: 700 };
  cv.getBoundingClientRect = () => ({ ...r2, right: r2.width, bottom: r2.height, x: 0, y: 0 });
  const d2 = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 });
  d2.pointerId = 9;
  cv.dispatchEvent(d2);
  const m2 = new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 470, clientY: 350 });
  m2.pointerId = 9;
  cv.dispatchEvent(m2);
  const u2 = new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 470, clientY: 350 });
  u2.pointerId = 9;
  cv.dispatchEvent(u2);
  await tick(30);
  ok('预览模式下拖拽画布不会画出任何豆子', +$('totalBeads').textContent === 0, $('totalBeads').textContent);
  ok('预览模式下撤销按钮是禁用的', $('btnUndo').disabled === true);

  // 编辑类按钮点了要给出明确提示
  click($('btnRotate'));
  await tick(20);
  ok('预览模式点旋转会提示先切编辑', /预览模式/.test($('toastHost').textContent), $('toastHost').textContent.trim().slice(0, 40));
}

console.log('\n切到编辑模式');
click($('modeEdit'));
await tick(30);
ok('切到编辑后状态栏显示编辑模式', $('statusMode').textContent === '编辑模式', $('statusMode').textContent);
ok('切到编辑后 body 类切换', doc.body.classList.contains('mode-edit') && !doc.body.classList.contains('mode-preview'));
ok('切到编辑后「编辑」按钮激活', $('modeEdit').classList.contains('active'));
ok('切到编辑后编辑类按钮显示出来', window.getComputedStyle($('btnUndo')).display !== 'none');

console.log('\n网格编辑（模拟鼠标绘制）');
const rect = { left: 0, top: 0, width: 900, height: 700 };
cv.getBoundingClientRect = () => ({ ...rect, right: rect.width, bottom: rect.height, x: 0, y: 0 });
const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 });
down.pointerId = 1;
cv.dispatchEvent(down);
const mv = new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 460, clientY: 340 });
mv.pointerId = 1;
cv.dispatchEvent(mv);
const up = new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 460, clientY: 340 });
up.pointerId = 1;
cv.dispatchEvent(up);
await tick(30);
ok('手绘后出现用量行', $('countsBody').querySelectorAll('tr').length > 0, $('countsBody').textContent.trim().slice(0, 40));
ok('手绘后撤销按钮启用', $('btnUndo').disabled === false);
ok('总豆数 ≥ 1', +$('totalBeads').textContent >= 1, $('totalBeads').textContent);
click($('btnUndo'));
await tick(20);
ok('撤销回到空画布', /空/.test($('countsBody').textContent), $('countsBody').textContent.trim().slice(0, 40));
click($('btnRedo'));
await tick(20);
ok('重做恢复笔迹', $('countsBody').querySelectorAll('tr').length > 0);

console.log('\n示例图案 · 变换 · 清单');
click($('btnDemo'));
await tick(30);
const rowsAfterDemo = $('countsBody').querySelectorAll('tr').length;
ok('示例图案载入并统计', rowsAfterDemo > 0, String(rowsAfterDemo));
ok('总豆数 = 116（爱心格子数）', +$('totalBeads').textContent === 116, $('totalBeads').textContent);
click($('btnRotate'));
await tick(20);
ok('旋转 90° 后尺寸互换', /16 × 16/.test($('statusSize').textContent), $('statusSize').textContent);
click($('btnTrim'));
await tick(20);
ok('裁掉空白边后总豆数不变', +$('totalBeads').textContent === 116, $('totalBeads').textContent);
click($('btnClear'));
await tick(20);
ok('清空后画布为空', /空/.test($('countsBody').textContent));
click($('btnDemo'));
await tick(30);

console.log('\n库存与差额');
const stockInput = $('countsBody').querySelector('input.stock');
ok('清单里有库存输入框', !!stockInput);
if (stockInput) {
  stockInput.value = '10';
  stockInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(10);
  const need = +stockInput.closest('tr').getAttribute('data-count');
  const diff = +stockInput.closest('tr').querySelector('.diff').textContent;
  ok('差额 = 需求量 − 库存', diff === Math.max(0, need - 10), `${need} - 10 = ${diff}`);
}
$('stockOnly').checked = true;
$('stockOnly').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(10);
ok('「只看缺货」过滤生效', $('countsBody').querySelectorAll('tr').length <= rowsAfterDemo);
$('stockOnly').checked = false;
$('stockOnly').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(10);

console.log('\n导出');
const downloads = [];
window.PDExport.download = (blob, filename) => { downloads.push({ blob, filename }); };
click($('btnExportCsv'));
await tick(10);
ok('清单导出触发下载', downloads.length === 1 && /雪王拼豆-用豆清单-.*\.csv$/.test(downloads[0].filename), downloads.map((d) => d.filename).join(','));
let csv = '';
let csvBytes = null;
try {
  csvBytes = new Uint8Array(await downloads[0].blob.arrayBuffer());
  csv = new TextDecoder().decode(csvBytes);
} catch (_) { csv = ''; }
ok('CSV 以 UTF-8 BOM 开头（Excel 打开不乱码）',
  !!csvBytes && csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF,
  csvBytes ? Array.from(csvBytes.slice(0, 3)).map((b) => b.toString(16)).join(' ') : 'no bytes');
ok('CSV 有表头', csv.includes('色号,名称,HEX,数量,库存,差额'));
ok('CSV 行数 = 颜色数 + 表头 + 合计', csv.trim().split(/\r?\n/).length === +$('totalColors').textContent + 2, String(csv.trim().split(/\r?\n/).length));
ok('CSV 含合计数', csv.includes('合计') && csv.includes('116'), csv.trim().split(/\r?\n/).pop());
try {
  const g = window.PDEngine.imageToGrid({ naturalWidth: 24, naturalHeight: 16, width: 24, height: 16 }, {
    gridW: 16, gridH: 12, palette: window.PDColor.getBuiltinPalettes()[0],
    dither: true, transparent: true, alphaThreshold: 16, maxColors: 6,
    brightness: 110, contrast: 105, saturation: 120,
  });
  ok('imageToGrid 全链路（抖动+限色+透明）可运行', g.w === 16 && g.h === 12 && g.cells.length === 192, `${g.w}×${g.h}`);
} catch (e) {
  ok('imageToGrid 全链路可运行', false, e.message);
}
try {
  click($('btnPrint'));
  await tick(600);
  ok('打印流程调用了 window.print', (window.__printed || 0) >= 1, String(window.__printed));
  ok('打印页包含图纸与图例', /<img/.test($('printSheet').innerHTML) && /class="legend"/.test($('printSheet').innerHTML));
  ok('打印元信息标出 1:1 实际尺寸', /1:1/.test($('printSheet').innerHTML), '未找到 1:1');
} catch (e) {
  ok('打印流程无异常', false, e.message);
}
try {
  click($('btnExportPng'));
  await tick(60);
  const png = (window.__downloads || []).find((d) => /雪王拼豆-图纸-.*\.png$/.test(d.filename));
  ok('导出 PNG 触发下载且文件名正确', !!png, JSON.stringify(window.__downloads));
  ok('导出 PNG 无异常', errors.length === 0, errors.slice(-2).join(' || '));
} catch (e) {
  ok('导出 PNG 无异常', false, e.message);
}

console.log('\n自动保存与色卡自定义');
await tick(1200);   // 自动保存有 900ms 防抖
if (httpMode) {
  const raw = window.localStorage.getItem('pindou.autosave.v1');
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { /* ignore */ }
  ok('自动保存写入了 localStorage', !!(parsed && parsed.grid && parsed.grid.h === 16), raw ? raw.slice(0, 50) : 'null');
  ok('设置已持久化', !!window.localStorage.getItem('pindou.settings.v1'));
} else {
  ok('无 localStorage 时降级不报错', errors.length === 0, errors.slice(-2).join(' || '));
  ok('降级时提示用户手动保存', /导出项目/.test($('saveState').textContent), $('saveState').textContent);
}
$('customPaletteText').value = 'M1,#FF0000,红\nM2,#00FF00,绿\nM3,#0000FF,蓝';
click($('btnApplyPalette'));
await tick(30);
ok('应用自定义色卡后色板变为 3 色', $('swatches').children.length === 3, String($('swatches').children.length));
ok('自定义色卡进入下拉列表', /自定义|色卡/.test($('paletteSelect').options[$('paletteSelect').selectedIndex].textContent));
click($('btnResetPalette'));
await tick(20);
ok('重置自定义色卡后回到内置色卡', $('swatches').children.length > 3, String($('swatches').children.length));

console.log('\nMARD 真实色卡与大色板');
const mardOpt = [...$('paletteSelect').options].find((o) => /MARD 标准 221/.test(o.textContent));
const mard291Opt = [...$('paletteSelect').options].find((o) => /MARD 完整 291/.test(o.textContent));
ok('下拉里有 MARD 标准 221 色', !!mardOpt, [...$('paletteSelect').options].map((o) => o.textContent).join(' | '));
ok('下拉里有 MARD 完整 291 色', !!mard291Opt);
$('paletteSelect').value = mardOpt.value;
$('paletteSelect').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(60);
ok('切到 MARD 221 后色板渲染 221 个色块', $('swatches').children.length === 221, String($('swatches').children.length));
ok('色板计数显示 221 色', /221/.test($('swatchCount').textContent), $('swatchCount').textContent);
ok('显示数据来源与「屏幕色≠实物色」提示', !$('paletteNote').hidden && /webfem/.test($('paletteNote').textContent) && /实物/.test($('paletteNote').textContent), $('paletteNote').textContent.slice(0, 60));
ok('色块带 MARD 官方色号（A01…）', $('swatches').children[0].getAttribute('data-code') === 'A01', $('swatches').children[0].getAttribute('data-code'));
ok('切换色卡时清空了筛选框', $('swatchFilter').value === '');
$('swatchFilter').value = '浅黄';
$('swatchFilter').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(20);
const visible = [...$('swatches').children].filter((el) => el.style.display !== 'none');
ok('按 MARD 色名筛选可用', visible.length > 0 && visible.length < 221, String(visible.length));
ok('筛选后计数正确', $('swatchCount').textContent.includes('匹配 ' + visible.length), $('swatchCount').textContent);
ok('筛选命中的都带「浅黄」', visible.every((el) => el.getAttribute('data-name').indexOf('浅黄') >= 0),
  visible.slice(0, 3).map((el) => el.getAttribute('data-name')).join(','));
$('swatchFilter').value = 'B05';
$('swatchFilter').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(10);
ok('可以按 MARD 色号精确筛选', $('swatchCount').textContent.includes('匹配 1') &&
  [...$('swatches').children].filter((el) => el.style.display !== 'none')[0].getAttribute('data-code') === 'B05',
  [...$('swatches').children].filter((el) => el.style.display !== 'none').map((el) => el.getAttribute('data-code')).join(','));
$('swatchFilter').value = 'zzz没有这个色';
$('swatchFilter').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(10);
ok('筛不到时给出提示', /没有匹配/.test($('swatchCount').textContent), $('swatchCount').textContent);
$('swatchFilter').value = '';
$('swatchFilter').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(10);
ok('清空筛选后恢复 221 色', [...$('swatches').children].filter((el) => el.style.display !== 'none').length === 221);

/* 切到 291 色完整库 */
$('paletteSelect').value = mard291Opt.value;
$('paletteSelect').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(60);
ok('切到 MARD 291 后色板渲染 291 个色块', $('swatches').children.length === 291, String($('swatches').children.length));
ok('291 色卡里有扩展系列（ZG 珠光）',
  [...$('swatches').children].some((el) => el.getAttribute('data-code') === 'ZG1'));
ok('「最多颜色数」上限已放宽到 999', +$('maxColors').getAttribute('max') >= 999, $('maxColors').getAttribute('max'));
$('maxColors').value = '300';
$('maxColors').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(10);
ok('可以填 300 而不被截断', $('maxColors').value === '300');
$('paletteSelect').value = mardOpt.value;
$('paletteSelect').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(30);
click($('btnDemo'));
await tick(40);
ok('在 MARD 色卡上也能生成图案', +$('totalBeads').textContent === 116, $('totalBeads').textContent);
ok('用豆清单用的是 MARD 色号', /[A-HM]\d{2}/.test($('countsBody').textContent), $('countsBody').textContent.trim().slice(0, 60));
ok('用豆清单未因大色卡报错', errors.length === 0, errors.slice(-2).join(' || '));
try {
  window.localStorage.setItem('pindou.autosave.v1', '');
} catch (_) { /* ignore */ }

console.log('\n格子里画色号 + 高亮预览');
/* 单独建一个编辑器实例，直接检查 canvas 绘制调用（比截图断言可靠） */
const scratch = doc.createElement('canvas');
$('canvasWrap').appendChild(scratch);
const ed = new window.PDEditor(scratch);
const mard221 = window.PDColor.getBuiltinPalettes().find((p) => p.id === 'mard221');
const idxOf = (code) => mard221.colors.findIndex((c) => c.code === code);
const iA01 = idxOf('A01'), iA02 = idxOf('A02'), iM09 = idxOf('M09');
ok('测试用色号都能在 MARD 221 里找到', iA01 >= 0 && iA02 >= 0 && iM09 >= 0, [iA01, iA02, iM09].join(','));
ed.grid = window.PDEngine.newGrid(6, 4, -1);
ed.grid.cells[0] = iA01;
ed.grid.cells[1] = iA02;
ed.grid.cells[6] = iM09;
ed.grid.cells[7] = iM09;
ed.setPalette(mard221);
ed.resize();
const z = 22;
ed.view.zoom = z;
ed.view.ox = 30; ed.view.oy = 30;
ed.opts.codes = true;
textCalls.length = 0;
fillRectCalls.length = 0;
ed.render();
ok('格子里画出了 MARD 色号（A01 / A02 / M09）',
  textCalls.includes('A01') && textCalls.includes('A02') && textCalls.includes('M09'),
  Array.from(new Set(textCalls)).join(','));
ok('只给有豆子的格子画色号（空格子不画）', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length === 4,
  String(textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length));
ok('标尺上也正常画了数字', textCalls.some((t) => /^\d+$/.test(t)));

/* 格子太小时不硬塞（宁可省略也不要糊成一团） */
textCalls.length = 0;
ed.view.zoom = 5;
ed.render();
ok('缩小到格子放不下时不画色号', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length === 0,
  Array.from(new Set(textCalls)).slice(0, 6).join(','));

/* 关掉开关就不画 */
ed.opts.codes = false;
textCalls.length = 0;
ed.view.zoom = z;
ed.render();
ok('关掉「显示色号」后一个字都不画', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length === 0);

/* 高亮：压暗遮罩 + 只点亮目标色 */
ed.opts.codes = true;
ed.setHighlight(iM09);
ok('高亮状态已记录', ed.highlight === iM09, String(ed.highlight));
textCalls.length = 0;
fillRectCalls.length = 0;
ed.render();
const veil = fillRectCalls.filter((c) => /rgba\(8, ?11, ?17/.test(c.fillStyle));
ok('高亮时画了压暗遮罩', veil.length === 1, String(fillRectCalls.length) + ' 次 fillRect');
ok('遮罩盖住整个图纸区域', veil.length === 1 && Math.round(veil[0].w) === 6 * z && Math.round(veil[0].h) === 4 * z,
  veil.length ? veil[0].w + 'x' + veil[0].h : 'none');
ok('高亮时只标目标色的色号', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).every((t) => t === 'M09') &&
  textCalls.filter((t) => t === 'M09').length === 2,
  Array.from(new Set(textCalls)).join(','));
ed.setHighlight(-1);
ok('取消高亮后状态复位', ed.highlight === -1);
fillRectCalls.length = 0;
ed.render();
ok('取消高亮后不再画遮罩', fillRectCalls.filter((c) => /rgba\(8, ?11, ?17/.test(c.fillStyle)).length === 0);
ok('越界的高亮下标会被忽略', (() => { ed.setHighlight(99999); const r = ed.highlight === -1; ed.setHighlight(-1); return r; })());

/* 界面开关 */
ok('「显示色号」默认是开着的', $('optCodes').checked === true);
ok('「高亮当前色」默认关着', $('optHighlight').checked === false);
click($('swatches').children[3]);
await tick(20);
$('optHighlight').checked = true;
$('optHighlight').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(20);
ok('打开高亮后色号标签提示「高亮中」', /高亮中/.test($('colorCode').textContent), $('colorCode').textContent);
$('optHighlight').checked = false;
$('optHighlight').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(20);
ok('关掉高亮后提示消失', !/高亮中/.test($('colorCode').textContent), $('colorCode').textContent);

console.log('\n界面无 emoji 检查');
/* 只查真正的 emoji 码位；排印箭头 → 和数学符号不算 emoji */
const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2460}-\u{24FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;
const uiText = doc.body.textContent + ' ' + [...doc.querySelectorAll('[title], [placeholder]')]
  .map((el) => (el.getAttribute('title') || '') + (el.getAttribute('placeholder') || '')).join(' ');
const foundEmoji = [...new Set([...uiText].filter((ch) => emojiRe.test(ch)))];
ok('界面文案里没有 emoji', foundEmoji.length === 0, foundEmoji.join(' '));
ok('工具按钮用文字而不是图标',
  ['brush', 'eraser', 'picker', 'fill'].every((t) => /[\u4e00-\u9fff]/.test(doc.querySelector('[data-tool="' + t + '"]').textContent)),
  [...doc.querySelectorAll('[data-tool]')].map((b) => b.textContent).join('/'));

console.log('\n品牌与 PWA');
ok('页面标题是雪王拼豆', /雪王拼豆/.test(doc.title), doc.title);
ok('顶栏品牌名是雪王拼豆', doc.querySelector('.brand h1').textContent === '雪王拼豆', doc.querySelector('.brand h1').textContent);
ok('顶栏 logo 用的是图标文件', /assets\/icon\.svg$/.test(doc.querySelector('.brand .logo').getAttribute('src')), doc.querySelector('.brand .logo').getAttribute('src'));
ok('引用了 manifest', !!doc.querySelector('link[rel="manifest"]'));
ok('有 apple-touch-icon（iOS 加桌面用）', /assets\/apple-touch-icon\.png$/.test((doc.querySelector('link[rel="apple-touch-icon"]') || {}).getAttribute?.('href') || ''));
ok('有 theme-color', /^#/.test((doc.querySelector('meta[name="theme-color"]') || {}).getAttribute?.('content') || ''));
ok('有 apple-mobile-web-app-capable（iOS 全屏）', (doc.querySelector('meta[name="apple-mobile-web-app-capable"]') || {}).getAttribute?.('content') === 'yes');
ok('viewport 带 viewport-fit=cover（刘海屏）', /viewport-fit=cover/.test((doc.querySelector('meta[name="viewport"]') || {}).getAttribute?.('content') || ''));

console.log('\n手机 / 平板布局');

// 生成区：默认展开，点标题能折叠
ok('有手机生成区', !!$('mobileGen'));
ok('生成区默认展开', !$('mobileGen').classList.contains('collapsed'));
click($('mgToggle'));
await tick(30);
ok('点标题后生成区收起', $('mobileGen').classList.contains('collapsed'));
ok('收起后 aria-expanded=false', $('mgToggle').getAttribute('aria-expanded') === 'false');
click($('mgToggle'));
await tick(30);
ok('再点一次能展开', !$('mobileGen').classList.contains('collapsed'));

// 镜像控件：改手机上的宽度，侧边栏那份要跟着变
$('gridWM').value = '29';
$('gridWM').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(30);
ok('手机改宽度会同步到侧边栏', $('gridW').value === '29', 'gridW=' + $('gridW').value);
$('gridW').value = '58';
$('gridW').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(30);
ok('侧边栏改宽度会同步回手机', $('gridWM').value === '58', 'gridWM=' + $('gridWM').value);
$('maxColorsM').value = '12';
$('maxColorsM').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(30);
ok('手机改最多颜色数会同步', $('maxColors').value === '12', 'maxColors=' + $('maxColors').value);

// 生成后焦点行为：窄屏才收起+滚动，桌面端不动
ok('预览区存在', !!$('previewArea'));

console.log('\n预览区色块清单');
{
  // 先放一张有内容的图
  window.__loadGridForTest((() => {
    const g = window.PDEngine.newGrid(3, 2, -1);
    g.cells[0] = iA01; g.cells[1] = iA01; g.cells[2] = iM09;
    return g;
  })());
  await tick(40);
  const chips = $('chipList').querySelectorAll('.pchip');
  ok('色块清单渲染出来了', chips.length === 2, chips.length + ' 个色块');
  ok('色块显示用量数字', /\d/.test(chips[0].textContent), chips[0].textContent);
  ok('色块里有色号', /[A-Za-z]|\d/.test(chips[0].querySelector('b').textContent), chips[0].querySelector('b').textContent);
  ok('统计了用色种数', $('chipCount').textContent === '2', $('chipCount').textContent);
  ok('统计了总豆数', +$('chipTotal').textContent.replace(/\D/g, '') === 3, $('chipTotal').textContent);

  // 点色块 → 高亮
  const firstIdx = +chips[0].dataset.idx;
  click(chips[0]);
  await tick(30);
  ok('点色块后选中该颜色', window.PDEditor && doc.querySelector('.pchip.active') !== null, '');
  ok('点色块后高亮生效', doc.querySelector('.pchip.active').dataset.idx === String(firstIdx));
  ok('点色块后画布进入高亮态', $('optHighlight').checked === true);

  // 再点一次取消
  click(doc.querySelector('.pchip.active'));
  await tick(30);
  ok('再点一次取消高亮', !$('optHighlight').checked);
}

{
  const pal = mard221;
  const grid = window.PDEngine.newGrid(4, 3, -1);
  grid.cells[0] = iA01;
  grid.cells[1] = iM09;
  const counts = window.PDEngine.countUsage(grid.cells, pal);
  textCalls.length = 0;
  const bigCanvas = window.PDExport.patternCanvas({ grid, palette: pal, counts, cell: 30, codes: true, ruler: true });
  const bigCodes = Array.from(new Set(textCalls.filter((t) => /^[A-Z]+\d+$/.test(t))));
  ok('格距够大时导出图上写完整色号', bigCodes.includes('A01') && bigCodes.includes('M09'), bigCodes.join(','));
  ok('导出返回了 canvas', !!bigCanvas && typeof bigCanvas.width === 'number');

  textCalls.length = 0;
  window.PDExport.patternCanvas({ grid, palette: pal, counts, cell: 13, codes: true, ruler: true });
  const midText = textCalls.filter((t) => !/^\d+$/.test(t) && /^[A-Z0-9]+$/.test(t) && t.length <= 3);
  ok('格距中等时仍然写得出色号（完整或缩短，不能出现半截乱码）',
    midText.includes('A01') || midText.includes('01'), Array.from(new Set(midText)).join(',') + ' | ' + Array.from(new Set(textCalls)).join(','));

  textCalls.length = 0;
  window.PDExport.patternCanvas({ grid, palette: pal, counts, cell: 8, codes: true, ruler: true });
  ok('格距过小时干脆不写色号（不糊成一团）', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length === 0);

  // 缩短路径：格子只放得下数字时，写数字而不是写半截色号
  textCalls.length = 0;
  window.PDExport.patternCanvas({ grid, palette: pal, counts, cell: 11, codes: true, ruler: true });
  const shrunk = Array.from(new Set(textCalls)).filter((t) => /^\d{2}$/.test(t));
  ok('缩短时只写数字、不写字母（不会出现只剩字母的残码）',
    textCalls.every((t) => !/^[A-Z]+$/.test(t)),
    Array.from(new Set(textCalls)).join(',') + (shrunk.length ? ' 缩短为：' + shrunk.join(',') : '（该字号下完整色号放得下）'));

  textCalls.length = 0;
  window.PDExport.patternCanvas({ grid, palette: pal, counts, cell: 30, codes: false, ruler: true });
  ok('关掉色号后导出图不写色号', textCalls.filter((t) => /^[A-Z]+\d+$/.test(t)).length === 0);
}

console.log('\n用豆清单点行高亮');
{
  // 造一个多色图案（示例爱心只有一色，测不到「换行」）
  const g2 = window.PDEngine.newGrid(6, 4, -1);
  for (let i = 0; i < 6; i++) g2.cells[i] = 0;
  for (let i = 6; i < 18; i++) g2.cells[i] = 5;
  for (let i = 18; i < 24; i++) g2.cells[i] = 12;
  // 通过应用自己的入口载入，才能触发清单刷新
  window.__loadGridForTest(g2);
  await tick(60);
  const rows = [...$('countsBody').querySelectorAll('tr.count-row')];
  ok('清单行带上了调色板下标', rows.length === 3 && rows.every((r) => r.getAttribute('data-idx') !== null), String(rows.length));
  ok('清单行初始没有高亮标记', rows.every((r) => !r.classList.contains('active')));
  ok('清单行提示可点击', /点击高亮/.test(rows[0].getAttribute('title') || ''), rows[0].getAttribute('title'));

  const target = rows[0];
  const idx = +target.getAttribute('data-idx');
  click(target);
  await tick(40);
  ok('点清单行后选中了该颜色', +$('countsBody').querySelector('tr.count-row.active').getAttribute('data-idx') === idx);
  ok('点清单行后自动打开高亮开关', $('optHighlight').checked === true);
  ok('点清单行后行本身有 active 样式', target.classList.contains('active'));
  ok('点清单行后色号标签提示「高亮中」', /高亮中/.test($('colorCode').textContent), $('colorCode').textContent);
  ok('点清单行后弹出了提示', /高亮/.test($('toastHost').textContent), $('toastHost').textContent.trim().slice(0, 40));

  // 再点同一行 = 取消高亮
  click(target);
  await tick(40);
  ok('再点同一行取消高亮', $('optHighlight').checked === false);
  ok('取消后没有行处于 active', !$('countsBody').querySelector('tr.count-row.active'));
  ok('取消后「高亮中」提示消失', !/高亮中/.test($('colorCode').textContent), $('colorCode').textContent);

  // 点另一行 = 换到那个色
  const other = rows[1];
  click(other);
  await tick(40);
  ok('点另一行换到那个颜色高亮',
    +$('countsBody').querySelector('tr.count-row.active').getAttribute('data-idx') === +other.getAttribute('data-idx'));
  ok('只有一行处于 active', $('countsBody').querySelectorAll('tr.count-row.active').length === 1);

  // 连点两行：高亮必须跟着最后点的那行走，不能两行都亮
  click(rows[2]);
  await tick(40);
  ok('连续点不同行后只有最后点的行亮着', $('countsBody').querySelectorAll('tr.count-row.active').length === 1);

  // 通过色卡面板换色时，清单高亮也要跟着走
  click($('swatches').children[5]);
  await tick(30);
  const act = $('countsBody').querySelector('tr.count-row.active');
  ok('改选色卡颜色后，清单高亮同步到新颜色', !act || +act.getAttribute('data-idx') === 5,
    act ? act.getAttribute('data-idx') : '（该色图里没用到）');
  $('optHighlight').checked = false;
  $('optHighlight').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(20);
  ok('关掉开关后清单高亮也清掉', !$('countsBody').querySelector('tr.count-row.active'));

  // 点库存输入框是在填数字，不该顺手把高亮切掉
  $('optHighlight').checked = true;
  $('optHighlight').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(20);
  const hlIdx = +$('countsBody').querySelector('tr.count-row.active').getAttribute('data-idx');
  const inputRow = [...$('countsBody').querySelectorAll('tr.count-row')][1];
  click(inputRow.querySelector('input.stock'));
  await tick(30);
  ok('点库存输入框不会误触高亮切换',
    +$('countsBody').querySelector('tr.count-row.active').getAttribute('data-idx') === hlIdx,
    String(hlIdx));
}

console.log('\n去四周背景按钮');
{
  // 四周一圈背景 + 中间主体，中间的连接部分夹在背景之间
  const W = 12, H = 10;
  const mk = () => {
    const cells2 = new Int16Array(W * H).fill(-1);
    const put = (r, c, v) => { cells2[r * W + c] = v; };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r < 2 || r > 7 || c < 2 || c > 9) put(r, c, 0);
    for (let r = 2; r < 4; r++) for (let c = 4; c < 8; c++) put(r, c, 3);   // 头
    for (let c = 5; c < 7; c++) put(4, c, 3);                                // 脖子（连接部分）
    for (let r = 5; r < 8; r++) for (let c = 3; c < 9; c++) put(r, c, 3);   // 身体
    return { w: W, h: H, cells: cells2 };
  };
  window.__loadGridForTest(mk());
  await tick(50);

  ok('去背景按钮存在', !!$('btnDropBg'));
  const total0 = +$('totalBeads').textContent;
  const color0 = $('totalColors').textContent;
  click($('btnDropBg'));
  await tick(50);
  ok('点按钮后弹出了结果提示', /背景/.test($('toastHost').textContent), $('toastHost').textContent.trim().slice(0, 50));
  ok('四周背景被清掉（豆子总数减少）', +$('totalBeads').textContent < total0,
    total0 + ' → ' + $('totalBeads').textContent);
  ok('背景色从清单里消失（只剩主体色）', $('totalColors').textContent === '1',
    color0 + ' → ' + $('totalColors').textContent);
  ok('剩下的全是主体色号', (() => {
    const codes = [...$('countsBody').querySelectorAll('tr.count-row')].map((r) => r.getAttribute('data-idx'));
    return codes.length === 1;
  })(), $('countsBody').textContent.trim().slice(0, 40));

  // 撤销要能还原
  click($('btnUndo'));
  await tick(50);
  ok('撤销可以还原去背景', +$('totalBeads').textContent === total0 && $('totalColors').textContent === color0,
    total0 + '/' + color0 + ' → ' + $('totalBeads').textContent + '/' + $('totalColors').textContent);

  // 整块同色：可以整体清掉
  window.__loadGridForTest({ w: 4, h: 4, cells: new Int16Array(16).fill(0) });
  await tick(40);
  click($('btnDropBg'));
  await tick(40);
  ok('整块同色时按预期清空', +$('totalBeads').textContent === 0, $('totalBeads').textContent);

  // 空画布点按钮：给提示，不崩
  window.__loadGridForTest({ w: 4, h: 4, cells: new Int16Array(16).fill(-1) });
  await tick(40);
  click($('btnDropBg'));
  await tick(40);
  ok('空画布点去背景给出提示且不报错', /空/.test($('toastHost').textContent) && errors.length === 0,
    errors.length ? errors.slice(-1)[0] : $('toastHost').textContent.trim().slice(0, 30));

  // 生成时的「去掉四周背景」开关要真的生效
  ok('生成面板上有去背景开关', !!$('dropBg'));
  window.__loadGridForTest(mk());
  await tick(40);
  $('dropBg').checked = true;
  $('dropBg').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(450);   // 设置是防抖保存的，要等过防抖窗口
  ok('去背景开关会写进设置', (() => {
    try { return JSON.parse(window.localStorage.getItem('pindou.settings.v1') || '{}').dropBg === true; }
    catch (_) { return false; }
  })(), (() => { try { return window.localStorage.getItem('pindou.settings.v1'); } catch (_) { return 'n/a'; } })());
  $('dropBg').checked = false;
  await tick(20);
}

console.log('\n双指缩放（触屏手势）');
{
  const cv2 = $('grid');
  const rect2 = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
  cv2.getBoundingClientRect = () => rect2;
  const pe = (type, id, x, y) => {
    const ev = new window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    ev.pointerId = id;
    return ev;
  };
  const ed = window.__editorForTest;
  ok('能拿到编辑器实例', !!ed, typeof ed);

  if (ed) {
    // 先装一个够大的网格，免得 fit() 直接把缩放顶到上限，就测不出「放大」了
    ed.replaceGrid({ w: 60, h: 40, cells: new Int16Array(60 * 40).fill(-1) }, { label: 'pinch' });
    ed.fit(); ed.requestRender();
    await tick(20);
    const z0 = ed.view.zoom;
    ok('初始缩放没顶到上限（否则测不出放大）', z0 < 40, 'zoom=' + z0);

    // 两根手指从相距 100 拉开到 300 → 应该放大
    cv2.dispatchEvent(pe('pointerdown', 11, 350, 300));
    cv2.dispatchEvent(pe('pointerdown', 12, 450, 300));
    await tick(20);
    ok('两指按下后进入手势态', !!ed._pinch);
    cv2.dispatchEvent(pe('pointermove', 11, 250, 300));
    cv2.dispatchEvent(pe('pointermove', 12, 550, 300));
    await tick(20);
    const z1 = ed.view.zoom;
    ok('两指分开 → 放大', z1 > z0, z0.toFixed(2) + ' → ' + z1.toFixed(2));

    cv2.dispatchEvent(pe('pointermove', 11, 380, 300));
    cv2.dispatchEvent(pe('pointermove', 12, 420, 300));
    await tick(20);
    const z2 = ed.view.zoom;
    ok('两指捏合 → 缩小', z2 < z1, z1.toFixed(2) + ' → ' + z2.toFixed(2));

    // 疯狂捏合不能把缩放压到 0 或负数（变异测试发现这里原本没有测试）
    for (let i = 0; i < 12; i++) {
      cv2.dispatchEvent(pe('pointermove', 11, 399, 300));
      cv2.dispatchEvent(pe('pointermove', 12, 401, 300));
    }
    await tick(20);
    ok('极限捏合后缩放有下限（不会变 0/负数）', ed.view.zoom >= 0.4, 'zoom=' + ed.view.zoom);

    for (let i = 0; i < 12; i++) {
      cv2.dispatchEvent(pe('pointermove', 11, -5000, 300));
      cv2.dispatchEvent(pe('pointermove', 12, 9000, 300));
    }
    await tick(20);
    ok('极限拉开后缩放有上限', ed.view.zoom <= 40, 'zoom=' + ed.view.zoom);

    cv2.dispatchEvent(pe('pointerup', 11, -5000, 300));
    await tick(20);
    ok('松开一根手指后仍能继续平移（不会突然跳）', ed.panning === null && ed.dragging === null,
      'panning=' + ed.panning + ' dragging=' + ed.dragging);
    ok('松开一根手指后不会进入绘制态', ed.dragging === null);
    cv2.dispatchEvent(pe('pointerup', 12, 9000, 300));
    await tick(20);
    ok('两指都松开后手势完全结束', !ed._pinch && !ed._gestureUsed,
      'pinch=' + ed._pinch + ' gestureUsed=' + ed._gestureUsed);

    // 三指乱按：手势只认最先按下的两根，不该跳
    ed.fit(); await tick(20);
    const z3a = ed.view.zoom;
    cv2.dispatchEvent(pe('pointerdown', 41, 300, 300));
    cv2.dispatchEvent(pe('pointerdown', 42, 500, 300));
    await tick(20);
    cv2.dispatchEvent(pe('pointerdown', 43, 400, 500));   // 第三根
    await tick(20);
    ok('三指按下时手势仍锁定前两根', (ed._gestureIds || []).length === 2, JSON.stringify(ed._gestureIds));
    cv2.dispatchEvent(pe('pointermove', 41, 250, 300));
    cv2.dispatchEvent(pe('pointermove', 42, 550, 300));
    cv2.dispatchEvent(pe('pointermove', 43, 900, 900));   // 第三根乱动
    await tick(20);
    ok('第三根手指乱动不会把缩放弄乱', ed.view.zoom > z3a && ed.view.zoom <= 40,
      z3a.toFixed(2) + ' → ' + ed.view.zoom.toFixed(2));
    cv2.dispatchEvent(pe('pointerup', 41, 250, 300));
    cv2.dispatchEvent(pe('pointerup', 42, 550, 300));
    cv2.dispatchEvent(pe('pointerup', 43, 900, 900));
    await tick(20);
    ok('三指全部松开后手势彻底清理', !ed._pinch && !ed._gestureUsed && !ed._gestureIds,
      'pinch=' + ed._pinch + ' used=' + ed._gestureUsed + ' ids=' + ed._gestureIds);

    // 预览模式下双指缩放不能改图
    // 注意：前面的用例把界面切到了编辑模式，这里必须显式切回预览，否则测的是另一回事
    click($('modePreview'));
    await tick(30);
    ok('已切回预览模式再测', ed.preview === true, 'preview=' + ed.preview);
    // 先放点真实内容进去，否则全是空格子，"没被改" 就没有说服力
    ed.replaceGrid((() => {
      const g = window.PDEngine.newGrid(60, 40, -1);
      for (let i = 0; i < 40; i++) g.cells[i] = iA01;
      return g;
    })(), { label: 'pinch2' });
    await tick(20);
    ok('测试前网格确实有内容', ed.grid.cells.filter((v) => v >= 0).length === 40,
      ed.grid.cells.filter((v) => v >= 0).length + ' 个非空格');
    const before = ed.grid.cells.slice();
    cv2.dispatchEvent(pe('pointerdown', 21, 300, 300));
    cv2.dispatchEvent(pe('pointerdown', 22, 500, 300));
    cv2.dispatchEvent(pe('pointermove', 21, 200, 300));
    cv2.dispatchEvent(pe('pointermove', 22, 600, 300));
    cv2.dispatchEvent(pe('pointerup', 21, 200, 300));
    cv2.dispatchEvent(pe('pointerup', 22, 600, 300));
    await tick(20);
    let same = before.length === ed.grid.cells.length;
    let firstDiff = -1;
    for (let i = 0; same && i < before.length; i++) {
      if (before[i] !== ed.grid.cells[i]) { same = false; firstDiff = i; }
    }
    ok('预览模式下双指缩放不会改到图案', same,
      same ? '' : '第 ' + firstDiff + ' 格 ' + before[firstDiff] + ' → ' + ed.grid.cells[firstDiff]);
    ok('预览模式下双指缩放不会改到图案（数量也没变）',
      ed.grid.cells.filter((v) => v >= 0).length === 40,
      ed.grid.cells.filter((v) => v >= 0).length + ' 个非空格');

    // 编辑模式下双指缩放同样只缩放，不该顺手画上一笔
    click($('modeEdit'));
    await tick(30);
    ok('已切到编辑模式', ed.preview === false);
    const beforeE = ed.grid.cells.slice();
    cv2.dispatchEvent(pe('pointerdown', 31, 300, 300));
    cv2.dispatchEvent(pe('pointerdown', 32, 500, 300));
    cv2.dispatchEvent(pe('pointermove', 31, 200, 300));
    cv2.dispatchEvent(pe('pointermove', 32, 600, 300));
    cv2.dispatchEvent(pe('pointerup', 31, 200, 300));
    cv2.dispatchEvent(pe('pointerup', 32, 600, 300));
    await tick(20);
    let sameE = beforeE.length === ed.grid.cells.length;
    for (let i = 0; sameE && i < beforeE.length; i++) if (beforeE[i] !== ed.grid.cells[i]) sameE = false;
    ok('编辑模式下双指缩放也不会顺手画上一笔', sameE, '被改了');
    click($('modePreview'));
    await tick(20);
  }
}

ok('全程无累积脚本错误', errors.length === 0, errors.slice(0, 5).join(' || '));

console.log('\n=== 结果 ===');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (errors.length) errors.slice(0, 8).forEach((e) => console.log(' ! ' + e));
if (fails.length) {
  fails.forEach((f) => console.log(' ✗ ' + f));
  window.close();
  if (server) server.close();
  process.exit(1);
}
console.log('✅ DOM 装配测试全部通过');
window.close();
if (server) server.close();
