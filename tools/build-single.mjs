/**
 * 把整个应用打包成「一个 HTML 文件」（CSS/JS/图标全部内联）。
 *
 * 用途：没服务器、也不想用托管时，把这个 HTML 发到手机上直接打开就能用。
 * 注意：file:// 下 Service Worker 不可用（所以单文件版没有离线缓存），
 * 但应用本身功能完全一样 —— 它本来就是纯前端的。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'dist');
const OUT = resolve(OUT_DIR, '雪王拼豆-单文件版.html');

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let html = read('index.html');

// 1) 内联 CSS
html = html.replace(/<link rel="stylesheet" href="styles\.css">/,
  () => '<style>\n' + read('styles.css') + '\n</style>');

// 2) 内联 JS（按顺序），去掉外链 script 标签
const jsFiles = ['js/palettes/mard.js', 'js/palette.js', 'js/engine.js', 'js/editor.js', 'js/exporter.js', 'js/app.js'];
for (const f of jsFiles) {
  const tag = '<script src="' + f + '"></script>';
  if (!html.includes(tag)) { console.error('找不到脚本标签: ' + tag); process.exit(1); }
  html = html.replace(tag, () => '<script>\n/* ===== ' + f + ' ===== */\n' + read(f) + '\n</script>');
}

// 3) 图标内联成 data URI
html = html.replace(/href="assets\/([a-z0-9-]+\.(?:png|svg))"/g, (m, name) => {
  const p = resolve(ROOT, 'assets', name);
  if (!existsSync(p)) return m;
  const b64 = readFileSync(p).toString('base64');
  const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return 'href="data:' + mime + ';base64,' + b64 + '"';
});
html = html.replace(/src="assets\/([a-z0-9-]+\.(?:png|svg))"/g, (m, name) => {
  const p = resolve(ROOT, 'assets', name);
  if (!existsSync(p)) return m;
  const b64 = readFileSync(p).toString('base64');
  const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return 'src="data:' + mime + ';base64,' + b64 + '"';
});

// 4) 单文件版没有 manifest / sw（相对路径在 file:// 下无意义）
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script>\s*\/\/ 注册 Service Worker[\s\S]*?<\/script>\n?/,
  '<script>/* 单文件版：无 Service Worker（file:// 下不可用，功能不受影响）*/</script>\n');

// 5) 标题标注单文件版
html = html.replace('<title>雪王拼豆 · 图片转拼豆图纸</title>',
  '<title>雪王拼豆 · 图片转拼豆图纸（单文件版）</title>');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('已生成 ' + OUT);
console.log('大小 ' + kb + ' KB，无外部依赖（CSS/JS/图标全部内联）');
if (/src="js\/|href="styles\.css|href="assets\//.test(html)) {
  console.log('警告：仍存在未内联的外部引用');
  const left = html.match(/(?:src|href)="(?!data:|#|https?:)[^"]+"/g) || [];
  console.log('  残留: ' + [...new Set(left)].join(', '));
  process.exit(1);
}
console.log('校验通过：没有任何外部文件引用');
