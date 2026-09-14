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
const watch = ['chip', 'chip-panel', 'chip-head', 'chip-list', 'chip-tip',
               'pchip', 'pchip-sw',
               'mobile-gen', 'mg-head', 'mg-title', 'mg-body', 'mg-caret', 'mg-drop',
               'preview-area', 'pinch-hint'];

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

// 响应式必须真的切换：竖屏上下排 / 横屏左右排
console.log('\n=== 横竖屏规则 ===');
const portrait = /\.preview-area \{ flex-direction: column; \}/.test(css);
const landscape = /orientation: landscape/.test(css) && /\.preview-area \{ flex-direction: row; \}/.test(css);
console.log((portrait ? '  ✓ ' : '  ✗ ') + '竖屏：预览区上下排（色块在下方）');
console.log((landscape ? '  ✓ ' : '  ✗ ') + '横屏：预览区左右排（色块在右侧）');
if (!portrait || !landscape) bad++;

console.log('\n' + (bad ? '✗ ' + bad + ' 项有问题' : '✓ 类名与横竖屏规则全部正确'));
process.exitCode = bad ? 1 : 0;
