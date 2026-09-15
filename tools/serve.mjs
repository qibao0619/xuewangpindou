/* 极简静态服务器（零依赖）：npm run serve 后浏览器打开 http://127.0.0.1:5179/
 * 用 http 打开时 localStorage 一定可用（file:// 下部分浏览器会禁用自动保存）。
 * 默认监听 0.0.0.0，方便手机上用同一个 WiFi 直接访问调试。 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5179);
// 手机默认按 LAN 访问更方便；想只在本机跑就设 HOST=127.0.0.1
const HOST = process.env.HOST || '0.0.0.0';
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

server.listen(PORT, HOST, () => {
  console.log('雪王拼豆已启动');
  console.log('');
  console.log('  电脑上打开： http://127.0.0.1:' + PORT + '/');
  // 找出局域网 IP，手机直接照着输
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push({ name, address: ni.address });
    }
  }
  if (ips.length) {
    console.log('');
    console.log('  手机上打开（要连同一个 WiFi）：');
    for (const ip of ips) console.log('    http://' + ip.address + ':' + PORT + '/    ← ' + ip.name);
    if (process.env.HOST === '127.0.0.1') {
      console.log('    （当前 HOST=127.0.0.1，手机连不上；去掉这个变量即可）');
    }
  } else {
    console.log('  （没找到局域网 IP，手机可能连不上）');
  }
  console.log('');
  console.log('  Ctrl+C 停止');
});
