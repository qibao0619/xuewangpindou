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

// 抓出 PDBeads 暴露的 API
let API = null;
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
console.log('1) 滚到 120，色块数 =', doc.querySelectorAll('#chipList .pchip').length);

// 收起再打开 —— 应保留 120
click($('btnChipBall')); await tick(50);
host.scrollTop = 120;
click($('btnChipBall')); await tick(80);
console.log('2) 收起再打开后 =', host.scrollTop, '（期望 120）');

// 真正改变颜色集合：换成不同的色卡 -> 色号变了 -> 指纹变
console.log('\n--- 直接改调色板颜色（模拟换一张图）---');
// 找暴露的 API
console.log('globalThis 上有:', Object.keys(window).filter((k) => /PD|pin/i.test(k)).join(', '));
window.close(); server.close();
