/* 静态自检：语法 + HTML/JS 资源与 DOM id 一致性。
 * 用法：node tools/check.mjs  （在 pindou 目录下执行）
 * 只用 Node 内置模块，不启动子进程。 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* 1. HTML 里的 id */
const ids = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
notes.push(`index.html 定义了 ${ids.size} 个 id`);

/* 2. 引用的本地资源是否存在 */
const refs = [];
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(m[1]);
for (const r of refs) {
  if (/^(https?:|data:|#)/.test(r)) continue;
  if (!existsSync(join(ROOT, r))) problems.push(`index.html 引用了不存在的文件：${r}`);
}

/* 3. JS 语法检查 + 收集 id 用法 */
const jsDir = join(ROOT, 'js');
const jsFiles = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort() : [];
const used = new Map();
for (const f of jsFiles) {
  const src = readFileSync(join(jsDir, f), 'utf8');
  try {
    new vm.Script(src, { filename: f });
  } catch (err) {
    problems.push(`js/${f} 语法错误：${err.message}`);
  }
  for (const m of src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) used.set(m[1], f);
  for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) used.set(m[1], f);
  for (const m of src.matchAll(/\bon\('([A-Za-z0-9_-]+)'/g)) used.set(m[1], f);   // app.js 的 on(id, ev, fn) 助手
  for (const m of src.matchAll(/on\('([A-Za-z0-9_-]+)',/g)) used.set(m[1], f);
}
notes.push(`js 文件 ${jsFiles.length} 个：${jsFiles.join(', ')}`);

/* 4. 脚本加载顺序：palettes/* → palette → engine → editor → exporter → app */
const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const expected = ['palettes/mard.js', 'palette.js', 'engine.js', 'editor.js', 'exporter.js', 'app.js'];
if (order.join(',') !== expected.join(',')) {
  problems.push(`脚本顺序应为 ${expected.join(' → ')}，实际为 ${order.join(' → ')}`);
}

/* 5. app/editor 里用到的 id 必须在 HTML 中存在 */
for (const [id, file] of used) {
  if (!ids.has(id)) problems.push(`js/${file} 使用了不存在的 id：${id}`);
}

/* 7. PWA：manifest 合法、图标都在、sw.js 语法与预缓存清单对得上 */
const mfPath = join(ROOT, 'manifest.webmanifest');
if (!existsSync(mfPath)) problems.push('缺少 manifest.webmanifest（PWA 装到手机桌面需要）');
else {
  let mf = null;
  try { mf = JSON.parse(readFileSync(mfPath, 'utf8')); }
  catch (err) { problems.push(`manifest.webmanifest 不是合法 JSON：${err.message}`); }
  if (mf) {
    for (const k of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'icons']) {
      if (!mf[k]) problems.push(`manifest 缺少字段：${k}`);
    }
    if (mf.display !== 'standalone' && mf.display !== 'fullscreen' && mf.display !== 'minimal-ui') {
      problems.push(`manifest 的 display 应为 standalone/fullscreen/minimal-ui，实际 ${mf.display}`);
    }
    let maskable = 0;
    for (const ic of mf.icons || []) {
      const rel = ic.src.replace(/^\.\//, '');
      if (!existsSync(join(ROOT, rel))) problems.push(`manifest 里的图标不存在：${ic.src}`);
      if (String(ic.purpose || '').includes('maskable')) maskable++;
    }
    if (!maskable) problems.push('manifest 里缺少 maskable 图标（Android 装桌面会被裁得难看）');
    // index.html 引用的 manifest 路径要对
    if (!html.includes('href="manifest.webmanifest"')) problems.push('index.html 没有引用 manifest.webmanifest');
    notes.push(`manifest：${mf.short_name}，${(mf.icons || []).length} 个图标（${maskable} 个 maskable）`);
  }
}

const swPath = join(ROOT, 'sw.js');
if (!existsSync(swPath)) problems.push('缺少 sw.js（离线可用需要）');
else {
  const sw = readFileSync(swPath, 'utf8');
  try { new vm.Script(sw, { filename: 'sw.js' }); }
  catch (err) { problems.push(`sw.js 语法错误：${err.message}`); }
  // 预缓存清单里的文件必须真实存在，否则离线时会缺件
  const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!shellBlock) problems.push('sw.js 里找不到 SHELL 预缓存清单');
  else {
    const items = [...shellBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const missing = items
      .map((u) => u.replace(/^\.\//, ''))
      .filter((u) => u && u !== '' && !existsSync(join(ROOT, u)));
    if (missing.length) problems.push(`sw.js 预缓存了不存在的文件：${missing.join(', ')}`);
    notes.push(`sw.js 预缓存 ${items.length} 项，清单与磁盘一致`);
  }
  // sw.js 必须覆盖 index.html 引用的全部应用文件，否则离线会白屏
  const appFiles = [...html.matchAll(/(?:src|href)="(js\/[^"]+|styles\.css)"/g)].map((m) => m[1]);
  const uncached = appFiles.filter((f) => !sw.includes(f));
  if (uncached.length) problems.push(`sw.js 没有预缓存这些应用文件（离线会加载失败）：${uncached.join(', ')}`);
}

/* 8. CSS 类名抽查：app.js 里动态加的 class 是否有样式（提示级） */
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
for (const cls of ['toast', 'sw', 'sel', 'hover', 'short', 'ok', 'active', 'panning', 'pick']) {
  if (!new RegExp('\\.' + cls + '\\b').test(css)) notes.push(`提示：styles.css 里没找到 .${cls} 规则`);
}
// 布局/响应式类必须有样式，否则会静默失效
for (const cls of ['mode-switch', 'mode-badge', 'scrim', 'sidebar-toggle', 'preview',
                   'mobile-gen', 'preview-area', 'chip-panel', 'pchip', 'pinch-hint', 'mg-body']) {
  if (!new RegExp('\\.' + cls + '\\b').test(css)) problems.push(`styles.css 缺少 .${cls} 规则（布局/响应式会失效）`);
}
const bp = (css.match(/@media \(max-width: \d+px\)/g) || []).length;
if (bp < 2) problems.push(`styles.css 窄屏断点只有 ${bp} 个（手机/平板适配需要至少 2 个）`);
else notes.push(`响应式断点 ${bp} 个`);

/* 9. 图标资源齐不齐 */
for (const f of ['assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
                 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png', 'assets/favicon-32.png']) {
  if (!existsSync(join(ROOT, f))) problems.push(`缺少图标 ${f}（跑 npm run icons 生成）`);
}

/* 10. HTML 中被 JS 引用不到的 id（仅提示，可能是纯样式锚点） */
const unreferenced = [...ids].filter((id) => !used.has(id));
if (unreferenced.length) notes.push(`未被 JS 引用的 id（可能是布局锚点）：${unreferenced.join(', ')}`);

console.log('=== 自检结果 ===');
notes.forEach((n) => console.log('· ' + n));
if (problems.length) {
  console.log('\n❌ 发现 ' + problems.length + ' 个问题：');
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(1);
}
console.log('\n✅ 全部检查通过');
