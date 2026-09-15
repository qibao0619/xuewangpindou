/** 验证单文件版能真正跑起来（不是只把代码拼在一起）。 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'dist/雪王拼豆-单文件版.html');
const html = readFileSync(FILE, 'utf8');

const jsdomMod = await import('file:///E:/dsh/DSH%20Desktop/resources/app/node_modules/jsdom/lib/api.js').catch(() => null);
if (!jsdomMod) { console.log('没有 jsdom，跳过'); process.exit(0); }
const { JSDOM } = jsdomMod;

const errors = [];
const dom = new JSDOM(html, {
  url: 'https://example.invalid/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
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
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e.error)));
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 900));

function ok(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  → ' + (extra === undefined ? '' : String(extra).slice(0, 160))));
  if (!cond) errors.push(name);
}

console.log('=== 单文件版冒烟 ===');
ok('页面标题是雪王拼豆', /雪王拼豆/.test(doc.title), doc.title);
ok('品牌名已改', doc.querySelector('.brand h1').textContent === '雪王拼豆', doc.querySelector('.brand h1').textContent);
ok('logo 用的是内联图标', /^data:image\/svg\+xml;base64,/.test(doc.querySelector('.brand .logo').getAttribute('src')));
ok('favicon 是内联 data URI', /^data:image\/png;base64,/.test(doc.querySelector('link[rel="icon"][type="image/png"]').getAttribute('href')));
ok('没有残留外部 script/link', doc.querySelectorAll('script[src], link[rel="stylesheet"]').length === 0,
  doc.querySelectorAll('script[src], link[rel="stylesheet"]').length);
ok('没有 manifest（单文件版不需要）', !doc.querySelector('link[rel="manifest"]'));

// 核心引擎真的初始化了
ok('PDEngine 已加载', typeof window.PDEngine === 'object' && window.PDEngine !== null);
ok('PDColor 已加载', typeof window.PDColor === 'object');
ok('PDEditor 已加载', typeof window.PDEditor === 'function', typeof window.PDEditor);
const pals = window.PDColor.getBuiltinPalettes();
ok('内置色卡可用', Array.isArray(pals) && pals.length >= 5, pals && pals.length);
ok('默认色卡是 MARD 221', pals[0].id === 'mard221', pals[0].id);
ok('MARD 色卡有 221 色', pals[0].colors.length === 221, pals[0].colors.length);

// 界面初始化
ok('默认是预览模式', doc.getElementById('statusMode').textContent === '预览模式', doc.getElementById('statusMode').textContent);
ok('色板渲染出来了', doc.getElementById('swatches').children.length > 0, doc.getElementById('swatches').children.length);
ok('模式按钮已移除（改用 P 键切换）', !doc.getElementById('modeEdit') && !doc.getElementById('modePreview'));
ok('转图纸在工具栏里', !!doc.getElementById('btnMake') && !!doc.getElementById('btnMake').closest('.stage-toolbar'));
ok('侧边栏按钮存在', !!doc.getElementById('btnSidebar'));

// 点一下示例图案，确认交互链路通
doc.getElementById('btnDemo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
const rows = doc.getElementById('countsBody').querySelectorAll('tr').length;
ok('点示例图案后清单出现用量行', rows > 0, rows);
ok('总豆数 > 0', +doc.getElementById('totalBeads').textContent > 0, doc.getElementById('totalBeads').textContent);

const realErrors = errors.filter((e) => !/^window\.error: null/.test(e));
console.log('\n' + (realErrors.length ? '✗ 失败 ' + realErrors.length + ' 项' : '✓ 全部通过') + '（脚本错误 ' + realErrors.length + ' 条）');
if (realErrors.length) realErrors.forEach((e) => console.log('   ' + e));
window.close();
process.exit(realErrors.length ? 1 : 0);
