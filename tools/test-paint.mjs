/** 验证"把落笔推迟到确认单指"之后，普通点击/拖拽画线仍然正常工作。 */
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
  },
});
const { window } = dom;
await new Promise((r) => setTimeout(r, 800));
const ed = window.__editorForTest;
const doc = window.document;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const cv = doc.getElementById('grid');
cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
const pe = (t, id, x, y, type) => {
  const e = new window.MouseEvent(t, { bubbles: true, button: 0, clientX: x, clientY: y });
  e.pointerId = id; e.pointerType = type || 'touch';
  return e;
};
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? ' → ' + info : '')); } };

doc.getElementById('modeEdit').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(40);

function fresh() {
  const g = window.PDEngine.newGrid(60, 40, -1);
  ed.replaceGrid(g, { label: 'x' });
  ed.setColor(5);
  ed.fit();
}
const filled = () => ed.grid.cells.filter((v) => v >= 0).length;

console.log('触屏单击（按下即抬起，中间不移动）');
fresh(); await tick(20);
cv.dispatchEvent(pe('pointerdown', 1, 300, 300));
cv.dispatchEvent(pe('pointerup', 1, 300, 300));
await tick(30);
ok('触屏单击会画上一格', filled() === 1, filled() + ' 格');

console.log('\n触屏拖拽画线');
fresh(); await tick(20);
cv.dispatchEvent(pe('pointerdown', 2, 200, 300));
for (let x = 210; x <= 400; x += 10) cv.dispatchEvent(pe('pointermove', 2, x, 300));
cv.dispatchEvent(pe('pointerup', 2, 400, 300));
await tick(30);
const line = filled();
ok('触屏拖拽能画出线（多于 1 格）', line > 1, line + ' 格');

console.log('\n鼠标单击仍然立刻落笔（手感不变）');
fresh(); await tick(20);
cv.dispatchEvent(pe('pointerdown', 3, 300, 300, 'mouse'));
await tick(20);
ok('鼠标按下就落笔（不用等抬起）', filled() === 1, filled() + ' 格');
cv.dispatchEvent(pe('pointerup', 3, 300, 300, 'mouse'));
await tick(20);

console.log('\n鼠标拖拽');
fresh(); await tick(20);
cv.dispatchEvent(pe('pointerdown', 4, 200, 300, 'mouse'));
for (let x = 210; x <= 400; x += 10) cv.dispatchEvent(pe('pointermove', 4, x, 300, 'mouse'));
cv.dispatchEvent(pe('pointerup', 4, 400, 300, 'mouse'));
await tick(30);
ok('鼠标拖拽能画出线', filled() > 1, filled() + ' 格');

console.log('\n橡皮擦仍然能擦');
fresh(); await tick(20);
cv.dispatchEvent(pe('pointerdown', 5, 300, 300, 'mouse'));
cv.dispatchEvent(pe('pointerup', 5, 300, 300, 'mouse'));
await tick(20);
const afterPaint = filled();
doc.querySelector('[data-tool="eraser"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(20);
cv.dispatchEvent(pe('pointerdown', 6, 300, 300, 'mouse'));
cv.dispatchEvent(pe('pointerup', 6, 300, 300, 'mouse'));
await tick(30);
ok('橡皮擦能把刚画的擦掉', filled() < afterPaint, afterPaint + ' → ' + filled());

console.log('\n填充工具');
fresh(); await tick(20);
ed.replaceGrid((() => { const g = window.PDEngine.newGrid(60, 40, -1); return g; })(), { label: 'y' });
await tick(20);
doc.querySelector('[data-tool="fill"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(20);
cv.dispatchEvent(pe('pointerdown', 7, 300, 300, 'mouse'));
cv.dispatchEvent(pe('pointerup', 7, 300, 300, 'mouse'));
await tick(30);
ok('填充能填满整张空图', filled() === 60 * 40, filled() + ' / ' + 60 * 40);

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过') + '（' + pass + ' 项）');
window.close(); server.close();
process.exitCode = fail ? 1 : 0;
