/* 雪王拼豆 · Service Worker
 *
 * 目的：装到手机桌面之后即使没网也能打开（PWA 离线可用）。
 * 策略：
 *   - 预缓存 App Shell（html / css / js / 图标），首次访问后即可离线启动；
 *   - 页面导航走「网络优先，失败回退缓存」，这样更新能立刻生效，断网也能开；
 *   - 静态资源走「缓存优先 + 后台更新」，加载快；
 *   - 只缓存同源 GET，不碰其他请求。
 */
const VERSION = 'xuwangpindou-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/palettes/mard.js',
  './js/palette.js',
  './js/engine.js',
  './js/editor.js',
  './js/exporter.js',
  './js/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // 单个文件失败不能让整个安装挂掉（比如某个图标路径写错）
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，断网回退到缓存的 index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(VERSION);
        c.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        const c = await caches.open(VERSION);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 静态资源：缓存优先，同时后台更新
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
