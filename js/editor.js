/* 雪王拼豆 · 网格编辑器
 * 自绘 canvas：画笔 / 橡皮 / 吸管 / 油漆桶、撤销重做、缩放平移、标尺、拼豆板辅助线、色号显示。 */
(function (root) {
  'use strict';

  const E = root.PDEngine;
  const C = root.PDColor;
  const M = { left: 36, top: 22, right: 12, bottom: 12 };

  class Editor {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wrap = canvas.parentElement;
      this.grid = E.newGrid(29, 29, -1);
      this.palette = null;
      this.tool = 'brush';
      this.color = 0;
      this.brush = 1;
      this.opts = { codes: true, gridLines: true, guides: true, boardSize: 29 };
      this.highlight = -1;   // 高亮某个颜色（色卡下标），-1 = 不高亮
      this.preview = true;   // 预览模式：只读，防止误触改图（默认开）
      this.view = { zoom: 14, ox: M.left, oy: M.top };
      this.dpr = 1;
      this.cssW = 0; this.cssH = 0;
      this.hover = null;
      this.dragging = null;
      this.panning = null;
      this.spaceDown = false;
      this.history = [];
      this.future = [];
      this.historyLimit = 150;
      this._changes = null;
      this._raf = 0;
      this._firstLayout = true;
      this.onGridChange = null;
      this.onHover = null;
      this.onPick = null;
      this.onColorChange = null;
      this.onHistory = null;
      this.onView = null;
      this._bind();
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.wrap);
      this.resize();
    }

    /* ---------- 事件 ---------- */

    _bind() {
      const cv = this.canvas;
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isTyping(e)) { this.spaceDown = true; e.preventDefault(); this._cursor(); }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { this.spaceDown = false; this._cursor(); }
      });
    }

    _cursor() {
      const pan = !!(this.panning || this.spaceDown);
      this.wrap.classList.toggle('pick', !this.preview && this.tool === 'picker' && !this.spaceDown);
      this.wrap.classList.toggle('panning', pan);
      this.wrap.classList.toggle('preview', this.preview);
    }

    /** 预览模式：只读。键盘/工具都改不了图，但平移缩放、悬停、高亮照常。 */
    setPreview(on) {
      this.preview = !!on;
      this.dragging = null;
      this._changes = null;
      this._cursor();
      this.requestRender();
    }

    _down(e) {
      const pan = e.button === 1 || e.button === 2 || this.spaceDown;
      if (pan) {
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        this.panning = { x: e.clientX, y: e.clientY };
        this._cursor();
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      // 预览模式：按下去也只允许平移，绝不改图（避免手一滑就画上去）
      if (this.preview) {
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        this.panning = { x: e.clientX, y: e.clientY };
        this._cursor();
        return;
      }
      const cell = this.cellAt(e);
      if (!cell) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (this.tool === 'picker') { this._pick(cell.r, cell.c); return; }
      if (!this.palette) return;
      this._changes = [];
      this._applyAt(cell.r, cell.c);
      this.dragging = { r: cell.r, c: cell.c };
      this.requestRender();
    }

    _move(e) {
      if (this.panning) {
        const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
        this.panning = { x: e.clientX, y: e.clientY };
        this.view.ox += dx; this.view.oy += dy;
        this.clampView();
        this.requestRender();
        return;
      }
      const cell = this.cellAt(e);
      this._setHover(cell);
      if (this.dragging && cell) {
        const d = this.dragging;
        if ((cell.r !== d.r || cell.c !== d.c) && this.tool !== 'fill') {
          E.lineCells(d.r, d.c, cell.r, cell.c, (r, c) => this._applyAt(r, c));
          this.dragging = { r: cell.r, c: cell.c };
        }
        this.requestRender();
      }
    }

    _up(e) {
      if (this.panning) {
        this.panning = null;
        this._cursor();
        return;
      }
      if (this._changes && this._changes.length) {
        this._push({ cells: this._changes });
        this._emit('paint');
      }
      this._changes = null;
      this.dragging = null;
      this.requestRender();
      if (e && e.pointerId != null) { try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
    }

    _wheel(e) {
      e.preventDefault();
      if (e.shiftKey) {
        this.view.ox -= e.deltaY;
        this.clampView();
      } else {
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }
      this.requestRender();
    }

    /* ---------- 绘制动作 ---------- */

    _applyAt(r, c) {
      if (this.preview) return false;   // 预览模式绝不改图
      const g = this.grid;
      if (r < 0 || c < 0 || r >= g.h || c >= g.w) return false;
      if (this.tool === 'fill') {
        const target = this.color;
        if (target < 0) return false;
        const from = g.cells[r * g.w + c];
        if (from === target) return false;
        const idxs = E.floodFill(g, r, c, target);
        for (let i = 0; i < idxs.length; i++) this._changes.push([idxs[i], from, target]);
        return idxs.length > 0;
      }
      const value = this.tool === 'eraser' ? -1 : this.color;
      if (value < 0 && this.tool !== 'eraser') return false;
      const n = this.brush;
      const r0 = r - ((n - 1) >> 1), c0 = c - ((n - 1) >> 1);
      let changed = false;
      for (let dr = 0; dr < n; dr++) {
        for (let dc = 0; dc < n; dc++) {
          const rr = r0 + dr, cc = c0 + dc;
          if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
          const i = rr * g.w + cc;
          const prev = g.cells[i];
          if (prev === value) continue;
          g.cells[i] = value;
          this._changes.push([i, prev, value]);
          changed = true;
        }
      }
      return changed;
    }

    _pick(r, c) {
      const g = this.grid;
      if (r < 0 || c < 0 || r >= g.h || c >= g.w) return;
      const v = g.cells[r * g.w + c];
      if (v < 0) return;
      this.color = v;
      if (this.onPick) this.onPick(v);
      this.requestRender();
    }

    /* ---------- 历史 ---------- */

    _push(entry) {
      this.history.push(entry);
      if (this.history.length > this.historyLimit) this.history.shift();
      this.future.length = 0;
      if (this.onHistory) this.onHistory();
    }

    pushFull(label) {
      this.history.push({ full: E.cloneGrid(this.grid), label });
      if (this.history.length > this.historyLimit) this.history.shift();
      this.future.length = 0;
      if (this.onHistory) this.onHistory();
    }

    canUndo() { return this.history.length > 0; }
    canRedo() { return this.future.length > 0; }

    undo() {
      if (this.preview) return false;   // 预览模式不改图，撤销也不动
      const entry = this.history.pop();
      if (!entry) return false;
      if (entry.full) {
        this.future.push({ full: E.cloneGrid(this.grid) });
        this.grid = entry.full;
        this.clampView();
      } else {
        const back = [];
        for (const [i, prev, next] of entry.cells) {
          this.grid.cells[i] = prev;
          back.push([i, next, prev]);
        }
        this.future.push({ cells: back });
      }
      this._emit('undo');
      this.requestRender();
      if (this.onHistory) this.onHistory();
      return true;
    }

    redo() {
      if (this.preview) return false;   // 预览模式不改图，重做也不动
      const entry = this.future.pop();
      if (!entry) return false;
      if (entry.full) {
        this.history.push({ full: E.cloneGrid(this.grid) });
        this.grid = entry.full;
        this.clampView();
      } else {
        const fwd = [];
        for (const [i, prev, next] of entry.cells) {
          this.grid.cells[i] = next;
          fwd.push([i, prev, next]);
        }
        this.history.push({ cells: fwd });
      }
      this._emit('redo');
      this.requestRender();
      if (this.onHistory) this.onHistory();
      return true;
    }

    /* ---------- 整体操作 ---------- */

    replaceGrid(grid, o) {
      o = o || {};
      if (o.record !== false) this.pushFull(o.label || 'replace');
      this.grid = grid;
      this.hover = null;
      if (o.fit !== false) this.fit();
      else this.clampView();
      this._emit('replace');
      this.requestRender();
    }

    clear() {
      let has = false;
      for (let i = 0; i < this.grid.cells.length; i++) if (this.grid.cells[i] >= 0) { has = true; break; }
      if (!has) return false;
      this.pushFull('clear');
      this.grid.cells.fill(-1);
      this._emit('clear');
      this.requestRender();
      return true;
    }

    transform(kind) {
      if (this.preview) return false;
      const g = this.grid;
      let next = null;
      if (kind === 'rotate') next = E.rotateGrid(g, true);
      else if (kind === 'flipH') next = E.flipGrid(g, 'h');
      else if (kind === 'flipV') next = E.flipGrid(g, 'v');
      else if (kind === 'trim') {
        const t = E.trimGrid(g);
        if (!t) return false;
        next = t.grid;
      }
      if (!next) return false;
      this.pushFull(kind);
      this.grid = next;
      this.fit();
      this._emit(kind);
      this.requestRender();
      return true;
    }

    /**
     * 去掉四周的背景色块（从四边连通推断），只留主体。中间连接部分不在边缘连通区里，会保留。
     * 网格尺寸不变，所以不重新 fit，只是重画。
     */
    dropBackground() {
      const g = this.grid;
      if (this.preview) return { cells: g.cells, removed: 0, bg: [], blocked: true };
      const res = E.removeEdgeBackground(g.cells, g.w, g.h);
      if (!res.removed) return res;
      this.pushFull('dropBg');
      this.grid = { w: g.w, h: g.h, cells: res.cells };
      this._emit('dropBg');
      this.requestRender();
      return res;
    }

    /* ---------- 视图 ---------- */

    resize() {
      const w = this.wrap.clientWidth || 800;
      const h = this.wrap.clientHeight || 600;
      this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.cssW = w; this.cssH = h;
      this.canvas.width = Math.max(1, Math.round(w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.dpr));
      if (this._firstLayout) { this._firstLayout = false; this.fit(); }
      else { this.clampView(); }
      this.requestRender();
    }

    contentRect() {
      return {
        x: M.left, y: M.top,
        w: Math.max(20, this.cssW - M.left - M.right),
        h: Math.max(20, this.cssH - M.top - M.bottom),
      };
    }

    fit() {
      const a = this.contentRect();
      const g = this.grid;
      let z = Math.min((a.w - 16) / g.w, (a.h - 16) / g.h);
      z = z >= 2 ? Math.floor(z) : Math.max(0.5, Math.round(z * 4) / 4);
      this.view.zoom = C.clamp(z, 0.4, 40);
      this.view.ox = a.x + (a.w - g.w * this.view.zoom) / 2;
      this.view.oy = a.y + (a.h - g.h * this.view.zoom) / 2;
      this.clampView();
    }

    zoomAt(px, py, factor) {
      const old = this.view.zoom;
      let z = old * factor;
      z = z >= 2 ? Math.round(z) : Math.round(z * 4) / 4;
      z = C.clamp(z, 0.4, 40);
      if (z === old) return;
      this.view.ox = px - (px - this.view.ox) * (z / old);
      this.view.oy = py - (py - this.view.oy) * (z / old);
      this.view.zoom = z;
      this.clampView();
    }

    zoomBy(factor) {
      const a = this.contentRect();
      this.zoomAt(a.x + a.w / 2, a.y + a.h / 2, factor);
      this.requestRender();
    }

    clampView() {
      const a = this.contentRect();
      const z = this.view.zoom;
      const gw = this.grid.w * z, gh = this.grid.h * z;
      if (gw <= a.w) this.view.ox = a.x + (a.w - gw) / 2;
      else this.view.ox = C.clamp(this.view.ox, a.x + a.w - gw - 40, a.x + 40);
      if (gh <= a.h) this.view.oy = a.y + (a.h - gh) / 2;
      else this.view.oy = C.clamp(this.view.oy, a.y + a.h - gh - 40, a.y + 40);
    }

    cellAt(e) {
      const rect = this.canvas.getBoundingClientRect();
      return this.cellAtXY(e.clientX - rect.left, e.clientY - rect.top);
    }

    cellAtXY(x, y) {
      const z = this.view.zoom;
      const c = Math.floor((x - this.view.ox) / z);
      const r = Math.floor((y - this.view.oy) / z);
      if (r < 0 || c < 0 || r >= this.grid.h || c >= this.grid.w) return null;
      return { r, c };
    }

    setTool(t) {
      this.tool = t;
      this._cursor();
      this.requestRender();
    }

    setColor(i) {
      const changed = i !== this.color;
      this.color = i;
      if (changed && this.onColorChange) this.onColorChange(i);
      this.requestRender();
    }

    setPalette(p) {
      this.palette = p;
      if (this.color >= p.colors.length) this.color = 0;
      if (this.highlight >= p.colors.length) this.highlight = -1;
      this.requestRender();
    }

    setOptions(o) {
      Object.assign(this.opts, o);
      this.requestRender();
    }

    /** 高亮某个颜色（色卡下标），其余颜色压暗；传 -1 取消高亮 */
    setHighlight(idx) {
      const v = (typeof idx === 'number' && idx >= 0 && this.palette && idx < this.palette.colors.length) ? idx : -1;
      if (v === this.highlight) return;
      this.highlight = v;
      this.requestRender();
    }

    /* ---------- 渲染 ---------- */

    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
    }

    _setHover(cell) {
      const same = (!cell && !this.hover) || (cell && this.hover && cell.r === this.hover.r && cell.c === this.hover.c);
      this.hover = cell ? { r: cell.r, c: cell.c } : null;
      if (!same) {
        this.requestRender();
        if (this.onHover) {
          const g = this.grid;
          let idx = -1;
          if (cell) idx = g.cells[cell.r * g.w + cell.c];
          this.onHover(cell ? { r: cell.r, c: cell.c, index: idx } : null);
        }
      }
    }

    render() {
      const ctx = this.ctx, W = this.cssW, H = this.cssH, z = this.view.zoom;
      const g = this.grid, p = this.palette;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, W, H);

      const a = this.contentRect();
      const gx = this.view.ox, gy = this.view.oy;

      ctx.save();
      ctx.beginPath();
      ctx.rect(a.x, a.y, a.w, a.h);
      ctx.clip();

      ctx.fillStyle = '#141a25';
      ctx.fillRect(gx, gy, g.w * z, g.h * z);

      const c0 = Math.max(0, Math.floor((a.x - gx) / z));
      const c1 = Math.min(g.w - 1, Math.ceil((a.x + a.w - gx) / z));
      const r0 = Math.max(0, Math.floor((a.y - gy) / z));
      const r1 = Math.min(g.h - 1, Math.ceil((a.y + a.h - gy) / z));
      const visible = c1 >= c0 && r1 >= r0;

      // 已填色的格子（按颜色合并路径，减少 fillStyle 切换）
      const hl = (this.highlight >= 0 && p && this.highlight < p.colors.length) ? this.highlight : -1;
      if (visible && p) {
        const byColor = new Map();
        for (let r = r0; r <= r1; r++) {
          const row = r * g.w;
          const y = gy + r * z;
          for (let c = c0; c <= c1; c++) {
            const v = g.cells[row + c];
            if (v < 0) continue;
            const col = p.colors[v];
            if (!col) continue;
            let arr = byColor.get(col.hex);
            if (!arr) { arr = []; byColor.set(col.hex, arr); }
            arr.push(gx + c * z, y);
          }
        }
        const pad = z > 3 ? 0.7 : 0.3;
        byColor.forEach((arr, hex) => {
          ctx.fillStyle = hex;
          ctx.beginPath();
          for (let i = 0; i < arr.length; i += 2) ctx.rect(arr[i], arr[i + 1], z + pad, z + pad);
          ctx.fill();
        });

        // 高亮模式：先把整块压暗，再把目标色重新点亮，一眼看清这个色用在哪
        if (hl >= 0) {
          ctx.fillStyle = 'rgba(8,11,17,.78)';
          ctx.fillRect(gx, gy, g.w * z, g.h * z);
          const col = p.colors[hl];
          ctx.fillStyle = col.hex;
          ctx.beginPath();
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              if (g.cells[r * g.w + c] !== hl) continue;
              ctx.rect(gx + c * z, gy + r * z, z + pad, z + pad);
            }
          }
          ctx.fill();
          // 格子够大时加一圈描边，避免同色相邻糊成一片
          if (z >= 9) {
            ctx.strokeStyle = 'rgba(255,255,255,.85)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let r = r0; r <= r1; r++) {
              for (let c = c0; c <= c1; c++) {
                if (g.cells[r * g.w + c] !== hl) continue;
                ctx.rect(Math.round(gx + c * z) + 0.5, Math.round(gy + r * z) + 0.5, z - 1, z - 1);
              }
            }
            ctx.stroke();
          }
        }
      }

      // 空格子小点，方便数格子
      if (visible && z >= 9) {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        const d = Math.max(1, z * 0.09);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            if (g.cells[r * g.w + c] >= 0) continue;
            ctx.fillRect(gx + c * z + z / 2 - d / 2, gy + r * z + z / 2 - d / 2, d, d);
          }
        }
      }

      // 网格线
      if (this.opts.gridLines && z >= 5 && visible) {
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const yTop = Math.max(gy, a.y), yBot = Math.min(gy + g.h * z, a.y + a.h);
        for (let c = c0; c <= c1 + 1; c++) {
          const x = Math.round(gx + c * z) + 0.5;
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBot);
        }
        const xLeft = Math.max(gx, a.x), xRight = Math.min(gx + g.w * z, a.x + a.w);
        for (let r = r0; r <= r1 + 1; r++) {
          const y = Math.round(gy + r * z) + 0.5;
          ctx.moveTo(xLeft, y);
          ctx.lineTo(xRight, y);
        }
        ctx.stroke();
      }

      // 拼豆板分板线
      if (this.opts.guides && z >= 3) {
        const bs = this.opts.boardSize || 29;
        ctx.strokeStyle = 'rgba(255,183,90,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const yTop = Math.max(gy, a.y), yBot = Math.min(gy + g.h * z, a.y + a.h);
        for (let c = bs; c < g.w; c += bs) {
          const x = Math.round(gx + c * z) + 0.5;
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBot);
        }
        const xLeft = Math.max(gx, a.x), xRight = Math.min(gx + g.w * z, a.x + a.w);
        for (let r = bs; r < g.h; r += bs) {
          const y = Math.round(gy + r * z) + 0.5;
          ctx.moveTo(xLeft, y);
          ctx.lineTo(xRight, y);
        }
        ctx.stroke();
      }

      // 格子里的色号标识（高亮时只标高亮色，避免糊成一片）
      if (this.opts.codes && p && z >= 9 && visible && (c1 - c0 + 1) * (r1 - r0 + 1) <= 12000) {
        const fs = Math.max(5, Math.min(11, z * 0.32));
        ctx.font = '600 ' + fs.toFixed(1) + 'px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxW = z - 1.5;
        const cache = new Map();
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const v = g.cells[r * g.w + c];
            if (v < 0) continue;
            if (hl >= 0 && v !== hl) continue;
            const col = p.colors[v];
            if (!col) continue;
            let text = cache.get(v);
            if (text === undefined) {
              // 格子放不下完整色号时逐级缩短：H02 → 02，再不行就不画（宁可没有，也不要糊成一团）
              text = col.code;
              if (ctx.measureText(text).width > maxW) {
                const digits = text.replace(/^[A-Z]+/, '');
                text = digits && ctx.measureText(digits).width <= maxW ? digits : '';
              }
              cache.set(v, text);
            }
            if (!text) continue;
            ctx.fillStyle = C.luma(col.rgb) > 140 ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.9)';
            ctx.fillText(text, gx + c * z + z / 2, gy + r * z + z / 2 + 0.5);
          }
        }
      }

      // 边框
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(gx) + 0.5, Math.round(gy) + 0.5, g.w * z, g.h * z);

      // 悬停 / 笔刷预览
      if (this.hover && visible) {
        const { r, c } = this.hover;
        const n = this.tool === 'brush' ? this.brush : 1;
        const r0h = r - ((n - 1) >> 1), c0h = c - ((n - 1) >> 1);
        if (this.tool === 'brush' && p && p.colors[this.color]) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = p.colors[this.color].hex;
          for (let dr = 0; dr < n; dr++) {
            for (let dc = 0; dc < n; dc++) {
              const rr = r0h + dr, cc = c0h + dc;
              if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
              ctx.fillRect(gx + cc * z, gy + rr * z, z + 0.4, z + 0.4);
            }
          }
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = '#4ea1ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + c0h * z + 1, gy + r0h * z + 1, z * n - 2, z * n - 2);
      }
      ctx.restore();

      this._drawRulers(ctx, gx, gy, z, c0, c1, r0, r1);
      if (this.onView) this.onView(this.view);
    }

    _drawRulers(ctx, gx, gy, z, c0, c1, r0, r1) {
      const W = this.cssW, H = this.cssH, g = this.grid;
      ctx.save();
      ctx.fillStyle = '#131a26';
      ctx.fillRect(0, 0, W, M.top);
      ctx.fillRect(0, 0, M.left, H);
      ctx.strokeStyle = '#2a3242';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, M.top + 0.5); ctx.lineTo(W, M.top + 0.5);
      ctx.moveTo(M.left + 0.5, 0); ctx.lineTo(M.left + 0.5, H);
      ctx.stroke();

      const z0 = this.view.zoom;
      const step = z0 >= 26 ? 1 : z0 >= 13 ? 2 : z0 >= 7 ? 5 : 10;
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#8b97ad';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let c = 0; c < g.w; c++) {
        const isEdge = (c + 1) % (this.opts.boardSize || 29) === 0;
        if (c % step !== 0 && !isEdge) continue;
        const x = gx + c * z + z / 2;
        if (x < M.left + 6 || x > W - 6) continue;
        ctx.fillStyle = isEdge ? '#ffb75a' : '#8b97ad';
        ctx.fillText(String(c + 1), x, M.top / 2);
      }
      ctx.textAlign = 'right';
      for (let r = 0; r < g.h; r++) {
        const isEdge = (r + 1) % (this.opts.boardSize || 29) === 0;
        if (r % step !== 0 && !isEdge) continue;
        const y = gy + r * z + z / 2;
        if (y < M.top + 6 || y > H - 6) continue;
        ctx.fillStyle = isEdge ? '#ffb75a' : '#8b97ad';
        ctx.fillText(String(r + 1), M.left - 6, y);
      }

      if (this.hover) {
        ctx.fillStyle = '#4ea1ff';
        const hx = gx + this.hover.c * z + z / 2;
        const hy = gy + this.hover.r * z + z / 2;
        if (hx > M.left && hx < W) ctx.fillRect(hx - 1, M.top - 3, 2, 3);
        if (hy > M.top && hy < H) ctx.fillRect(M.left - 3, hy - 1, 3, 2);
      }
      ctx.restore();
    }

    _emit(kind) {
      if (this.onGridChange) this.onGridChange(kind, this.grid);
    }
  }

  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  root.PDEditor = Editor;
  root.PDEditor.isTyping = isTyping;
})(globalThis);
