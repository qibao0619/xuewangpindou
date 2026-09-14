/* 雪王拼豆 · 导出
 * 生成可打印的图纸（带坐标、色号、分板线、配色图例），导出 PNG / CSV，打印或存为 PDF。 */
(function (root) {
  'use strict';

  const FONT = '"Segoe UI", system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif';
  const MONO = 'ui-monospace, Consolas, "Cascadia Mono", monospace';

  const pad2 = (n) => String(n).padStart(2, '0');

  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function text(ctx, str, x, y, font, color, align) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  }

  /**
   * 生成图纸位图。
   * o: { grid, palette, counts, cell, codes, ruler, guides, boardSize, beadMM, title, subtitle }
   */
  function patternCanvas(o) {
    const grid = o.grid, palette = o.palette;
    const rows = (o.counts && o.counts.list) || [];
    const cell = o.cell || 26;
    const showCodes = o.codes !== false;
    const ruler = o.ruler !== false;
    const guides = o.guides !== false;
    const boardSize = o.boardSize || 29;
    const beadMM = o.beadMM || 5;
    const margin = 26;
    const headerH = 78;
    const legendRowH = 18;
    const legendColW = 176;
    const gridPxW = grid.w * cell, gridPxH = grid.h * cell;
    const rulerW = ruler ? 28 : 0, rulerH = ruler ? 20 : 0;
    const cols = Math.max(1, Math.min(6, Math.floor(Math.max(1, gridPxW) / legendColW) || 1));
    const rowsPerCol = Math.max(1, Math.ceil(rows.length / cols));
    const legendH = rows.length ? rowsPerCol * legendRowH + 30 : 0;
    const contentW = rulerW + gridPxW;
    const width = Math.ceil(margin * 2 + Math.max(contentW, cols * legendColW));
    const height = Math.ceil(margin + headerH + rulerH + gridPxH + (legendH ? 22 + legendH : 0) + 34 + margin);

    const cv = document.createElement('canvas');
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // 标题
    const total = (o.counts && o.counts.total) || 0;
    text(ctx, o.title || '雪王拼豆 · 图纸', margin, margin + 24, '700 23px ' + FONT, '#111111');
    const cmW = (grid.w * beadMM / 10).toFixed(1), cmH = (grid.h * beadMM / 10).toFixed(1);
    const meta = o.subtitle ||
      ('尺寸 ' + grid.w + ' × ' + grid.h + ' 格 · ' + beadMM + 'mm 拼豆 · 成品约 ' + cmW + ' × ' + cmH + ' cm · 总豆数 ' +
        total + ' 颗 · 配色 ' + rows.length + ' 种');
    text(ctx, meta, margin, margin + 48, '13px ' + FONT, '#555555');
    text(ctx, '打印说明：按 100%（不要缩放）打印，格距 = 图中标注像素；分板线每 ' + boardSize + ' 格一条，对应一块拼豆板。',
      margin, margin + 68, '12px ' + FONT, '#888888');

    // 网格区
    const gx = margin + rulerW, gy = margin + headerH + rulerH;

    if (ruler) {
      ctx.font = '11px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#555555';
      const step = cell >= 22 ? 1 : cell >= 12 ? 2 : cell >= 8 ? 5 : 10;
      for (let c = 0; c < grid.w; c++) {
        const isEdge = (c + 1) % boardSize === 0;
        if (c % step !== 0 && !isEdge) continue;
        ctx.fillStyle = isEdge ? '#B26A00' : '#555555';
        ctx.fillText(String(c + 1), gx + c * cell + cell / 2, gy - rulerH / 2);
      }
      ctx.textAlign = 'right';
      for (let r = 0; r < grid.h; r++) {
        const isEdge = (r + 1) % boardSize === 0;
        if (r % step !== 0 && !isEdge) continue;
        ctx.fillStyle = isEdge ? '#B26A00' : '#555555';
        ctx.fillText(String(r + 1), gx - 5, gy + r * cell + cell / 2);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // 底色 + 格子
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(gx, gy, gridPxW, gridPxH);

    const byColor = new Map();
    for (let r = 0; r < grid.h; r++) {
      for (let c = 0; c < grid.w; c++) {
        const v = grid.cells[r * grid.w + c];
        if (v < 0) continue;
        const col = palette.colors[v];
        if (!col) continue;
        let arr = byColor.get(col.hex);
        if (!arr) { arr = []; byColor.set(col.hex, arr); }
        arr.push(gx + c * cell, gy + r * cell);
      }
    }
    byColor.forEach((arr, hex) => {
      ctx.fillStyle = hex;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 2) ctx.rect(arr[i], arr[i + 1], cell + 0.6, cell + 0.6);
      ctx.fill();
    });

    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= grid.w; c++) {
      const x = Math.round(gx + c * cell) + 0.5;
      ctx.moveTo(x, gy); ctx.lineTo(x, gy + gridPxH);
    }
    for (let r = 0; r <= grid.h; r++) {
      const y = Math.round(gy + r * cell) + 0.5;
      ctx.moveTo(gx, y); ctx.lineTo(gx + gridPxW, y);
    }
    ctx.stroke();

    // 分板线
    if (guides) {
      ctx.strokeStyle = 'rgba(200,90,20,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let c = boardSize; c < grid.w; c += boardSize) {
        const x = Math.round(gx + c * cell) + 0.5;
        ctx.moveTo(x, gy); ctx.lineTo(x, gy + gridPxH);
      }
      for (let r = boardSize; r < grid.h; r += boardSize) {
        const y = Math.round(gy + r * cell) + 0.5;
        ctx.moveTo(gx, y); ctx.lineTo(gx + gridPxW, y);
      }
      ctx.stroke();
    }

    // 色号（格子放不下完整色号时逐级缩短，再放不下就省略，避免糊成一团）
    if (showCodes && cell >= 12) {
      const fs = Math.max(5, Math.min(12, cell * 0.32));
      ctx.font = '600 ' + fs.toFixed(1) + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = cell - 1.5;
      const cache = new Map();
      for (let r = 0; r < grid.h; r++) {
        for (let c = 0; c < grid.w; c++) {
          const v = grid.cells[r * grid.w + c];
          if (v < 0) continue;
          const col = palette.colors[v];
          if (!col) continue;
          let text = cache.get(v);
          if (text === undefined) {
            text = col.code;
            if (ctx.measureText(text).width > maxW) {
              const digits = text.replace(/^[A-Z]+/, '');
              text = digits && ctx.measureText(digits).width <= maxW ? digits : '';
            }
            cache.set(v, text);
          }
          if (!text) continue;
          ctx.fillStyle = root.PDColor.luma(col.rgb) > 140 ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.9)';
          ctx.fillText(text, gx + c * cell + cell / 2, gy + r * cell + cell / 2 + 0.5);
        }
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.round(gx) + 0.5, Math.round(gy) + 0.5, gridPxW, gridPxH);

    // 图例
    if (rows.length) {
      const ly = gy + gridPxH + 22;
      text(ctx, '配色表（' + rows.length + ' 色，共 ' + total + ' 颗）', margin, ly + 12, '700 13px ' + FONT, '#111111');
      const startY = ly + 34;
      rows.forEach((row, i) => {
        const col = i % cols, r = Math.floor(i / cols);
        const x = margin + col * legendColW;
        const y = startY + r * legendRowH;
        const color = row.color || palette.colors[row.index];
        if (!color) return;
        ctx.fillStyle = color.hex;
        ctx.fillRect(x, y - 10, 12, 12);
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y - 9.5, 12, 12);
        text(ctx, color.code + '  ' + (color.name || '') + '  ×' + row.count, x + 18, y, '12px ' + FONT, '#222222');
      });
    }

    const footY = height - margin - 6;
    text(ctx, '雪王拼豆 · 生成于 ' + new Date().toLocaleString('zh-CN') + ' · 格距 ' + cell + 'px',
      margin, footY, '11px ' + FONT, '#999999');

    return cv;
  }

  function legendRows(counts) {
    return (counts.list || []).map((row) => ({
      code: row.color ? row.color.code : '?',
      name: row.color ? row.color.name : '',
      hex: row.color ? row.color.hex : '#000000',
      count: row.count,
    }));
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png');
      else reject(new Error('浏览器不支持导出'));
    });
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.download = filename;
    let url = null;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      url = URL.createObjectURL(blob);
      a.href = url;
    } else if (typeof FileReader === 'function') {
      // 兜底：某些环境（沙箱/旧内核）没有 createObjectURL，用 data: URL
      const reader = new FileReader();
      reader.onload = () => {
        a.href = String(reader.result);
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      reader.onerror = () => { throw new Error('浏览器不支持下载'); };
      reader.readAsDataURL(blob);
      return;
    } else {
      throw new Error('当前浏览器不支持文件下载');
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadCanvas(canvas, filename) {
    download(await canvasToBlob(canvas), filename);
  }

  function countsToCsv(counts, stock) {
    const rows = legendRows(counts);
    const lines = ['色号,名称,HEX,数量,库存,差额'];
    let total = 0, short = 0;
    rows.forEach((r) => {
      const have = (stock && stock[r.hex]) || 0;
      const diff = Math.max(0, r.count - have);
      total += r.count;
      short += diff;
      lines.push([r.code, r.name, r.hex, r.count, have, diff].join(','));
    });
    lines.push(['合计', '', '', total, '', short].join(','));
    return '\ufeff' + lines.join('\r\n');
  }

  /** 填充打印容器（配合 @media print 输出 PDF） */
  function buildPrintSheet(container, o) {
    const dataUrl = o.canvas.toDataURL('image/png');
    const rows = o.rows || [];
    const legend = rows.map((r) =>
      '<div><i style="background:' + r.hex + '"></i>' + esc(r.code) + ' ' + esc(r.name) + ' ×' + r.count + '</div>'
    ).join('');
    container.innerHTML =
      '<h1>' + esc(o.title || '雪王拼豆 · 图纸') + '</h1>' +
      '<div class="meta">' + esc(o.meta || '') + '</div>' +
      '<img src="' + dataUrl + '" alt="雪王拼豆图纸">' +
      (legend ? '<div class="legend">' + legend + '</div>' : '') +
      '<div class="foot">' + esc(o.foot || '') + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function printSheet(container) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      try { window.print(); } catch (_) { /* ignore */ }
    };
    try {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(() => setTimeout(run, 60));
      }
    } catch (_) { /* ignore */ }
    // 字体就绪事件不保证触发，兜底定时器保证一定会打印
    setTimeout(run, 350);
  }

  root.PDExport = { patternCanvas, legendRows, canvasToBlob, download, downloadCanvas, countsToCsv, buildPrintSheet, printSheet, stamp };
})(globalThis);
