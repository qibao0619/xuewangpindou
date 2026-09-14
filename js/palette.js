/* 雪王拼豆 · 颜色工具与色卡
 * 提供：sRGB↔Lab 转换、色差、最近色查找、内置色卡、自定义色卡解析。 */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- HEX / RGB ---------- */

  function hexToRgb(hex) {
    let h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /* ---------- Lab ---------- */

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
    const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /* 平方 CIE76 色差：只用于比较大小，省一次开方 */
  function deltaE2(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }

  function luma(rgb) { return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; }

  /* ---------- HSL（用于生成通用色卡） ---------- */

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
  }

  /* ---------- 色卡对象 ---------- */

  function makeColor(code, hex, name) {
    const rgb = hexToRgb(hex);
    if (!rgb) throw new Error('无效颜色值：' + hex);
    return { code: String(code), name: String(name == null ? '' : name), hex: rgbToHex(rgb[0], rgb[1], rgb[2]), rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) };
  }

  function makePalette(id, name, colors) {
    return { id, name, colors, _labs: colors.map((c) => c.lab) };
  }

  function paletteLabs(palette) {
    if (!palette._labs || palette._labs.length !== palette.colors.length) {
      palette._labs = palette.colors.map((c) => c.lab);
    }
    return palette._labs;
  }

  /* 在色卡里找最接近 lab 的颜色下标 */
  function nearestLab(lab, palette) {
    const labs = paletteLabs(palette);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const d = deltaE2(lab, labs[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function nearestRgb(rgb, palette) {
    return nearestLab(rgbToLab(rgb[0], rgb[1], rgb[2]), palette);
  }

  /* ---------- 内置色卡 ---------- */

  const B_24 = [
    ['A01', '#FFFFFF', '白'], ['A02', '#F3EADA', '米白'], ['A03', '#CFCFCF', '浅灰'],
    ['A04', '#8E8E8E', '灰'], ['A05', '#4A4A4A', '深灰'], ['A06', '#111111', '黑'],
    ['A07', '#F6C9A8', '肤色'], ['A08', '#F8C7D8', '浅粉'], ['A09', '#EE5F8B', '粉红'],
    ['A10', '#E03A2F', '大红'], ['A11', '#96181F', '深红'], ['A12', '#F58220', '橙'],
    ['A13', '#FBB03B', '橘黄'], ['A14', '#F6E84A', '柠檬黄'], ['A15', '#A8D95F', '浅绿'],
    ['A16', '#3FA047', '草绿'], ['A17', '#1D6B3B', '深绿'], ['A18', '#12A195', '青绿'],
    ['A19', '#7EC8F0', '天蓝'], ['A20', '#2050D8', '蓝'], ['A21', '#1B2E6E', '深蓝'],
    ['A22', '#C3A4E1', '浅紫'], ['A23', '#7B4EA8', '紫'], ['A24', '#8A5A2B', '棕'],
    ['A25', '#3C7BD6', '中蓝'], ['A26', '#D6318F', '玫红'],
  ];

  /* ---------- 全色系色卡（自动生成）----------
   * 用「最远点贪心」（k-center 的 2 近似）在 Lab 空间里把色域铺匀：
   * 每一步都挑「离已选颜色最远」的候选，所以覆盖比手挑色更均匀。
   * 算法是确定性的：同样参数永远得到同样的色卡，色号可复现。 */

  const WIDE_VARIANTS = [
    [0.3, 0.95], [0.55, 0.92], [0.8, 0.88], [1, 0.8],
    [0.95, 0.7], [1, 0.6], [0.95, 0.52], [0.92, 0.44],
    [0.86, 0.36], [0.8, 0.28], [0.72, 0.2], [0.6, 0.12],
  ];

  const LAB_HUE_NAMES = [
    [15, '红'], [45, '橙'], [70, '黄'], [100, '黄绿'], [150, '绿'], [175, '青绿'],
    [205, '青'], [250, '蓝'], [285, '蓝紫'], [320, '紫'], [345, '品红'], [361, '玫红'],
  ];

  function labHueDeg(lab) {
    let deg = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  function labHueName(lab) {
    const deg = labHueDeg(lab);
    for (let i = 0; i < LAB_HUE_NAMES.length; i++) {
      if (deg < LAB_HUE_NAMES[i][0]) return LAB_HUE_NAMES[i][1];
    }
    return '红';
  }

  function labLightWord(L) {
    if (L >= 88) return '极浅';
    if (L >= 74) return '浅';
    if (L >= 60) return '亮';
    if (L >= 46) return '';
    if (L >= 32) return '深';
    if (L >= 20) return '暗';
    return '黑';
  }

  /** 生成 target 色的全色系色卡，色号 F001… */
  function buildWidePalette(target) {
    target = Math.max(8, Math.round(target || 221));
    const cands = [];
    const seen = new Set();
    const push = (rgb) => {
      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      if (seen.has(hex)) return;
      seen.add(hex);
      cands.push({ rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) });
    };
    for (let h = 0; h < 360; h += 3) {
      for (let v = 0; v < WIDE_VARIANTS.length; v++) push(hslToRgb(h, WIDE_VARIANTS[v][0], WIDE_VARIANTS[v][1]));
    }
    for (let i = 0; i <= 40; i++) { const v = Math.round(255 * i / 40); push([v, v, v]); }
    if (cands.length < target) throw new Error('候选颜色不足，无法生成 ' + target + ' 色色卡');

    const dist = new Float64Array(cands.length).fill(Infinity);
    const chosen = [];
    const take = (idx) => {
      chosen.push(idx);
      const lab = cands[idx].lab;
      for (let i = 0; i < cands.length; i++) {
        const d = deltaE2(cands[i].lab, lab);
        if (d < dist[i]) dist[i] = d;
      }
    };
    let wi = 0, bi = 0;
    for (let i = 0; i < cands.length; i++) {
      if (cands[i].lab[0] > cands[wi].lab[0]) wi = i;
      if (cands[i].lab[0] < cands[bi].lab[0]) bi = i;
    }
    take(wi);   // 纯白
    take(bi);   // 纯黑
    while (chosen.length < target) {
      let best = -1, bestD = -1;
      for (let i = 0; i < cands.length; i++) {
        if (dist[i] > bestD) { bestD = dist[i]; best = i; }
      }
      if (best < 0 || bestD <= 0) break;
      take(best);
    }

    const picked = chosen.map((i) => {
      const c = cands[i];
      return { rgb: c.rgb, lab: c.lab, chroma: Math.sqrt(c.lab[1] * c.lab[1] + c.lab[2] * c.lab[2]) };
    });
    // 排序：灰阶（低彩度）在前按明度，其余按 Lab 色相再按明度 —— 方便在色板里找
    picked.sort((a, b) => {
      const ag = a.chroma < 6 ? 0 : 1, bg = b.chroma < 6 ? 0 : 1;
      if (ag !== bg) return ag - bg;
      if (ag === 0) return a.lab[0] - b.lab[0];
      const dh = labHueDeg(a.lab) - labHueDeg(b.lab);
      if (Math.abs(dh) > 0.5) return dh;
      return a.lab[0] - b.lab[0];
    });
    return picked.map((c, i) => {
      const code = 'F' + String(i + 1).padStart(3, '0');
      const name = c.chroma < 6 ? '灰阶 ' + (i + 1) : labLightWord(c.lab[0]) + labHueName(c.lab);
      return makeColor(code, rgbToHex(c.rgb[0], c.rgb[1], c.rgb[2]), name);
    });
  }

  /* ---------- MARD 真实色卡（由 tools/build-palette-data.mjs 生成）----------
   * 色号、色名、色值都来自 MARD 色号表，不是我们编的：出图上的色号可以直接照着买豆。
   * 注意 HEX 只是屏幕近似值，实物受光线/批次影响，最终以实物色卡为准。 */
  function buildMardPalette(id, name, scope, data) {
    const colors = [];
    for (const g of Object.keys(data.groups)) {
      const isStandard = data.standardGroups.indexOf(g) >= 0;
      if (scope === 'standard' && !isStandard) continue;
      for (const row of data.groups[g]) colors.push(makeColor(row[0], row[1], row[2] || ''));
    }
    const p = makePalette(id, name, colors);
    p.source = data.source;
    p.sourceTitle = data.title;
    p.sourceUpdated = data.updated;
    p.seriesNames = data.seriesNames;
    p.brand = 'MARD';
    return p;
  }

  function getMardData() {
    const data = (typeof globalThis !== 'undefined' && globalThis.PD_MARD) || null;
    if (!data || !data.groups || !data.standardGroups) return null;
    // 数据文件是按系列分组、组内按色号顺序写的；拼起来后按色号自然序重排，便于查找
    const seq = (code) => {
      const m = /^([A-Z]+)0*(\d+)$/.exec(code);
      return m ? [m[1], +m[2]] : [code, 0];
    };
    Object.keys(data.groups).forEach((g) => data.groups[g].sort((a, b) => seq(a[0])[1] - seq(b[0])[1]));
    return data;
  }

  function getBuiltinPalettes() {
    const wide = buildWidePalette(221);
    const mard = getMardData();
    const out = [];
    if (mard) {
      out.push(buildMardPalette('mard221', 'MARD 标准 221 色', 'standard', mard));
      out.push(buildMardPalette('mard291', 'MARD 完整 291 色（含扩展系列）', 'full', mard));
    }
    out.push(
      makePalette('common24', '新手常用色卡（非品牌）', B_24.map((c) => makeColor(c[0], c[1], c[2]))),
      makePalette('full221', '通用全色系 221 色（非品牌）', wide),
      makePalette('bw', '黑白灰 8 色', (() => {
        const out = [];
        for (let i = 0; i < 8; i++) {
          const v = Math.round(255 * i / 7);
          out.push(makeColor('K' + (i + 1), rgbToHex(v, v, v), i === 0 ? '白' : i === 7 ? '黑' : '灰' + i));
        }
        return out;
      })()),
    );
    return out;
  }

  /* ---------- 自定义色卡解析 ----------
   * 支持：
   *   文本：每行 `色号,HEX,名称`（逗号 / 制表符 / 空格分隔，HEX 必须带 #）
   *   文本：每行 `HEX`（自动编号）
   *   JSON：[{code,hex,name}] 或 {"name":..,"colors":[...]} 或 ["#fff", ...] */
  function parsePaletteText(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('内容为空');
    let name = '自定义色卡';
    let list = null;

    if (raw[0] === '[' || raw[0] === '{') {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) list = data;
      else {
        if (data.name) name = String(data.name);
        list = data.colors || data.palette || null;
      }
      if (!Array.isArray(list)) throw new Error('JSON 里找不到颜色数组（colors / palette）');
      list = list.map((it, i) => {
        if (typeof it === 'string') return makeColor(String(i + 1).padStart(2, '0'), it, '');
        const hex = it.hex || it.color || it.value;
        return makeColor(it.code || String(i + 1).padStart(2, '0'), hex, it.name || it.label || '');
      });
    } else {
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => {
        if (!s) return false;
        if (/^#[0-9a-fA-F]{3,6}$/.test(s)) return true;  // 纯 HEX 一行
        return s[0] !== '#';                             // 其余 # 开头当注释丢掉
      });
      list = [];
      lines.forEach((line, i) => {
        if (/^#[0-9a-fA-F]{3,6}$/.test(line)) { list.push(makeColor(String(i + 1).padStart(2, '0'), line, '')); return; }
        const parts = line.split(/[,;\t]+|\s+/).map((s) => s.trim()).filter(Boolean);
        const hexIdx = parts.findIndex((p) => /^#[0-9a-fA-F]{3,6}$/.test(p));
        if (hexIdx < 0) return; // 没颜色就跳过
        const hex = parts[hexIdx];
        const code = hexIdx > 0 ? parts[0] : String(i + 1).padStart(2, '0');
        const nm = parts.filter((p, k) => k !== hexIdx && k !== 0).join(' ');
        list.push(makeColor(code, hex, nm));
      });
    }
    if (!list || !list.length) throw new Error('没有解析出任何颜色');
    // 去重：只合并「色号 + 色值都一样」的重复行。
    // 不同色号即使屏幕色值相同也要保留（真实色卡里确实存在，例如 Q4 与 R11）。
    const seen = new Set();
    const colors = list.filter((c) => {
      const k = c.code + '|' + c.hex;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    return { name, colors, dups: list.length - colors.length };
  }

  function serializePalette(palette) {
    return JSON.stringify({
      app: 'pindou-studio', kind: 'palette', version: 1,
      name: palette.name,
      colors: palette.colors.map((c) => ({ code: c.code, hex: c.hex, name: c.name })),
    }, null, 2);
  }

  /* 把一份已有图案从旧色卡重新配色到新色卡 */
  function remapGrid(grid, fromPalette, toPalette) {
    const cache = new Map();
    const cells = new Int16Array(grid.cells.length);
    for (let i = 0; i < grid.cells.length; i++) {
      const v = grid.cells[i];
      if (v < 0) { cells[i] = -1; continue; }
      let nv = cache.get(v);
      if (nv === undefined) {
        const c = fromPalette && fromPalette.colors[v];
        nv = c ? nearestLab(c.lab, toPalette) : 0;
        cache.set(v, nv);
      }
      cells[i] = nv;
    }
    return { w: grid.w, h: grid.h, cells };
  }

  root.PDColor = {
    clamp, hexToRgb, rgbToHex, rgbToLab, deltaE2, luma, hslToRgb,
    makeColor, makePalette, paletteLabs, nearestLab, nearestRgb,
    getBuiltinPalettes, buildWidePalette, labHueName, labHueDeg, labLightWord,
    parsePaletteText, serializePalette, remapGrid,
  };
})(globalThis);
