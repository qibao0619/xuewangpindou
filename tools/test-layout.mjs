/**
 * 类名交叉核对：CSS 里写的类，必须真有 HTML 或 JS 在用；
 * 反过来 HTML/JS 用到的布局类，CSS 里也得有规则。
 * 这套东西最容易出的错就是改名时漏改一边（静默失效，界面看着就是"没生效"）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
const js = readFileSync(resolve(ROOT, 'js/app.js'), 'utf8') +
           readFileSync(resolve(ROOT, 'js/editor.js'), 'utf8');

const htmlClasses = new Set(
  (html.match(/class="([^"]+)"/g) || []).flatMap((m) => m.slice(7, -1).split(/\s+/)).filter(Boolean)
);
const jsClasses = new Set(
  [...js.matchAll(/class(?:Name)?\s*=\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
);
const used = new Set([...htmlClasses, ...jsClasses]);

// 只检查我们这次新加/改动的这批，避免把通用类名卷入误报
// （mobile-gen / mg-* 已经随「手机生成区」一起删除，不再列入）
const watch = ['chip', 'chip-panel', 'chip-head', 'chip-list',
               'chip-ball', 'chip-ball-icon', 'chip-ball-count', 'chip-close',
               'pchip', 'pchip-sw',
               'modal', 'modal-box', 'modal-head', 'modal-body', 'modal-foot', 'modal-x', 'modal-thumb',
               'menu-wrap', 'menu-pop', 'menu-item', 'menu-sep',
               'preview-area'];

let bad = 0;
console.log('=== 类名交叉核对 ===');
for (const c of watch) {
  const inCss = new RegExp('\\.' + c + '\\b').test(css);
  const inUse = used.has(c) || js.includes("'" + c + "'") || js.includes('"' + c + '"');
  const ok = inCss && inUse;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.padEnd(14) +
    (inCss ? 'CSS ' : '缺CSS! ') + (inUse ? '在用' : '没人用!'));
}

// 横竖屏必须真的切换，而且要保证手机上「能滚、不被压扁」
console.log('\n=== 手机布局关键规则 ===');
const checks = [
  ['手机放开滚动（否则一屏塞不下会被压扁）',
    /html, body \{ height: auto; min-height: 100%; overflow: visible; \}/.test(css)],
  ['用 dvh 跟地址栏实时变化',
    /100dvh/.test(css)],
  ['手机上 body 改回 block（不再硬撑一屏）',
    /body \{ display: block; \}/.test(css)],
  ['画布有明确可视高度（不靠 flex 抢空间）',
    /\.canvas-wrap \{\s*height: 58vh/.test(css)],
  ['竖屏：预览区改成上下自然排布',
    /\.preview-area \{ display: block; \}/.test(css)],
  ['横屏：画布高度够（色块面板改成悬浮，不再占一列）',
    /orientation: landscape\) and \(min-height: 420px\)[\s\S]{0,300}\.canvas-wrap \{ height: 62/.test(css)],
  ['手机按钮够手指点（>=38px）',
    /\.stage-toolbar \.btn \{\s*min-height: 38px/.test(css)],
  ['顶部吸顶，滚下去还能切模式',
    /\.topbar \{\s*position: sticky; top: 0/.test(css)],
  ['刘海屏留安全区',
    /env\(safe-area-inset-top/.test(css)],
  ['色块面板是悬浮的（不占版面）',
    /\.chip-panel \{\s*position: absolute/.test(css)],
  ['悬浮球固定在预览区右下角',
    /\.chip-ball \{\s*position: absolute; right: 14px; bottom: 14px/.test(css)],
];
for (const [name, pass] of checks) {
  if (!pass) bad++;
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
}

console.log('\n' + (bad ? '✗ ' + bad + ' 项有问题' : '✓ 类名与横竖屏规则全部正确'));
process.exitCode = bad ? 1 : 0;
