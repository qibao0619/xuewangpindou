/**
 * 把 assets/icon.svg 的图形按像素重画一遍，直接写出 PNG（零依赖）。
 * 之所以不用 SVG 转 PNG 工具：这个环境里没有可用的光栅化器，
 * 而图标本身就是纯几何图形，用超采样重画反而更可控、也不需要外部依赖。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets');

/* ---------- PNG 编码（RGBA，无滤波） ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 矢量图形（和 icon.svg 一致的形状，坐标按 512 画布） ---------- */
const C = 512;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 圆角矩形（含圆角半径）
function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 0.0001;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// 多边形（射线法）
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// 粗折线（用于描边、微笑）
function nearPolyline(x, y, pts, w) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, py = y1 + t * dy;
    if ((x - px) ** 2 + (y - py) ** 2 <= (w / 2) ** 2) return true;
  }
  return false;
}
// 贝塞尔曲线近似成折线（微笑）
function quad(p0, p1, p2, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
              u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}
const smile = quad([214, 334], [256, 372], [298, 334]);

const RED = hex('#E5272E');
const CROWN = hex('#FFD84D');
const CROWN_DK = hex('#8A5A16');
const GEM = hex('#FFF3B0');
const WHITE = hex('#FFFFFF');
const INK = hex('#2A2A2A');
const BLUSH = hex('#FF9AA2');
const NOSE = hex('#FF8A21');
const NOSE_DK = hex('#8A4A06');
const SCARF = hex('#C81E24');
const SCARF_DK = hex('#7A0F14');

const crownPts = [[148, 150], [188, 108], [226, 158], [256, 96], [286, 158], [324, 108], [364, 150], [360, 190], [152, 190]];
const scarfPts = [[150, 372], [256, 416], [362, 372], [366, 410], [256, 458], [146, 410]];
const scarfTail = [[330, 400], [368, 470], [318, 470], [300, 408]];
const nosePts = [[256, 276], [318, 300], [256, 316]];

/** 返回某点的颜色 */
function shade(x, y) {
  let col = null;
  // 底
  if (inRoundRect(x, y, 0, 0, C, C, 112)) col = RED; else return null;
  // 拼豆格点
  const dots = [];
  for (const gy of [64, 424]) for (let i = 0; i < 5; i++) dots.push([64 + i * 88, gy]);
  for (const gx of [64, 416]) for (let i = 1; i < 4; i++) dots.push([gx, 64 + i * 88]);
  for (const [dx, dy] of dots) if (inRoundRect(x, y, dx, dy, 24, 24, 6)) return [255, 255, 255, 0.13];
  // 王冠
  if (inPoly(x, y, crownPts) || nearPolyline(x, y, [...crownPts, crownPts[0]], 9)) {
    return inPoly(x, y, crownPts) ? CROWN : CROWN_DK;
  }
  for (const [gx, gy, gr] of [[256, 88, 15], [188, 104, 12], [324, 104, 12]]) {
    if (inCircle(x, y, gx, gy, gr)) return GEM;
    if (inCircle(x, y, gx, gy, gr + 4)) return CROWN_DK;
  }
  // 雪人头
  if (inCircle(x, y, 256, 278, 126 + 5.5)) {
    if (!inCircle(x, y, 256, 278, 126 - 5.5)) return INK;
    col = WHITE;
    // 五官
    for (const ex of [212, 300]) {
      if (inCircle(x, y, ex, 256, 17)) col = INK;
      if (inCircle(x, y, ex, 256, 17) && inCircle(x, y, ex + 6, 249, 6)) col = WHITE;
    }
    if (inEllipse(x, y, 186, 300, 22, 15) || inEllipse(x, y, 326, 300, 22, 15)) col = BLUSH;
    if (inPoly(x, y, nosePts) || nearPolyline(x, y, [...nosePts, nosePts[0]], 9)) {
      col = inPoly(x, y, nosePts) ? NOSE : NOSE_DK;
    }
    if (nearPolyline(x, y, smile, 11)) col = INK;
    return col;
  }
  // 围巾
  if (inPoly(x, y, scarfPts) || nearPolyline(x, y, [...scarfPts, scarfPts[0]], 9)) {
    return inPoly(x, y, scarfPts) ? SCARF : SCARF_DK;
  }
  if (inPoly(x, y, scarfTail) || nearPolyline(x, y, [...scarfTail, scarfTail[0]], 9)) {
    return inPoly(x, y, scarfTail) ? SCARF : SCARF_DK;
  }
  return col;
}

/** 超采样渲染到 size×size，maskable 时按安全区缩放。
 *  每个子样本要么落在图形外（不计），要么给出一个颜色（可能带 alpha，用于格点叠色）。
 *  先按 alpha 把颜色合成到不透明，再统计覆盖率；覆盖率不足 1 的像素按覆盖率给外部 alpha，
 *  这样圆角外的区域就是真正透明的。 */
function render(size, { pad = 0 } = {}) {
  const SS = 3;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const scale = (C - pad * 2) / C;
  const base = hex('#E5272E');
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = ((px + (sx + 0.5) / SS) / size) * C;
          const fy = ((py + (sy + 0.5) / SS) / size) * C;
          const vx = (fx - C / 2) / scale + C / 2;
          const vy = (fy - C / 2) / scale + C / 2;
          const c = shade(vx, vy);
          if (!c) continue;
          hits++;
          if (c.length === 4) {
            // 半透明格点：按 alpha 叠到红底上
            const al = c[3];
            r += c[0] * al + base[0] * (1 - al);
            g += c[1] * al + base[1] * (1 - al);
            b += c[2] * al + base[2] * (1 - al);
          } else {
            r += c[0]; g += c[1]; b += c[2];
          }
        }
      }
      const n = SS * SS, i = (py * size + px) * 4;
      if (!hits) { rgba[i + 3] = 0; continue; }
      rgba[i] = Math.round(r / hits);
      rgba[i + 1] = Math.round(g / hits);
      rgba[i + 2] = Math.round(b / hits);
      rgba[i + 3] = Math.round((hits / n) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // maskable：Android 会裁成圆形/圆角，内容收进 80% 安全区
  ['icon-maskable-512.png', 512, { pad: 512 * 0.1 }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, o] of jobs) {
  writeFileSync(resolve(OUT, name), render(size, o));
  console.log('写出 ' + name + ' (' + size + '×' + size + ')');
}
