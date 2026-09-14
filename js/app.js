/* 雪王拼豆 · 界面装配 */
(function () {
  'use strict';

  const C = window.PDColor, E = window.PDEngine, X = window.PDExport;
  const $ = (id) => document.getElementById(id);
  const LS = { stock: 'pindou.stock.v1', settings: 'pindou.settings.v1', auto: 'pindou.autosave.v1' };

  const DEMO = [
    '................',
    '................',
    '...####..####...',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
    '................',
    '................',
  ];

  const state = {
    palettes: C.getBuiltinPalettes(),
    palette: null,
    img: null,
    imgFileName: '',
    stock: {},
    counts: { list: [], total: 0, colors: 0 },
    mode: 'preview',   // 默认预览，防止误触改图
  };

  let editor = null;
  let asTimer = 0;
  let setTimer = 0;
  let lastZoom = 0;

  /* ================= 启动 ================= */

  function init() {
    editor = new window.PDEditor($('grid'));
    editor.onGridChange = () => refreshCounts();
    editor.onHover = onHover;
    editor.onHistory = updateUndoRedo;
    editor.onView = (v) => {
      if (v.zoom !== lastZoom) {
        lastZoom = v.zoom;
        $('zoomLabel').textContent = Math.round(v.zoom * 100) + '%';
      }
    };
    editor.onPick = (idx) => {
      editor.setColor(idx);
      setTool('brush');
      syncColorUI();
    };
    editor.onColorChange = (idx) => {
      if ($('optHighlight').checked) editor.setHighlight(idx);
      syncColorUI();
      markCountRow();
    };

    loadStock();
    const saved = loadSettings();
    buildPaletteOptions();
    const preferred = (saved && saved.paletteId && state.palettes.find((p) => p.id === saved.paletteId)) || state.palettes[0];
    selectPalette(preferred, { remap: false, silent: true });
    applySettings(saved);
    applyViewOptions();
    editor.brush = +$('brushSize').value || 1;

    wire();
    setTool('brush');
    setMode('preview', { silent: true });   // 默认预览模式
    setSidebar(false);
    if (!restoreAutosave()) refreshCounts();
    updateUndoRedo();
    syncSliderLabels();
    syncColorUI();
    $('saveState').textContent = '自动保存：等待编辑…';
    lastZoom = editor.view.zoom;
    $('zoomLabel').textContent = Math.round(editor.view.zoom * 100) + '%';
  }

  /* ================= 色卡 ================= */

  function buildPaletteOptions() {
    const sel = $('paletteSelect');
    sel.innerHTML = state.palettes
      .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '（' + p.colors.length + ' 色）</option>')
      .join('');
  }

  function selectPalette(palette, o) {
    o = o || {};
    const old = state.palette;
    state.palette = palette;
    $('paletteSelect').value = palette.id;
    editor.setPalette(palette);
    renderSwatches();
    updatePaletteNote();

    const hasContent = gridHasContent();
    if (o.remap && old && hasContent) {
      editor.pushFull('palette');
      const ng = C.remapGrid(editor.grid, old, palette);
      editor.grid = { w: ng.w, h: ng.h, cells: ng.cells };
      editor.requestRender();
      refreshCounts();
      if (!o.silent) toast('已按新色卡重新配色');
    }
    syncColorUI();
    if ($('optHighlight').checked) editor.setHighlight(editor.color);
    markCountRow();
    saveSettings();
  }

  /** 品牌色卡要标清楚数据来源和「屏幕色≠实物色」，别让人以为是我们编的色号 */
  function updatePaletteNote() {
    const el = $('paletteNote');
    const p = state.palette;
    if (!p || !p.source) { el.hidden = true; el.textContent = ''; return; }
    const parts = [];
    parts.push(p.brand ? (p.brand + ' 真实色卡') : '色卡数据');
    parts.push(p.source);
    if (p.sourceUpdated) parts.push('源数据更新 ' + p.sourceUpdated);
    parts.push('色号为' + (p.brand || '该品牌') + '官方色号，可直接照着买豆');
    parts.push('HEX 是屏幕近似值，实物受光线/批次影响，以实物色卡为准');
    el.hidden = false;
    el.textContent = parts.join(' · ');
  }

  function renderSwatches() {
    const box = $('swatches');
    box.innerHTML = state.palette.colors
      .map((c, i) => '<span class="sw" data-i="' + i + '" data-code="' + esc(c.code) + '" data-name="' + esc(c.name) +
        '" style="background:' + c.hex + '" title="' + esc(c.code + ' ' + c.name + ' ' + c.hex) + '"></span>')
      .join('');
    $('swatchFilter').value = '';
    applySwatchFilter();
    markSwatch();
  }

  /** 大色卡（221 色）靠搜索定位，否则色板太长不好找 */
  function applySwatchFilter() {
    const q = ($('swatchFilter').value || '').trim().toLowerCase();
    const box = $('swatches');
    const colors = state.palette.colors;
    let shown = 0;
    for (let i = 0; i < box.children.length; i++) {
      const el = box.children[i];
      const c = colors[i];
      let hit = true;
      if (q) {
        hit = (c.code + ' ' + c.name + ' ' + c.hex).toLowerCase().indexOf(q) >= 0;
      }
      el.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    $('swatchCount').textContent = q
      ? '匹配 ' + shown + ' / ' + colors.length + ' 色' + (shown ? '' : '（没有匹配，试试色号或颜色名）')
      : '共 ' + colors.length + ' 色';
  }

  function markSwatch() {
    const box = $('swatches');
    for (let i = 0; i < box.children.length; i++) {
      box.children[i].classList.toggle('sel', i === editor.color);
    }
  }

  function syncColorUI() {
    const c = state.palette.colors[editor.color];
    if (!c) { $('colorCode').textContent = '—'; $('colorChip').style.background = 'transparent'; return; }
    $('colorChip').style.background = c.hex;
    $('colorCode').textContent = c.code + ' ' + c.name + ($('optHighlight').checked ? '（高亮中）' : '');
    markSwatch();
  }

  function applyCustomPalette() {
    const txt = $('customPaletteText').value;
    let parsed;
    try { parsed = C.parsePaletteText(txt); } catch (err) { toast('色卡解析失败：' + err.message, 'err'); return; }
    const palette = C.makePalette('custom-' + Date.now(), parsed.name === '自定义色卡' ? '自定义色卡（' + parsed.colors.length + '色）' : parsed.name, parsed.colors);
    const idx = state.palettes.findIndex((p) => p.id === palette.id);
    if (idx >= 0) state.palettes[idx] = palette; else state.palettes.push(palette);
    buildPaletteOptions();
    selectPalette(palette, { remap: true });
    toast('已应用自定义色卡：' + parsed.colors.length + ' 色' + (parsed.dups ? '（去掉 ' + parsed.dups + ' 个重复色）' : ''), 'ok');
  }

  function resetCustomPalettes() {
    state.palettes = state.palettes.filter((p) => !/^custom-/.test(p.id));
    buildPaletteOptions();
    selectPalette(state.palettes[0], { remap: false, silent: true });
    $('customPaletteText').value = '';
    toast('已清除自定义色卡');
  }

  /* ================= 图片 ================= */

  function drawPreview(img) {
    const cv = $('imgPreview');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    cv.style.display = 'block';
  }

  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
      toast('请选择图片文件（PNG / JPG / GIF / WebP）', 'err');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.img = img;
      state.imgFileName = file.name;
      $('imgName').textContent = file.name + '（' + img.naturalWidth + '×' + img.naturalHeight + '）';
      drawPreview(img);
      if ($('keepRatio').checked) syncHeightFromImage();
      URL.revokeObjectURL(url);
      toast('图片已载入，点「生成图纸」开始转换', 'ok');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('图片解码失败，换个格式试试', 'err');
    };
    img.src = url;
  }

  function syncHeightFromImage() {
    if (!state.img) return;
    const w = clampInt(+$('gridW').value || 48, 4, 400);
    const h = clampInt(Math.round(w * state.img.naturalHeight / state.img.naturalWidth), 4, 400);
    $('gridH').value = h;
  }

  function generate() {
    if (!state.img) { toast('先拖一张图片进来，或点「示例图案」', 'err'); return; }
    const t0 = performance.now();
    try {
      const g = E.imageToGrid(state.img, {
        gridW: clampInt(+$('gridW').value || 48, 4, 400),
        gridH: clampInt(+$('gridH').value || 48, 4, 400),
        palette: state.palette,
        dither: $('dither').checked,
        transparent: $('keepAlpha').checked,
        alphaThreshold: +$('alphaThreshold').value,
        maxColors: Math.max(0, +$('maxColors').value || 0),
        brightness: +$('brightness').value,
        contrast: +$('contrast').value,
        saturation: +$('saturation').value,
      });
      $('gridW').value = g.w;
      $('gridH').value = g.h;
      // 去四周背景：在限色之后做，否则背景被限色合并进主体色就再也分不出来了
      let bgRemoved = 0;
      if ($('dropBg').checked) {
        const bg = E.removeEdgeBackground(g.cells, g.w, g.h);
        g.cells = bg.cells;
        bgRemoved = bg.removed;
      }
      editor.replaceGrid({ w: g.w, h: g.h, cells: g.cells }, { label: 'image' });
      const ms = Math.round(performance.now() - t0);
      const counts = E.countUsage(g.cells, state.palette);
      toast('生成完成：' + g.w + '×' + g.h + ' 格 · ' + counts.total + ' 颗豆 · ' + counts.colors + ' 种颜色' +
        (bgRemoved ? ' · 去掉背景 ' + bgRemoved + ' 格' : '') + ' · ' + ms + 'ms', 'ok');
    } catch (err) {
      toast('生成失败：' + err.message, 'err');
    }
  }

  function loadDemo() {
    const w = DEMO[0].length, h = DEMO.length;
    const fill = C.nearestRgb([224, 58, 47], state.palette);
    const cells = new Int16Array(w * h).fill(-1);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (DEMO[r][c] === '#') cells[r * w + c] = fill;
      }
    }
    editor.replaceGrid({ w, h, cells }, { label: 'demo' });
    $('gridW').value = w;
    $('gridH').value = h;
    toast('已载入示例图案（16×16 爱心）', 'ok');
  }

  /* ================= 用豆清单 / 库存 ================= */

  function refreshCounts() {
    const counts = E.countUsage(editor.grid.cells, state.palette);
    state.counts = counts;
    const onlyShort = $('stockOnly').checked;
    const rows = counts.list.filter((row) => {
      if (!onlyShort) return true;
      const have = state.stock[row.color.hex] || 0;
      return row.count > have;
    });
    $('countsBody').innerHTML = rows.map((row) => {
      const hex = row.color.hex;
      const have = state.stock[hex] || 0;
      const diff = Math.max(0, row.count - have);
      const on = editor.highlight === row.index;
      return '<tr data-hex="' + hex + '" data-count="' + row.count + '" data-idx="' + row.index + '"' +
        ' class="count-row' + (on ? ' active' : '') + '" title="点击高亮这个颜色在图纸上的位置">' +
        '<td class="sw-cell"><i style="background:' + hex + '"></i></td>' +
        '<td title="' + esc(row.color.name) + '">' + esc(row.color.code) + '</td>' +
        '<td>' + row.count + '</td>' +
        '<td><input class="stock" type="number" min="0" step="1" value="' + have + '"></td>' +
        '<td class="diff ' + (diff > 0 ? 'short' : 'ok') + '">' + diff + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" class="hint" style="padding:8px">' + (onlyShort ? '没有缺货的颜色' : '画布还是空的，先画点东西吧') + '</td></tr>';
    updateTotals();
    updateUndoRedo();
    scheduleAutosave();
  }

  /** 清单行的高亮态跟着编辑器走（点色卡、点清单、关开关都要同步） */
  function markCountRow() {
    const rows = $('countsBody').querySelectorAll ? $('countsBody').querySelectorAll('tr.count-row') : [];
    for (let i = 0; i < rows.length; i++) {
      const on = +rows[i].getAttribute('data-idx') === editor.highlight;
      if (on) rows[i].classList.add('active'); else rows[i].classList.remove('active');
    }
  }

  /**
   * 点用豆清单里的一行：选中这个颜色，并在图纸上高亮它的位置。
   * 再点同一行 = 取消高亮（不用跑去勾开关）。
   */
  function onCountRowClick(e) {
    // 点库存输入框是在填数字，不是要高亮
    if (e.target.closest && e.target.closest('input.stock')) return;
    const tr = e.target.closest ? e.target.closest('tr.count-row') : null;
    if (!tr) return;
    const idx = +tr.getAttribute('data-idx');
    if (!(idx >= 0)) return;
    const same = editor.highlight === idx;
    editor.setColor(idx);
    setTool('brush');
    $('optHighlight').checked = !same;
    applyViewOptions();
    saveSettings();
    const c = state.palette.colors[idx];
    toast(same ? ('已取消高亮：' + c.code) : ('已高亮 ' + c.code + ' ' + (c.name || '') + '，画布上只有这个颜色是亮的'), 'ok');
  }

  function updateTotals() {
    $('totalBeads').textContent = state.counts.total;
    $('totalColors').textContent = state.counts.colors;
    let short = 0;
    state.counts.list.forEach((row) => {
      const have = state.stock[row.color.hex] || 0;
      short += Math.max(0, row.count - have);
    });
    $('shortageCount').textContent = short;
  }

  function onStockInput(e) {
    const input = e.target.closest ? e.target.closest('input.stock') : null;
    if (!input) return;
    const tr = input.closest('tr');
    const hex = tr.getAttribute('data-hex');
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    state.stock[hex] = n;
    saveStock();
    const diff = Math.max(0, (+tr.getAttribute('data-count') || 0) - n);
    const cell = tr.querySelector('.diff');
    cell.textContent = diff;
    cell.className = 'diff ' + (diff > 0 ? 'short' : 'ok');
    updateTotals();
  }

  function loadStock() {
    try {
      const raw = localStorage.getItem(LS.stock);
      state.stock = raw ? JSON.parse(raw) || {} : {};
    } catch (_) { state.stock = {}; }
  }

  function saveStock() {
    try { localStorage.setItem(LS.stock, JSON.stringify(state.stock)); } catch (_) { /* 忽略 */ }
  }

  /* ================= 设置 ================= */

  function currentSettings() {
    return {
      gridW: +$('gridW').value || 48,
      gridH: +$('gridH').value || 48,
      keepRatio: $('keepRatio').checked,
      brightness: +$('brightness').value,
      contrast: +$('contrast').value,
      saturation: +$('saturation').value,
      keepAlpha: $('keepAlpha').checked,
      dither: $('dither').checked,
      alphaThreshold: +$('alphaThreshold').value,
      maxColors: +$('maxColors').value || 0,
      dropBg: $('dropBg').checked,
      beadMM: +$('beadMM').value || 5,
      brush: +$('brushSize').value || 1,
      codes: $('optCodes').checked,
      gridLines: $('optGridLines').checked,
      guides: $('optBoardGuides').checked,
      highlight: $('optHighlight').checked,
      paletteId: state.palette ? state.palette.id : null,
    };
  }

  function applySettings(s) {
    if (!s) return;
    const num = (id, v) => { if (typeof v === 'number') $(id).value = v; };
    num('gridW', s.gridW); num('gridH', s.gridH);
    num('brightness', s.brightness); num('contrast', s.contrast); num('saturation', s.saturation);
    num('alphaThreshold', s.alphaThreshold); num('maxColors', s.maxColors);
    num('beadMM', s.beadMM); num('brushSize', s.brush);
    if (typeof s.keepRatio === 'boolean') $('keepRatio').checked = s.keepRatio;
    if (typeof s.keepAlpha === 'boolean') $('keepAlpha').checked = s.keepAlpha;
    if (typeof s.dither === 'boolean') $('dither').checked = s.dither;
    if (typeof s.dropBg === 'boolean') $('dropBg').checked = s.dropBg;
    if (typeof s.codes === 'boolean') $('optCodes').checked = s.codes;
    if (typeof s.highlight === 'boolean') $('optHighlight').checked = s.highlight;
    if (typeof s.gridLines === 'boolean') $('optGridLines').checked = s.gridLines;
    if (typeof s.guides === 'boolean') $('optBoardGuides').checked = s.guides;
  }

  /** 把界面上的显示开关同步给编辑器（色号标识 / 高亮当前色 / 网格线 / 分板线） */
  function applyViewOptions() {
    editor.setOptions({
      codes: $('optCodes').checked,
      gridLines: $('optGridLines').checked,
      guides: $('optBoardGuides').checked,
    });
    editor.setHighlight($('optHighlight').checked ? editor.color : -1);
    syncColorUI();
    markCountRow();
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS.settings);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveSettings() {
    clearTimeout(setTimer);
    setTimer = setTimeout(() => {
      try { localStorage.setItem(LS.settings, JSON.stringify(currentSettings())); } catch (_) { /* 忽略 */ }
    }, 300);
  }

  function syncSliderLabels() {
    $('brightnessVal').textContent = $('brightness').value + '%';
    $('contrastVal').textContent = $('contrast').value + '%';
    $('saturationVal').textContent = $('saturation').value + '%';
    $('alphaVal').textContent = $('alphaThreshold').value;
    syncBeadSizeHint();
  }

  /** 让「最多颜色数」旁边能直接看到成品大概多大（选豆径时尤其有用） */
  function syncBeadSizeHint() {
    const mm = +$('beadMM').value || 5;
    const w = parseInt($('gridW').value, 10) || 0;
    const h = parseInt($('gridH').value, 10) || 0;
    if (!w || !h) { $('beadSizeHint').textContent = '—'; return; }
    const cm = (v) => (v * mm / 10);
    $('beadSizeHint').textContent = '约 ' + cm(w).toFixed(1) + ' × ' + cm(h).toFixed(1) + ' cm（' + mm + 'mm 豆）';
  }

  /* ================= 自动保存 / 项目文件 ================= */

  function scheduleAutosave() {
    clearTimeout(asTimer);
    asTimer = setTimeout(doAutosave, 900);
  }

  function doAutosave() {
    try {
      localStorage.setItem(LS.auto, JSON.stringify(projectData(true)));
      const d = new Date();
      $('saveState').textContent = '自动保存：' + d.toLocaleTimeString('zh-CN') + '（存在浏览器本地）';
    } catch (err) {
      $('saveState').textContent = '自动保存不可用（浏览器禁用了本地存储），请用「导出项目」保存。';
    }
  }

  function projectData(compact) {
    return {
      app: 'pindou-studio', kind: 'project', version: 1,
      savedAt: new Date().toISOString(),
      grid: E.encodeGrid(editor.grid),
      palette: {
        id: state.palette.id, name: state.palette.name,
        colors: state.palette.colors.map((c) => ({ code: c.code, hex: c.hex, name: c.name })),
      },
      stock: state.stock,
      settings: compact ? undefined : currentSettings(),
    };
  }

  function saveProject() {
    try {
      const blob = new Blob([JSON.stringify(projectData(false), null, 2)], { type: 'application/json' });
      X.download(blob, '雪王拼豆-项目-' + X.stamp() + '.json');
      toast('项目已导出', 'ok');
    } catch (err) { toast('导出失败：' + err.message, 'err'); }
  }

  function openProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data.grid) throw new Error('不是雪王拼豆的项目文件');
        if (data.palette && data.palette.colors && data.palette.colors.length) {
          const pal = C.makePalette('imported-' + Date.now(), (data.palette.name || '项目色卡') + '', data.palette.colors.map((c) => C.makeColor(c.code || '?', c.hex, c.name || '')));
          state.palettes.push(pal);
          buildPaletteOptions();
          selectPalette(pal, { remap: false, silent: true });
        }
        const grid = E.decodeGrid(data.grid);
        editor.replaceGrid(grid, { label: 'open' });
        $('gridW').value = grid.w;
        $('gridH').value = grid.h;
        if (data.stock) { state.stock = data.stock; saveStock(); }
        if (data.settings) { applySettings(data.settings); applyViewOptions(); syncSliderLabels(); }
        refreshCounts();
        toast('项目已载入：' + grid.w + '×' + grid.h, 'ok');
      } catch (err) {
        toast('载入失败：' + err.message, 'err');
      }
    };
    reader.readAsText(file);
  }

  function restoreAutosave() {
    let data;
    try {
      const raw = localStorage.getItem(LS.auto);
      if (!raw) return false;
      data = JSON.parse(raw);
      const grid = E.decodeGrid(data.grid);
      let has = false;
      for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] >= 0) { has = true; break; }
      if (!has) return false;
      if (data.palette && data.palette.colors && data.palette.colors.length) {
        const pal = C.makePalette(data.palette.id || 'restored', data.palette.name || '上次的色卡',
          data.palette.colors.map((c) => C.makeColor(c.code || '?', c.hex, c.name || '')));
        const idx = state.palettes.findIndex((p) => p.id === pal.id);
        if (idx >= 0) state.palettes[idx] = pal; else state.palettes.push(pal);
        buildPaletteOptions();
        selectPalette(pal, { remap: false, silent: true });
      }
      if (data.stock) state.stock = data.stock;
      editor.replaceGrid(grid, { label: '恢复', record: false });
      $('gridW').value = grid.w;
      $('gridH').value = grid.h;
      refreshCounts();
      const when = data.savedAt ? new Date(data.savedAt).toLocaleString('zh-CN') : '';
      toast('已恢复上次编辑的图案' + (when ? '（' + when + '）' : '') + '，点「新建」可清空', 'ok');
      return true;
    } catch (_) { return false; }
  }

  function newProject() {
    if (gridHasContent() && !window.confirm('清空当前图案？（可用 Ctrl+Z 撤销）')) return;
    editor.replaceGrid(E.newGrid(29, 29, -1), { label: '新建' });
    $('gridW').value = 29;
    $('gridH').value = 29;
    try { localStorage.removeItem(LS.auto); } catch (_) { /* 忽略 */ }
    $('saveState').textContent = '自动保存：已新建空白作品';
    refreshCounts();
    toast('已新建 29×29 空白作品', 'ok');
  }

  /* ================= 导出 ================= */

  function chooseCell(limit) {
    limit = limit || 2600;
    const w = editor.grid.w;
    if (w <= 64) return 30;
    return Math.max(8, Math.floor(limit / w));
  }

  function buildPattern(cell) {
    const counts = E.countUsage(editor.grid.cells, state.palette);
    return {
      canvas: X.patternCanvas({
        grid: editor.grid, palette: state.palette, counts,
        cell, codes: true, ruler: true,
        guides: editor.opts.guides, boardSize: 29,
        beadMM: +$('beadMM').value || 5,
      }),
      counts,
    };
  }

  async function exportPng() {
    if (!gridHasContent()) { toast('画布还是空的', 'err'); return; }
    try {
      const built = buildPattern(chooseCell());
      await X.downloadCanvas(built.canvas, '雪王拼豆-图纸-' + X.stamp() + '.png');
      toast('图纸已导出：' + built.canvas.width + '×' + built.canvas.height + ' px', 'ok');
    } catch (err) { toast('导出失败：' + err.message, 'err'); }
  }

  function printPattern() {
    if (!gridHasContent()) { toast('画布还是空的', 'err'); return; }
    const g = editor.grid;
    const bead = +$('beadMM').value || 5;
    // 打印时 1 CSS px = 1/96 英寸 → 想要 1:1 实物尺寸，格距需为 豆径(mm) × 96 / 25.4
    const perMM = 96 / 25.4;
    let cell = Math.max(8, Math.round(bead * perMM));
    let oneToOne = true;
    const MAX_PX = 11000;
    if (g.w * cell > MAX_PX) {
      cell = Math.max(6, Math.floor(MAX_PX / g.w));
      oneToOne = false;
    }
    const built = buildPattern(cell);
    const meta = '尺寸 ' + g.w + ' × ' + g.h + ' 格 · ' + bead + 'mm 拼豆 · 成品约 ' +
      (g.w * bead / 10).toFixed(1) + ' × ' + (g.h * bead / 10).toFixed(1) + ' cm · 总豆数 ' +
      built.counts.total + ' 颗 · 配色 ' + built.counts.colors + ' 种 · ' +
      (oneToOne ? '按 100% 打印即为实物原大（1:1）' : '图案过大，已按 ' + cell + 'px/格 输出，打印后会缩放');
    X.buildPrintSheet($('printSheet'), {
      canvas: built.canvas,
      title: '雪王拼豆 · 图纸',
      meta,
      rows: X.legendRows(built.counts),
      foot: '打印设置：缩放选「100% / 实际大小」而不是「适合页面」，分板线每 29 格一条对应一块 29×29 拼豆板；' +
        '图案超出 A4 时会自动分页，拼接时以分板线和坐标为准。',
    });
    X.printSheet($('printSheet'));
    toast('已调起打印窗口：缩放记得选 100%，再「另存为 PDF」' + (oneToOne ? '（当前为 1:1 实物尺寸）' : ''));
  }

  function exportCsv() {
    if (!state.counts.list.length) { toast('清单是空的', 'err'); return; }
    try {
      const blob = new Blob([X.countsToCsv(state.counts, state.stock)], { type: 'text/csv;charset=utf-8' });
      X.download(blob, '雪王拼豆-用豆清单-' + X.stamp() + '.csv');
      toast('清单已导出 CSV', 'ok');
    } catch (err) { toast('导出失败：' + err.message, 'err'); }
  }

  /* ================= 交互 ================= */

  function setTool(t) {
    editor.setTool(t);
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tool') === t));
  }

  /* ================= 预览 / 编辑模式 ================= */

  /**
   * 预览模式是默认模式：画布只读，拖拽只平移，绝不会手一滑就把图案改了。
   * 想改图必须显式切到编辑模式。
   */
  function setMode(mode, o) {
    const opt = o || {};
    const edit = mode === 'edit';
    state.mode = edit ? 'edit' : 'preview';
    editor.setPreview(!edit);
    document.body.classList.toggle('mode-edit', edit);
    document.body.classList.toggle('mode-preview', !edit);
    $('modePreview').classList.toggle('active', !edit);
    $('modeEdit').classList.toggle('active', edit);
    $('modePreview').setAttribute('aria-pressed', String(!edit));
    $('modeEdit').setAttribute('aria-pressed', String(edit));
    $('statusMode').textContent = edit ? '编辑模式' : '预览模式';
    $('statusMode').classList.toggle('editing', edit);
    $('statusHint').textContent = edit
      ? '左键绘制 · 空格/中键拖拽平移 · 滚轮缩放 · Ctrl+Z 撤销'
      : '预览模式：拖拽移动 · 滚轮缩放 · 点用豆清单的行可高亮该颜色（不会误改图案）';
    if (edit && !opt.silent) toast('已进入编辑模式，现在可以改图了');
    if (!edit && !opt.silent) toast('已回到预览模式，图案不会被误改');
    updateUndoRedo();
  }

  function isEditing() { return state.mode === 'edit'; }

  /** 编辑类操作统一入口：预览模式下给出明确提示，而不是默默没反应 */
  function needEdit() {
    if (isEditing()) return true;
    toast('现在处于预览模式（防止误触改图），请先点顶部「编辑」', 'err');
    return false;
  }

  /* ================= 侧边栏（窄屏抽屉） ================= */

  function setSidebar(open) {
    const o = !!open;
    document.body.classList.toggle('sidebar-open', o);
    $('btnSidebar').setAttribute('aria-expanded', String(o));
    $('scrim').hidden = !o || !isNarrow();
  }

  function isNarrow() {
    return window.matchMedia ? window.matchMedia('(max-width: 900px)').matches : window.innerWidth <= 900;
  }

  function toggleSidebar() { setSidebar(!document.body.classList.contains('sidebar-open')); }

  function onHover(info) {
    if (!info) {
      $('statusCell').textContent = '格：—';
      $('statusColor').textContent = '色：—';
      return;
    }
    $('statusCell').textContent = '格：' + (info.c + 1) + ' 列 ' + (info.r + 1) + ' 行';
    if (info.index < 0 || !state.palette.colors[info.index]) $('statusColor').textContent = '色：空';
    else {
      const c = state.palette.colors[info.index];
      $('statusColor').textContent = '色：' + c.code + ' ' + c.name;
    }
  }

  function updateUndoRedo() {
    // 预览模式下禁掉撤销/重做，避免在用只读模式时误改图案
    const edit = isEditing();
    $('btnUndo').disabled = !edit || !editor.canUndo();
    $('btnRedo').disabled = !edit || !editor.canRedo();
    $('statusSize').textContent = '尺寸：' + editor.grid.w + ' × ' + editor.grid.h + ' 格';
  }

  function gridHasContent() {
    const cells = editor.grid.cells;
    for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) return true;
    return false;
  }

  function toast(msg, kind) {
    const host = $('toastHost');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 5200 : 3000);
  }

  function clampInt(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function wire() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

    // 工具按钮
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => setTool(b.getAttribute('data-tool')));
    });
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const n = +b.getAttribute('data-preset');
        $('gridW').value = n;
        if ($('keepRatio').checked && state.img) syncHeightFromImage(); else $('gridH').value = n;
        saveSettings();
      });
    });

    // 图片
    on('imageFile', 'change', (e) => loadImageFile(e.target.files && e.target.files[0]));
    on('dropZone', 'click', (e) => {
      const t = e.target;
      // label 自己会触发 input，别重复弹两次文件框
      if (t.tagName === 'INPUT' || (t.closest && t.closest('label'))) return;
      $('imageFile').click();
    });
    ['dragenter', 'dragover'].forEach((ev) => on('dropZone', ev, (e) => { e.preventDefault(); $('dropZone').classList.add('hover'); }));
    ['dragleave', 'drop'].forEach((ev) => on('dropZone', ev, () => $('dropZone').classList.remove('hover')));
    on('dropZone', 'drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImageFile(f);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    on('btnGenerate', 'click', generate);
    on('btnDemo', 'click', loadDemo);

    // 参数
    ['brightness', 'contrast', 'saturation', 'alphaThreshold'].forEach((id) => {
      on(id, 'input', () => { syncSliderLabels(); saveSettings(); });
    });
    on('gridW', 'input', () => { if ($('keepRatio').checked) syncHeightFromImage(); syncBeadSizeHint(); saveSettings(); });
    on('gridH', 'input', () => { syncBeadSizeHint(); saveSettings(); });
    on('keepRatio', 'change', () => { if ($('keepRatio').checked) syncHeightFromImage(); syncBeadSizeHint(); saveSettings(); });
    ['maxColors', 'dither', 'keepAlpha', 'dropBg'].forEach((id) => on(id, 'change', saveSettings));
    on('beadMM', 'change', () => { syncBeadSizeHint(); saveSettings(); });
    on('brushSize', 'change', () => { editor.brush = +$('brushSize').value || 1; saveSettings(); });
    ['optCodes', 'optGridLines', 'optBoardGuides', 'optHighlight'].forEach((id) => {
      on(id, 'change', () => {
        applyViewOptions();
        saveSettings();
      });
    });

    // 色卡
    on('paletteSelect', 'change', () => {
      const p = state.palettes.find((x) => x.id === $('paletteSelect').value);
      if (!p) return;
      const willRemap = gridHasContent() && p.colors.length !== state.palette.colors.length;
      if (willRemap && !window.confirm('把现有图案按「' + p.name + '」重新配色？\n（取消则只换色卡，图案颜色下标会尽量保持）')) {
        selectPalette(p, { remap: false, silent: true });
        return;
      }
      selectPalette(p, { remap: willRemap });
    });
    on('swatches', 'click', (e) => {
      const sw = e.target.closest ? e.target.closest('.sw') : null;
      if (!sw) return;
      editor.setColor(+sw.getAttribute('data-i'));
      syncColorUI();
    });
    on('swatchFilter', 'input', applySwatchFilter);
    on('paletteFile', 'change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        $('customPaletteText').value = String(reader.result);
        applyCustomPalette();
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    on('btnApplyPalette', 'click', applyCustomPalette);
    on('btnResetPalette', 'click', resetCustomPalettes);
    on('btnExportPalette', 'click', () => {
      const blob = new Blob([C.serializePalette(state.palette)], { type: 'application/json' });
      X.download(blob, '雪王拼豆-色卡-' + state.palette.id + '.json');
      toast('色卡已导出', 'ok');
    });

    // 模式 / 侧边栏
    on('modePreview', 'click', () => setMode('preview'));
    on('modeEdit', 'click', () => setMode('edit'));
    on('btnSidebar', 'click', toggleSidebar);
    on('scrim', 'click', () => setSidebar(false));

    // 编辑
    on('btnUndo', 'click', () => { if (needEdit()) editor.undo(); });
    on('btnRedo', 'click', () => { if (needEdit()) editor.redo(); });
    on('btnClear', 'click', () => { if (needEdit() && editor.clear()) toast('已清空画布（可撤销）'); });
    on('btnRotate', 'click', () => { if (needEdit() && editor.transform('rotate')) toast('已旋转 90°'); });
    on('btnFlipH', 'click', () => { if (needEdit() && editor.transform('flipH')) toast('已水平翻转'); });
    on('btnFlipV', 'click', () => { if (needEdit() && editor.transform('flipV')) toast('已垂直翻转'); });
    on('btnTrim', 'click', () => {
      if (!needEdit()) return;
      if (!editor.transform('trim')) toast('没有可裁剪的空白边', 'err');
    });
    on('btnDropBg', 'click', () => {
      if (!needEdit()) return;
      if (!gridHasContent()) { toast('画布还是空的', 'err'); return; }
      const r = editor.dropBackground();
      if (!r.removed) { toast('四周没找到成片的背景色，没有改动', 'err'); return; }
      const names = r.bg.map((i) => (state.palette.colors[i] || {}).code).filter(Boolean).join('、');
      toast('已去掉 ' + r.removed + ' 格周围背景' + (names ? '（' + names + '）' : '') + '，中间连着主体的部分已保留', 'ok');
    });

    // 视图
    on('zoomIn', 'click', () => editor.zoomBy(1.25));
    on('zoomOut', 'click', () => editor.zoomBy(1 / 1.25));
    on('zoomFit', 'click', () => { editor.fit(); editor.requestRender(); });

    // 清单
    on('countsBody', 'input', onStockInput);
    on('countsBody', 'click', onCountRowClick);
    on('countsBody', 'change', () => { if ($('stockOnly').checked) refreshCounts(); });
    on('stockOnly', 'change', refreshCounts);
    on('btnExportCsv', 'click', exportCsv);
    on('btnClearStock', 'click', () => {
      if (!window.confirm('清空所有库存数量？')) return;
      state.stock = {};
      saveStock();
      refreshCounts();
      toast('库存已清空');
    });

    // 项目
    on('btnNew', 'click', newProject);
    on('btnSaveProject', 'click', saveProject);
    on('btnOpenProject', 'click', () => $('projectFile').click());
    on('projectFile', 'change', (e) => { openProjectFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    on('btnExportPng', 'click', exportPng);
    on('btnExportPng2', 'click', exportPng);
    on('btnPrint', 'click', printPattern);
    // 窄屏点侧边栏里的按钮后自动收起抽屉，不然会挡住画布
    document.querySelector('.panel').addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b || !isNarrow()) return;
      if (b.id === 'btnSidebar' || b.closest('.details-toggle')) return;
      // 生成/导入这类动作执行完就收起，方便立刻看结果
      if (['btnGenerate', 'btnDemo', 'btnApplyPalette', 'btnExportCsv'].includes(b.id) || b.tagName === 'SUMMARY') return;
      setSidebar(false);
    });

    // 快捷键（预览模式下只保留缩放/平移，绘制类按键直接忽略）
    window.addEventListener('keydown', (e) => {
      if (window.PDEditor.isTyping(e)) return;
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') { e.preventDefault(); if (needEdit()) { if (e.shiftKey) editor.redo(); else editor.undo(); } return; }
      if (mod && k === 'y') { e.preventDefault(); if (needEdit()) editor.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
      if (mod) return;
      if (k === '0') { editor.fit(); editor.requestRender(); return; }
      if (k === '+' || k === '=') { editor.zoomBy(1.25); return; }
      if (k === '-') { editor.zoomBy(1 / 1.25); return; }
      if (k === 'p') { setMode(isEditing() ? 'preview' : 'edit'); return; }
      // 其余是绘制类：预览模式下不响应
      if (!isEditing()) return;
      if (k === 'b') setTool('brush');
      else if (k === 'e') setTool('eraser');
      else if (k === 'i') setTool('picker');
      else if (k === 'g') setTool('fill');
    });

    // 窗口尺寸变化时同步抽屉状态
    window.addEventListener('resize', () => {
      if (!isNarrow()) { $('scrim').hidden = true; document.body.classList.remove('sidebar-open'); }
      else $('scrim').hidden = !document.body.classList.contains('sidebar-open');
    });
  }

  /**
   * 自动化测试用的小钩子：把一个现成的网格装进编辑器并刷新界面。
   * 只暴露最小能力，不改变正常使用路径（正常使用请走「生成」「导入项目」「新建」）。
   */
  window.__loadGridForTest = (grid) => {
    editor.replaceGrid(grid, { label: 'test' });
    refreshCounts();
    return editor.grid;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
