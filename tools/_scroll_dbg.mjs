import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = await import('file:///E:/dsh/DSH%20Desktop/resources/app/node_modules/jsdom/lib/api.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  try { s.writeHead(200, { 'Content-Type': MIME[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream' }); s.end(readFileSync(resolve(ROOT, rel))); }
  catch (_) { s.writeHead(404); s.end(''); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:' + server.address().port + '/index.html',
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w) {
    const n = () => {};
    w.HTMLCanvasElement.prototype.getContext = function () {
      return { setTransform:n, resetTransform:n, clearRect:n, fillRect:n, strokeRect:n, save:n, restore:n,
        beginPath:n, closePath:n, rect:n, fill:n, moveTo:n, lineTo:n, stroke:n, clip:n, arc:n, fillText:n,
        strokeText:n, drawImage:n, setLineDash:n, translate:n, scale:n, rotate:n,
        measureText:(s)=>({width:String(s).length*6}), createLinearGradient:()=>({addColorStop:n}),
        getImageData:(x,y,ww,hh)=>({width:ww,height:hh,data:new Uint8ClampedArray(ww*hh*4)}), putImageData:n };
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  },
});
const { window } = dom, doc = window.document;
await new Promise((r) => setTimeout(r, 900));
const $ = (i) => doc.getElementById(i);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

click($('btnDemo')); await tick(400);
click($('btnChipBall')); await tick(80);
const host = $('chipList');
host.scrollTop = 120;
console.log('设 scrollTop=120 后读出:', host.scrollTop);
console.log('色块数:', doc.querySelectorAll('#chipList .pchip').length);

console.log('\n--- 点 btnUndo ---');
console.log('btnUndo 存在?', !!$('btnUndo'), ' disabled?', $('btnUndo') && $('btnUndo').disabled);
click($('btnUndo')); await tick(300);
console.log('undo 后 scrollTop:', host.scrollTop, ' 色块数:', doc.querySelectorAll('#chipList .pchip').length);

console.log('\n--- 改宽高重新生成（颜色集合必然变）---');
$('gridW').value = 8; $('gridH').value = 8;
click($('btnDemo')); await tick(300);
console.log('再次 demo 后 scrollTop:', host.scrollTop, ' 色块数:', doc.querySelectorAll('#chipList .pchip').length);

window.close(); server.close();
