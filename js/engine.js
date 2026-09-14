/* 雪王拼豆 · 核心引擎
 * 图片降采样 → Lab 最近色量化（可抖动）→ 限量配色 → 网格变换 → 序列化。
 * 除 imageToGrid 依赖 canvas/DOM 外，其余函数都是纯计算，可在 Node 里直接测试。 */
(function (root) {
  'use strict';

  const C = root.PDColor;
  const { clamp, rgbToLab, deltaE2, hexToRgb } = C;

  /* ---------- 网格基本操作 ---------- */

  function newGrid(w, h, fill) {
    const cells = new Int16Array(w * h);
    if (fill !== undefined && fill !== -1) cells.fill(fill);
    else if (fill === -1) cells.fill(-1);
    return { w, h, cells };
  }

  function cloneGrid(grid) {
    return { w: grid.w, h: grid.h, cells: Int16Array.from(grid.cells) };
  }

  function countUsage(cells, palette) {
    const counts = new Map();
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
    }
    let total = 0;
    const list = [];
    counts.forEach((n, idx) => {
      total += n;
      list.push({ index: idx, color: palette.colors[idx] || null, count: n });
    });
    list.sort((a, b) => b.count - a.count || a.index - b.index);
    return { list, total, colors: list.length };
  }

  /* ---------- 量化 ---------- */

  function nearestCached(lab, palette, cache, key) {
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = C.nearestLab(lab, palette);
      if (cache.size > 300000) cache.clear();
      cache.set(key, idx);
    }
    return idx;
  }

  /**
   * 把 RGBA 像素量化到色卡。
   * opts: { dither, alphaThreshold }
   * 返回 Int16Array，-1 表示空格子。
   */
  function quantize(rgba, w, h, palette, opts) {
    opts = opts || {};
    const n = w * h;
    const cells = new Int16Array(n);
    const at = opts.alphaThreshold == null ? 8 : opts.alphaThreshold;
    const dither = !!opts.dither;

    if (!dither) {
      const cache = new Map();
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (rgba[o + 3] < at) { cells[i] = -1; continue; }
        const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
        cells[i] = nearestCached(rgbToLab(r, g, b), palette, cache, (r << 16) | (g << 8) | b);
      }
      return cells;
    }

    // Floyd–Steinberg 抖动（蛇形扫描），误差在 RGB 空间扩散
    const buf = new Float32Array(n * 3);
    const empty = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgba[o + 3] < at) { empty[i] = 1; cells[i] = -1; continue; }
      buf[i * 3] = rgba[o]; buf[i * 3 + 1] = rgba[o + 1]; buf[i * 3 + 2] = rgba[o + 2];
    }
    const cache = new Map();
    const spread = (x, y, er, eg, eb, f) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (empty[i]) return;
      buf[i * 3] += er * f; buf[i * 3 + 1] += eg * f; buf[i * 3 + 2] += eb * f;
    };
    for (let y = 0; y < h; y++) {
      const ltr = (y & 1) === 0;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = y * w + x;
        if (empty[i]) continue;
        const p = i * 3;
        const r = clamp(buf[p], 0, 255), g = clamp(buf[p + 1], 0, 255), b = clamp(buf[p + 2], 0, 255);
        const idx = nearestCached(rgbToLab(r, g, b), palette, cache, (r << 16) | (g << 8) | b);
        cells[i] = idx;
        const pc = palette.colors[idx].rgb;
        const er = r - pc[0], eg = g - pc[1], eb = b - pc[2];
        const d = ltr ? 1 : -1;
        spread(x + d, y, er, eg, eb, 7 / 16);
        spread(x - d, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16);
        spread(x + d, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return cells;
  }

  /* ---------- 限色：按「色相相近 + 明度分层」聚类合并 ---------- */

  /**
   * 合并代价：把「同一色相的深浅差异」和「不同色相/彩度差异」区别对待。
   *  - 平面距离（Lab 的 a、b 分量）代表色相/彩度差异 → 贵，尽量不合并，保住真正不同的颜色；
   *  - 明度差（L 分量）代表高光/阴影层次 → 便宜，同一个色相下的深浅阶优先并成一色，
   *    这样「阴影只留最深那一阶」，而不是把整片阴影都画成独立色。
   * 再加一条硬上限：明度差过大（黑↔白）无论多便宜都不并，否则图会糊成一片。
   */
  const MERGE_HUE_W = 4;        // 色相/彩度差异的权重（贵）
  const MERGE_L_W = 1;          // 明度差异的权重（便宜）
  const MERGE_SHADOW_DISCOUNT = 0.45; // 「同色相的深浅阶」再打个折，更积极地去掉过渡阴影
  const MERGE_SAME_CHROMA = 12; // 平面距离小于此值视为「同色相」，可享受阴影折扣
  const MERGE_MAX_DL = 46;      // 明度差硬上限：超过就绝不合并（保住黑白对比）

  /** 两个颜色合并的代价，越小越该并（返回 Infinity 表示不允许并） */
  function mergeCost(a, b) {
    const dl = a.lab[0] - b.lab[0];
    const da = a.lab[1] - b.lab[1];
    const db = a.lab[2] - b.lab[2];
    const plane2 = da * da + db * db;
    const adl = Math.abs(dl);
    if (adl > MERGE_MAX_DL) return Infinity;
    let cost = plane2 * MERGE_HUE_W;
    const dlCost = dl * dl * MERGE_L_W * (plane2 < MERGE_SAME_CHROMA * MERGE_SAME_CHROMA ? MERGE_SHADOW_DISCOUNT : 1);
    cost += dlCost;
    return cost;
  }

  /**
   * 把用色数压到 maxColors 以内。
   * 策略：保留用得最多的颜色作为骨架，然后**反复合并代价最小的一对**颜色，
   * 直到色数达标 —— 于是相近色自动并成一色、同色相的阴影阶被压掉，
   * 而色相差异大的颜色（代价高）会一直保留到最后。
   */
  function limitColors(cells, palette, maxColors) {
    if (!maxColors || maxColors < 1) return { cells, removed: 0, kept: 0, merges: [] };
    const counts = new Map();
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size <= maxColors) return { cells, removed: 0, kept: counts.size, merges: [] };

    // 工作集：每个已用颜色一个节点（lab 用加权平均，合并后仍然代表这一簇）
    const nodes = Array.from(counts.entries()).map(([idx, count]) => ({
      idxs: [idx], lab: palette.colors[idx].lab.slice(), count,
    }));

    // 反复合并代价最小的一对，直到剩 maxColors 个
    while (nodes.length > maxColors) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = mergeCost(nodes[i], nodes[j]);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;   // 全部组合都被硬上限挡住：宁可保留更多色，也不糊成一片
      const a = nodes[bi], b = nodes[bj];
      // 合并后把两簇里**用得更多**的那个代表色保留下来，出图色号更贴近原图主色
      const keep = a.count >= b.count ? a : b;
      const merge = a.count >= b.count ? b : a;
      const total = a.count + b.count;
      keep.lab = [
        (keep.lab[0] * keep.count + merge.lab[0] * merge.count) / total,
        (keep.lab[1] * keep.count + merge.lab[1] * merge.count) / total,
        (keep.lab[2] * keep.count + merge.lab[2] * merge.count) / total,
      ];
      keep.count = total;
      keep.idxs = keep.idxs.concat(merge.idxs);
      // 先删大下标，再删小下标，避免删完前一个后后一个的索引错位
      nodes.splice(bj, 1);
      nodes.splice(bi, 1);
      nodes.push(keep);
    }

    const remap = new Map();
    nodes.forEach((node) => {
      const rep = node.idxs[0];
      node.idxs.forEach((idx) => remap.set(idx, rep));
    });

    const out = new Int16Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      out[i] = v < 0 ? -1 : remap.get(v);
    }
    return { cells: out, removed: counts.size - nodes.length, kept: nodes.length, merges: nodes };
  }

  /* ---------- 手工调整亮度/对比度/饱和度（ctx.filter 不可用时兜底） ---------- */

  function applyAdjustments(data, brightness, contrast, saturation) {
    const b = brightness / 100, c = contrast / 100, s = saturation / 100;
    if (b === 1 && c === 1 && s === 1) return data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * b, g = data[i + 1] * b, bl = data[i + 2] * b;
      r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      data[i] = clamp(gray + (r - gray) * s, 0, 255);
      data[i + 1] = clamp(gray + (g - gray) * s, 0, 255);
      data[i + 2] = clamp(gray + (bl - gray) * s, 0, 255);
    }
    return data;
  }

  /* ---------- 图片 → 网格 ---------- */

  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  /**
   * opts: { gridW, gridH, palette, dither, alphaThreshold, transparent,
   *         maxColors, brightness, contrast, saturation }
   */
  function imageToGrid(img, opts) {
    opts = opts || {};
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error('图片尺寸无效');

    const w = clamp(Math.round(opts.gridW || 48), 2, 512);
    const h = clamp(Math.round(opts.gridH || Math.round(w * srcH / srcW)), 2, 512);

    // 逐级折半降采样，避免大比例缩小时的锯齿
    let cur = makeCanvas(srcW, srcH);
    let cctx = cur.getContext('2d');
    cctx.drawImage(img, 0, 0);
    while (cur.width / 2 >= w * 1.5 && cur.height / 2 >= h * 1.5) {
      const nw = Math.max(w, Math.floor(cur.width / 2));
      const nh = Math.max(h, Math.floor(cur.height / 2));
      const next = makeCanvas(nw, nh);
      const nctx = next.getContext('2d');
      nctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in nctx) nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(cur, 0, 0, nw, nh);
      cur = next;
    }

    const out = makeCanvas(w, h);
    const octx = out.getContext('2d', { willReadFrequently: true });
    const brightness = opts.brightness == null ? 100 : opts.brightness;
    const contrast = opts.contrast == null ? 100 : opts.contrast;
    const saturation = opts.saturation == null ? 100 : opts.saturation;
    let filterApplied = false;
    if (typeof octx.filter === 'string') {
      octx.filter = 'brightness(' + brightness + '%) contrast(' + contrast + '%) saturate(' + saturation + '%)';
      filterApplied = true;
    }
    if (!opts.transparent) { octx.fillStyle = '#FFFFFF'; octx.fillRect(0, 0, w, h); }
    octx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in octx) octx.imageSmoothingQuality = 'high';
    octx.drawImage(cur, 0, 0, w, h);
    octx.filter = 'none';

    const imgData = octx.getImageData(0, 0, w, h);
    if (!filterApplied) {
      applyAdjustments(imgData.data, brightness, contrast, saturation);
      if (!opts.transparent) {
        // 手动合成到白底，避免半透明像素变黑
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255;
          d[i] = d[i] * a + 255 * (1 - a);
          d[i + 1] = d[i + 1] * a + 255 * (1 - a);
          d[i + 2] = d[i + 2] * a + 255 * (1 - a);
          d[i + 3] = 255;
        }
      }
    }

    let cells = quantize(imgData.data, w, h, opts.palette, {
      dither: opts.dither,
      alphaThreshold: opts.transparent ? (opts.alphaThreshold == null ? 8 : opts.alphaThreshold) : 0,
    });
    let limited = { removed: 0, kept: 0 };
    if (opts.maxColors > 0) {
      limited = limitColors(cells, opts.palette, opts.maxColors);
      cells = limited.cells;
    }
    return { w, h, cells, srcW, srcH, mergedColors: limited.removed };
  }

  /* ---------- 网格变换 ---------- */

  function trimGrid(grid) {
    let minR = grid.h, maxR = -1, minC = grid.w, maxC = -1;
    for (let r = 0; r < grid.h; r++) {
      for (let c = 0; c < grid.w; c++) {
        if (grid.cells[r * grid.w + c] >= 0) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (maxR < 0) return null;
    const w = maxC - minC + 1, h = maxR - minR + 1;
    if (w === grid.w && h === grid.h) return { grid: cloneGrid(grid), dx: 0, dy: 0 };
    const cells = new Int16Array(w * h).fill(-1);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) cells[r * w + c] = grid.cells[(r + minR) * grid.w + (c + minC)];
    }
    return { grid: { w, h, cells }, dx: minC, dy: minR };
  }

  function rotateGrid(grid, clockwise) {
    const w = grid.h, h = grid.w;
    const cells = new Int16Array(w * h);
    for (let r = 0; r < grid.h; r++) {
      for (let c = 0; c < grid.w; c++) {
        const v = grid.cells[r * grid.w + c];
        if (clockwise) cells[c * w + (grid.h - 1 - r)] = v;
        else cells[(grid.w - 1 - c) * w + r] = v;
      }
    }
    return { w, h, cells };
  }

  function flipGrid(grid, axis) {
    const cells = new Int16Array(grid.cells.length);
    for (let r = 0; r < grid.h; r++) {
      for (let c = 0; c < grid.w; c++) {
        const v = grid.cells[r * grid.w + c];
        if (axis === 'h') cells[r * grid.w + (grid.w - 1 - c)] = v;
        else cells[(grid.h - 1 - r) * grid.w + c] = v;
      }
    }
    return { w: grid.w, h: grid.h, cells };
  }

  /**
   * 去掉四周的背景色块，只留下主体（人物等）。
   *
   * 做法：从最外圈每一格出发做 4 邻接泛洪，凡是**和边缘同色**的格子都算背景。
   *  - 只从四边往里连通扩散，所以「人物中间和背景同色的部分」不会被误删
   *    （除非它和边缘连通）；
   *  - 图形内部被主体包住的同色块一律保留；
   *  - 中间起连接作用的部分（脖子、手臂和身体的连接）不在边缘连通区里，照常保留。
   *
   * @param {object} grid
   * @param {Int16Array} cells 颜色下标；-1 表示空格
   * @param {number} edgeThreshold 整圈边缘被判定为背景的比例门槛
   * @returns {{cells: Int16Array, removed: number, bg: number[]}} bg 为判定出的背景颜色下标
   */
  function removeEdgeBackground(cells, w, h) {
    const out = Int16Array.from(cells);
    if (w < 3 || h < 3) return { cells: out, removed: 0, bg: [] };

    // 先数一下最外圈出现过哪些颜色
    const edgeCount = new Map();
    const bump = (idx) => { if (idx >= 0) edgeCount.set(idx, (edgeCount.get(idx) || 0) + 1); };
    for (let c = 0; c < w; c++) { bump(cells[c]); bump(cells[(h - 1) * w + c]); }
    for (let r = 1; r < h - 1; r++) { bump(cells[r * w]); bump(cells[r * w + w - 1]); }

    // 候选背景色：至少占到边缘长度 40%，避免把主体贴边的那一点点也当背景
    const edgeLen = 2 * w + 2 * h - 4;
    const candidates = new Set();
    edgeCount.forEach((n, idx) => { if (n / edgeLen >= 0.4) candidates.add(idx); });
    if (!candidates.size) return { cells: out, removed: 0, bg: [] };

    // 从边缘泛洪：只走「颜色相同」且属于候选背景色的格子
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (r, c) => {
      if (r < 0 || c < 0 || r >= h || c >= w) return;
      const p = r * w + c;
      if (seen[p]) return;
      const v = cells[p];
      if (!candidates.has(v)) return;
      seen[p] = 1;
      stack.push(p);
    };
    for (let c = 0; c < w; c++) { push(0, c); push(h - 1, c); }
    for (let r = 1; r < h - 1; r++) { push(r, 0); push(r, w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const r = (p / w) | 0, c = p % w;
      push(r - 1, c); push(r + 1, c); push(r, c - 1); push(r, c + 1);
    }

    let removed = 0;
    for (let p = 0; p < seen.length; p++) {
      if (seen[p] && out[p] >= 0) { out[p] = -1; removed++; }
    }
    return { cells: out, removed, bg: Array.from(candidates) };
  }

  function resizeGrid(grid, w, h) {    const cells = new Int16Array(w * h).fill(-1);
    for (let r = 0; r < h; r++) {
      const sr = Math.min(grid.h - 1, Math.floor(r * grid.h / h));
      for (let c = 0; c < w; c++) {
        const sc = Math.min(grid.w - 1, Math.floor(c * grid.w / w));
        cells[r * w + c] = grid.cells[sr * grid.w + sc];
      }
    }
    return { w, h, cells };
  }

  /* ---------- 绘制辅助 ---------- */

  /** Bresenham：把 (r0,c0)→(r1,c1) 之间的格子交给 cb */
  function lineCells(r0, c0, r1, c1, cb) {
    let dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
    const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
    let err = dc - dr, r = r0, c = c0;
    for (;;) {
      cb(r, c);
      if (r === r1 && c === c1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
  }

  /** 四连通油漆桶；返回被改动的格子下标数组 */
  function floodFill(grid, r0, c0, target) {
    const { w, h, cells } = grid;
    if (r0 < 0 || c0 < 0 || r0 >= h || c0 >= w) return [];
    const from = cells[r0 * w + c0];
    if (from === target) return [];
    const out = [];
    const stack = [r0 * w + c0];
    while (stack.length) {
      const i = stack.pop();
      if (cells[i] !== from) continue;
      cells[i] = target;
      out.push(i);
      const r = (i / w) | 0, c = i - r * w;
      if (r > 0) stack.push(i - w);
      if (r < h - 1) stack.push(i + w);
      if (c > 0) stack.push(i - 1);
      if (c < w - 1) stack.push(i + 1);
    }
    return out;
  }

  /* ---------- 序列化（RLE + base64） ---------- */

  function rleEncode(cells) {
    const out = [];
    const put = (n) => { while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push(n); };
    let i = 0;
    while (i < cells.length) {
      const v = cells[i];
      let n = 1;
      while (i + n < cells.length && cells[i + n] === v) n++;
      i += n;
      put(v + 1);
      put(n);
    }
    return Uint8Array.from(out);
  }

  function rleDecode(bytes, total) {
    const cells = new Int16Array(total).fill(-1);
    let p = 0, i = 0;
    const get = () => {
      let n = 0, sh = 0, b;
      do { b = bytes[i++]; n |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80);
      return n;
    };
    while (i < bytes.length && p < total) {
      const v = get() - 1, n = get();
      for (let k = 0; k < n && p < total; k++) cells[p++] = v;
    }
    return cells;
  }

  function bytesToBase64(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  function base64ToBytes(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  function encodeGrid(grid) {
    return { w: grid.w, h: grid.h, rle: bytesToBase64(rleEncode(grid.cells)) };
  }

  function decodeGrid(obj) {
    if (!obj || !obj.w || !obj.h) throw new Error('图案数据不完整');
    const total = obj.w * obj.h;
    const cells = obj.rle ? rleDecode(base64ToBytes(obj.rle), total) : Int16Array.from(obj.cells || []);
    if (cells.length !== total) throw new Error('图案数据长度不匹配');
    return { w: obj.w, h: obj.h, cells };
  }

  root.PDEngine = {
    newGrid, cloneGrid, countUsage, quantize, limitColors, applyAdjustments,
    imageToGrid, trimGrid, rotateGrid, flipGrid, resizeGrid,
    removeEdgeBackground,
    lineCells, floodFill,
    rleEncode, rleDecode, bytesToBase64, base64ToBytes, encodeGrid, decodeGrid,
  };
})(globalThis);
