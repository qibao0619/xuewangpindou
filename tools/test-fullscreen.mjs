/**
 * 全屏预览测试：直接加载真实页面，模拟点按钮 / 双击 / Esc，
 * 检查 body 上的 fs-on 类、退出按钮的显隐、以及「编辑模式双击不该进全屏」。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = await import('file:///E:/dsh/DSH%20Desktop/resources/app/node_modules/jsdom/lib/api.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = resolve(ROOT, rel);
  res.writeHead(200, { 'Content-Type': MIME[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

const errors = [];
const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    const noop = () => {};
    const fake = (canvas) => ({
      canvas, filter: 'none',
      setTransform: noop, resetTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
      save: noop, restore: noop, beginPath: noop, closePath: noop, rect: noop, fill: noop,
      moveTo: noop, lineTo: noop, stroke: noop, clip: noop, arc: noop, fillText: noop,
      strokeText: noop, drawImage: noop, setLineDash: noop, translate: noop, scale: noop, rotate: noop,
      measureText: (s) => ({ width: String(s).length * 6 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: noop,
    });
    window.HTMLCanvasElement.prototype.getContext = function () { return fake(this); };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));
  },
});

const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 900));
doc.addEventListener('error', (e) => errors.push('jsdomError: ' + (e.message || e)));

let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info ? ' → ' + info : '')); }
};
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** 切到指定模式。原来工具栏上有「预览/编辑」按钮，现在只剩 P 键开关，
 *  所以这里按当前状态决定要不要按 —— 要的是「结果确定」，不是「按一下就翻面」。 */
function setModeFor(win, doc, want) {
  const isEdit = doc.body.classList.contains('mode-edit');
  if ((want === 'edit') !== isEdit) {
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
  }
}

const dbl = (el) => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

console.log('=== 全屏：基础开关 ===');
ok('有「全屏」按钮', !!$('btnFullscreen'));
ok('有「退出全屏」按钮', !!$('btnExitFullscreen'));
ok('退出按钮默认隐藏', $('btnExitFullscreen').hidden === true);
ok('初始不在全屏', !doc.body.classList.contains('fs-on'));

click($('btnFullscreen'));
await tick(150);
ok('点全屏按钮 → body 带 fs-on', doc.body.classList.contains('fs-on'));
ok('点全屏按钮 → 退出按钮出现', $('btnExitFullscreen').hidden === false);
ok('全屏时画布提示隐藏逻辑存在', !!doc.querySelector('.fs-tip'));

click($('btnExitFullscreen'));
await tick(150);
ok('点退出 → fs-on 移除', !doc.body.classList.contains('fs-on'));
ok('点退出 → 退出按钮又藏起来', $('btnExitFullscreen').hidden === true);

console.log('\n=== 全屏：Esc 退出 ===');
click($('btnFullscreen'));
await tick(120);
ok('先进入全屏', doc.body.classList.contains('fs-on'));
key('Escape');
await tick(120);
ok('按 Esc 能退出全屏', !doc.body.classList.contains('fs-on'));

console.log('\n=== 全屏：双击画布 ===');
setModeFor(window, doc, 'preview');
await tick(80);
dbl($('canvasWrap'));
await tick(150);
ok('预览模式下双击画布 → 进全屏', doc.body.classList.contains('fs-on'));
dbl($('canvasWrap'));
await tick(150);
ok('再双击 → 退出全屏', !doc.body.classList.contains('fs-on'));

console.log('\n=== 全屏：编辑模式下双击不该触发 ===');
setModeFor(window, doc, 'edit');
await tick(120);
dbl($('canvasWrap'));
await tick(150);
ok('编辑模式下双击画布：不会误进全屏', !doc.body.classList.contains('fs-on'),
  '（编辑模式双击是画两格，不是切全屏）');
setModeFor(window, doc, 'preview');
await tick(80);

console.log('\n=== 全屏：手机上双击（两次快速 touchend）===');
{
  const cv = $('canvasWrap');
  const t = (x, y) => {
    const ev = new window.Event('touchend', { bubbles: true, cancelable: true });
    ev.changedTouches = [{ clientX: x, clientY: y, identifier: 1 }];
    ev.touches = [];
    return ev;
  };
  cv.dispatchEvent(t(300, 300));
  await tick(60);
  cv.dispatchEvent(t(302, 301));
  await tick(150);
  ok('手机双击（touchend ×2）能进全屏', doc.body.classList.contains('fs-on'));
  cv.dispatchEvent(t(300, 300));
  await tick(60);
  cv.dispatchEvent(t(301, 300));
  await tick(150);
  ok('手机再双击能退出全屏', !doc.body.classList.contains('fs-on'));

  // 两次点得离得远 = 不是双击
  cv.dispatchEvent(t(100, 100));
  await tick(60);
  cv.dispatchEvent(t(500, 400));
  await tick(150);
  ok('两次点得离得远不算双击', !doc.body.classList.contains('fs-on'));
}

console.log('\n=== 全屏：状态一致性 ===');
{
  click($('btnFullscreen'));
  await tick(120);
  const n = errors.length;
  // 在全屏里做缩放、点色块，不应该报错
  click($('zoomIn'));
  await tick(60);
  click($('zoomFit'));
  await tick(60);
  const chips = doc.querySelectorAll('.pchip');
  if (chips.length) click(chips[0]);
  await tick(60);
  ok('全屏下缩放/高亮不报错', errors.length === n, errors.slice(n).join(' || '));
  key('Escape');
  await tick(120);
  ok('Esc 后状态干净', !doc.body.classList.contains('fs-on'));
}

console.log('\n=== 手机上编辑功能不可达 ===');
{
  // jsdom 的 innerWidth 默认 1024（会被当成宽屏），改成手机宽度再走一遍切编辑的路径。
  const origW = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
  window.dispatchEvent(new window.Event('resize'));
  await tick(120);

  setModeFor(window, doc, 'preview');
  await tick(80);
  ok('手机宽度下不会进入编辑模式', !doc.body.classList.contains('mode-edit'));

  // 原来这里点的是工具栏的「编辑」按钮，按钮已经移除，
  // 改成直接按 P 键尝试切进去 —— 手机上必须被拦住。
  key('p');
  await tick(80);
  ok('手机宽度下按 P 也切不进去编辑', !doc.body.classList.contains('mode-edit'),
    'body class = ' + doc.body.className.trim());

  key('p');
  await tick(80);
  ok('再按一次 P 依然进不去编辑', !doc.body.classList.contains('mode-edit'));

  key('b'); key('e');
  await tick(60);
  ok('编辑类快捷键不报错', !doc.body.classList.contains('mode-edit'));

  Object.defineProperty(window, 'innerWidth', { value: origW, configurable: true, writable: true });
  window.dispatchEvent(new window.Event('resize'));
  await tick(80);
}

ok('全程无脚本错误', errors.length === 0, errors.slice(0, 4).join(' || '));

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过（' + pass + ' 项）'));
window.close();
server.close();
process.exitCode = fail ? 1 : 0;
