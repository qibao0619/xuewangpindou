/* 极简静态服务器（零依赖）：npm run serve 后浏览器打开 http://127.0.0.1:5179/
 * 用 http 打开时 localStorage 一定可用（file:// 下部分浏览器会禁用自动保存）。 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5179);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // PWA 安装要求 manifest 用这个 MIME，否则浏览器不认
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + rel);
    return;
  }
  // Service Worker 必须允许跨源隔离语义下的正常更新，且不能被缓存住
  const headers = {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  };
  if (/[\\/]sw\.js$/.test(file)) headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('雪王拼豆已启动：http://127.0.0.1:' + PORT + '/');
  console.log('手机上访问：把 127.0.0.1 换成电脑的局域网 IP（同一 WiFi 下）');
  console.log('（Ctrl+C 停止）');
});
