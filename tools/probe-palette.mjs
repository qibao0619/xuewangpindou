import '../js/palettes/mard.js';
import '../js/palette.js';
import '../js/engine.js';
const C = globalThis.PDColor, E = globalThis.PDEngine;

let t0 = performance.now();
const pals = C.getBuiltinPalettes();
console.log('生成内置色卡耗时 ' + (performance.now() - t0).toFixed(1) + ' ms');
for (const p of pals) console.log('  ' + p.name + ' → ' + p.colors.length + ' 色' + (p.source ? '（数据源：' + p.source + '）' : ''));

const wide = pals.find((p) => p.id === 'mard291') || pals[0];
console.log('重复 HEX 数: ' + (wide.colors.length - new Set(wide.colors.map((c) => c.hex)).size));
console.log('色号示例: ' + wide.colors.slice(0, 3).map((c) => c.code + '/' + c.hex + '/' + c.name).join('  ') +
  ' … ' + wide.colors.slice(-3).map((c) => c.code + '/' + c.hex + '/' + c.name).join('  '));

function seeded(n) { let s = 12345; const out = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const a = s % 256; s = (s * 1103515245 + 12345) & 0x7fffffff; const b = s % 256; s = (s * 1103515245 + 12345) & 0x7fffffff; out.push([a, b, s % 256]); } return out; }
const probes = seeded(4000).map((rgb) => C.rgbToLab(rgb[0], rgb[1], rgb[2]));
for (const p of pals) {
  let sum = 0, max = 0;
  for (const lab of probes) {
    const d = Math.sqrt(C.deltaE2(lab, p.colors[C.nearestLab(lab, p)].lab));
    sum += d; if (d > max) max = d;
  }
  console.log(`${p.name}: 平均 ΔE=${(sum / probes.length).toFixed(2)}  最大 ΔE=${max.toFixed(2)}`);
}

const px = new Uint8ClampedArray(200 * 200 * 4);
let s = 999;
for (let i = 0; i < 200 * 200; i++) {
  s = (s * 1103515245 + 12345) & 0x7fffffff; px[i * 4] = s % 256;
  s = (s * 1103515245 + 12345) & 0x7fffffff; px[i * 4 + 1] = s % 256;
  s = (s * 1103515245 + 12345) & 0x7fffffff; px[i * 4 + 2] = s % 256;
  px[i * 4 + 3] = 255;
}
for (const p of pals) {
  t0 = performance.now();
  const c1 = E.quantize(px, 200, 200, p, {});
  const t1 = performance.now();
  E.quantize(px, 200, 200, p, { dither: true });
  const t2 = performance.now();
  console.log(`${p.name}（${p.colors.length} 色）: 普通 ${(t1 - t0).toFixed(0)}ms / 抖动 ${(t2 - t1).toFixed(0)}ms，实际用到 ${new Set(Array.from(c1)).size} 色`);
}
