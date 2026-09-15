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
    bindMirrors();
    setTool('brush');
    setMode('preview', { silent: true });   // 默认预览模式
    setSidebar(false);
    setGenOpen(true);
    if (!restoreAutosave()) refreshCounts();
    updateUndoRedo();
    syncSliderLabels();
    syncColorUI();
    syncMirrorsFromSide();
    renderChips();
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
    for (const id of ['imgPreview', 'imgPreviewM']) {
      const cv = $(id);
      if (!cv) continue;
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
  }

  /* ---- 生成区折叠 ----
     手机上的独立生成区已经删掉了（参数统一在弹窗里问），
     下面这几个函数保留成空操作，免得散落各处的调用点都要改。 */

  function setGenOpen() { /* 已无手机生成区 */ }
  function genIsOpen() { return false; }
  /** 侧边栏那套隐藏 input 现在是唯一数据源，没有「镜像」要同步了 */
  function syncMirrorsFromSide() { /* 无镜像控件 */ }
  function bindMirrors() { /* 无镜像控件 */ }

  /* ---- 预览区色块清单 ---- */

  /**
   * 清单每次都要整块重建（DOM 换新），滚动位置会丢。
   * 所以重建前记下当前位置，重建后恢复 —— 但只在「颜色集合没变」时恢复：
   * 重新生成图纸后颜色全变了，套用旧位置是错的。
   * 只活在本次会话里（内存变量），刷新页面就重置。
   */
  let chipScrollTop = 0;
  let chipSignature = '';

  /** 颜色集合的指纹：色号+颗数拼起来，变了说明是另一张图 */
  function chipsSignature(list) {
    return list.map((r) => r.color.code + ':' + r.count).join(',');
  }

  /** 把用量清单渲染出来（收在悬浮球弹出来的面板里） */
  function renderChips() {
    const host = $('chipList');
    if (!host) return;
    const list = state.counts.list.filter((r) => r.count > 0);
    $('chipCount').textContent = String(list.length);
    $('chipTotal').textContent = '共 ' + state.counts.total + ' 颗';
    // 球上的角标也跟着用色数量走
    const badge = $('chipBallCount');
    if (badge) badge.textContent = String(list.length);

    const sig = chipsSignature(list);
    const sameColors = sig === chipSignature;

    // 顺序很关键：
    //  1) 颜色变了 → 先把记忆清零，再往下走（否则重建后的 scrollTop=0 会被当成新位置记下来）
    //  2) 面板开着 → 记下用户当前滚到哪（刚打开时读到的是重建后的 0，不算数）
    //  3) 清空 DOM 前先记，清空后 scrollTop 天然变 0
    if (!sameColors) chipScrollTop = 0;
    else if (chipPanelIsOpen()) chipScrollTop = host.scrollTop;
    chipSignature = sig;

    host.textContent = '';
    for (const row of list) {
      const c = row.color;
      const b = document.createElement('button');
      b.className = 'pchip' + (editor.highlight === row.index ? ' active' : '');
      b.dataset.idx = String(row.index);
      b.type = 'button';
      b.title = c.code + ' × ' + row.count + ' 颗（点击高亮）';
      const sw = document.createElement('i');
      sw.className = 'pchip-sw';
      sw.style.background = c.hex;
      const code = document.createElement('b');
      // 竖排单列有空间，用完整色号（M09），不再截成 09
      code.textContent = c.code;
      const num = document.createElement('span');
      num.textContent = row.count + ' 颗';
      b.append(sw, code, num);
      host.appendChild(b);
    }
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '还没有图纸';
      host.appendChild(p);
    }

    // 恢复：颜色没变就回到用户原来的位置；变了就停在顶部
    host.scrollTop = sameColors ? chipScrollTop : 0;
  }

  /* ---- 顶栏「导出 ▾」浮层 ---- */
  let exportMenuOpen = false;
  function setExportMenu(open) {
    const menu = $('exportMenu');
    const btn = $('btnExport');
    if (!menu || !btn) return;
    exportMenuOpen = !!open;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function toggleExportMenu() { setExportMenu(!exportMenuOpen); }
  function closeExportMenu() { if (exportMenuOpen) setExportMenu(false); }

  /* ---- 悬浮色块球 ---- */
  function setChipPanel(open) {
    const panel = $('chipPanel');
    const ball = $('btnChipBall');
    if (!panel || !ball) return;
    panel.hidden = !open;
    ball.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function chipPanelIsOpen() {
    const panel = $('chipPanel');
    return !!panel && !panel.hidden;
  }
  function toggleChipPanel() {
    setChipPanel(!chipPanelIsOpen());
  }

  /** 色号太长时只留数字（M09 → 09），色块本来就小 */
  function shortCode(code) {
    return String(code).replace(/^[A-Za-z]+/, '') || String(code);
  }

  function onChipClick(e) {
    const b = e.target.closest && e.target.closest('.pchip');
    if (!b || !host_has(b)) return;
    const idx = +b.dataset.idx;
    if (!(idx >= 0)) return;
    // 和高亮逻辑跟清单行保持一致：再点同一个 = 取消
    const same = editor.highlight === idx;
    editor.setColor(idx);
    setTool('brush');
    $('optHighlight').checked = !same;
    applyViewOptions();     // 开关状态要真正下发到编辑器
    syncColorUI();
    markCountRow();
    renderChips();
    saveSettings();
  }

  /**
   * 手机/平板上生成完：收起生成区，把预览区滚到眼前。
   * 桌面端（>900px）不滚动，避免把已经看好的侧边栏顶走。
   */
  function focusPreview() {
    if (!isNarrow()) return;
    setGenOpen(false);
    const el = $('previewArea');
    if (!el) return;
    // 等收起动画结束再滚，否则滚到的位置会偏
    setTimeout(() => {
      // 顶栏是吸顶的，直接 scrollIntoView 会把预览区塞到它底下，
      // 所以自己算位置：目标位置减去顶栏高度再留一点余量。
      const bar = document.querySelector('.topbar');
      const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
      const y = el.getBoundingClientRect().top + (window.pageYOffset || 0) - offset;
      try {
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      } catch (_) {
        window.scrollTo(0, Math.max(0, y));
      }
      // 布局变了，让编辑器重新量一次画布尺寸
      if (editor.resize) editor.resize();
    }, 80);
  }
  function host_has(el) { return !!(el && el.closest && el.closest('#chipList')); }

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
      // 图载入后直接弹参数窗，选完格数/颜色数/去背景就能生成
      setTimeout(openGenModal, 80);
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
    syncMirrorsFromSide();
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
      // 有图了才显示「重新配置」——它就是再弹一次参数窗，不用重新选图
      const rc = $('btnReconfig');
      if (rc) rc.hidden = false;
      focusPreview();
    } catch (err) {
      toast('生成失败：' + err.message, 'err');
    }
  }

  /**
   * 示例图案是固定 16×16 的内置图形，没有原图、也没有比例可锁，
   * 所以它直接出图，不弹参数窗（弹窗是给「选图片转图纸」用的）。
   */
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
    syncBeadSizeHint();
    toast('已载入示例图案（16×16 爱心）', 'ok');
    focusPreview();
  }

  /* ================= 全屏预览 ================= */

  /**
   * 全屏有两条路：
   *   1) 真 Fullscreen API（桌面浏览器、Chrome/Edge 安卓都支持）；
   *   2) 不支持就直接用 CSS 铺满视口（iOS Safari 上 requestFullscreen 缺失）。
   * 不管走哪条，body 都会带 fs-on，样式统一；差别只是地址栏还在不在。
   */
  let fsActive = false;

  function fsSupported(el) {
    return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
  }

  function isFsNow() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /** 试着把设备转成横屏。浏览器一般不允许网页强制转屏，
   *  只有安装成 PWA 且处于 fullscreen 时才可能成功，失败就静默忽略。 */
  function tryLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        const p = screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(() => { /* 转不动就算了，布局本来就兼容竖屏 */ });
      }
    } catch (_) { /* 忽略 */ }
  }

  function unlockOrientation() {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (_) { /* 忽略 */ }
  }

  /** 全屏时提示怎么操作，几秒后淡出 */
  let fsTipTimer = 0;
  function syncFsTip() {
    const tip = $('fsTip');
    if (!tip) return;
    if (!fsActive) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.classList.remove('gone');
    clearTimeout(fsTipTimer);
    fsTipTimer = setTimeout(() => tip.classList.add('gone'), 3200);
  }

  function enterFullscreen() {
    if (fsActive) return;
    fsActive = true;
    const wrap = $('canvasWrap');
    document.body.classList.add('fs-on');
    const btn = $('btnExitFullscreen');
    if (btn) btn.hidden = false;
    // 真全屏：失败（被拒绝/不支持）也无所谓，CSS 那套已经生效了。
    // 转屏要等真全屏成功之后再试 —— orientation.lock() 在非全屏状态下必定失败。
    let lockAfter = false;
    if (fsSupported(wrap) && !isFsNow()) {
      lockAfter = true;
      try {
        const p = wrap.requestFullscreen
          ? wrap.requestFullscreen({ navigationUI: 'hide' })
          : wrap.webkitRequestFullscreen();
        if (p && p.then) p.then(() => { tryLandscape(); }).catch(() => { /* 拒绝就退回 CSS 全屏 */ });
        else setTimeout(tryLandscape, 120);
      } catch (_) { setTimeout(tryLandscape, 120); }
    }
    // 没走原生全屏（iOS 等）：直接试一次，转不动就算了
    if (!lockAfter) tryLandscape();
    if (editor.resize) editor.resize();
    setTimeout(() => { if (editor.fit) { editor.fit(); editor.requestRender(); } }, 60);
    syncFsTip();
    toast('已进入全屏预览，双击或按 Esc 退出', 'ok');
  }

  function exitFullscreen() {
    if (!fsActive) return;
    fsActive = false;
    document.body.classList.remove('fs-on');
    const btn = $('btnExitFullscreen');
    if (btn) btn.hidden = true;
    const tip = $('fsTip');
    if (tip) { tip.hidden = true; tip.classList.add('gone'); }
    unlockOrientation();
    if (isFsNow()) {
      try {
        const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
        if (p && p.catch) p.catch(() => { /* 忽略 */ });
      } catch (_) { /* 忽略 */ }
    }
    if (editor.resize) editor.resize();
    setTimeout(() => { if (editor.fit) { editor.fit(); editor.requestRender(); } }, 60);
    toast('已退出全屏');
  }

  function toggleFullscreen() {
    if (fsActive) exitFullscreen(); else enterFullscreen();
  }

  /* ================= 生成参数弹窗 ================= */

  /**
   * 弹窗里的控件是「镜像」：改了它就等于改了侧边栏那个原始 input，
   * 点「开始生成」时读的还是原始 input。这样两边永远不会不一致，
   * 也不用把参数在两处同步来同步去。
   */
  const GEN_MODAL_PAIRS = [
    ['gridWModal', 'gridW'], ['gridHModal', 'gridH'],
    ['maxColorsModal', 'maxColors'], ['dropBgModal', 'dropBg'],
    ['keepRatioModal', 'keepRatio'],
  ];

  let genModalOpen = false;

  /** 把侧边栏的值刷到弹窗控件上 */
  function syncModalFromSide() {
    for (const [m, s] of GEN_MODAL_PAIRS) {
      const a = $(m); const b = $(s);
      if (!a || !b) continue;
      if (a.type === 'checkbox') a.checked = b.checked;
      else a.value = b.value;
    }
  }

  /** 弹窗改了 → 写回侧边栏（手机生成区和侧边栏也会跟着走） */
  function syncSideFromModal() {
    for (const [m, s] of GEN_MODAL_PAIRS) {
      const a = $(m); const b = $(s);
      if (!a || !b) continue;
      if (a.type === 'checkbox') b.checked = a.checked;
      else b.value = a.value;
    }
    syncMirrorsFromSide();
    saveSettings();
  }

  function openGenModal() {
    const m = $('genModal');
    if (!m) return;
    syncModalFromSide();
    // 缩略图：让用户确认选的是哪张图
    const thumb = $('genModalThumb');
    const cv = $('genModalPreview');
    if (state.img && thumb && cv) {
      thumb.hidden = false;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, cv.width, cv.height);
        // 按比例缩放居中，不拉伸变形
        const r = Math.min(cv.width / state.img.naturalWidth, cv.height / state.img.naturalHeight);
        const w = state.img.naturalWidth * r, h = state.img.naturalHeight * r;
        try { ctx.drawImage(state.img, (cv.width - w) / 2, (cv.height - h) / 2, w, h); } catch (_) { /* 忽略 */ }
      }
      $('genModalName').textContent = state.imgFileName || '已选图片';
    } else if (thumb) {
      thumb.hidden = true;
    }
    m.hidden = false;
    genModalOpen = true;
  }

  function closeGenModal() {
    const m = $('genModal');
    if (m) m.hidden = true;
    genModalOpen = false;
  }

  /** 弹窗里点了「开始生成」：先把参数写回，再走正常生成流程 */
  function confirmGenModal() {
    syncSideFromModal();
    closeGenModal();
    generate();
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
    renderChips();
    scheduleAutosave();
  }

  /** 清单行的高亮态跟着编辑器走（点色卡、点清单、关开关都要同步） */
  function markCountRow() {
    const rows = $('countsBody').querySelectorAll ? $('countsBody').querySelectorAll('tr.count-row') : [];
    for (let i = 0; i < rows.length; i++) {
      const on = +rows[i].getAttribute('data-idx') === editor.highlight;
      if (on) rows[i].classList.add('active'); else rows[i].classList.remove('active');
    }
    const chips = $('chipList') && $('chipList').querySelectorAll ? $('chipList').querySelectorAll('.pchip') : [];
    for (let i = 0; i < chips.length; i++) {
      const on = +chips[i].dataset.idx === editor.highlight;
      if (on) chips[i].classList.add('active'); else chips[i].classList.remove('active');
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
    // 手机上不提供编辑功能（入口已经藏掉，这里再兜一道，防止快捷键/残留状态切进去）
    if (mode === 'edit' && editDisabled()) mode = 'preview';
    const edit = mode === 'edit';
    state.mode = edit ? 'edit' : 'preview';
    editor.setPreview(!edit);
    document.body.classList.toggle('mode-edit', edit);
    document.body.classList.toggle('mode-preview', !edit);
    // 「预览 / 编辑」按钮已从工具栏移除（手机上本来就不用，桌面上靠 P 键和状态栏提示即可），
    // 所以这里不再去操作那两颗按钮。
    if ($('statusMode')) {
      $('statusMode').textContent = edit ? '编辑模式' : '预览模式';
      $('statusMode').classList.toggle('editing', edit);
    }
    if (edit && !opt.silent) toast('已进入编辑模式，现在可以改图了');
    if (!edit && !opt.silent) toast('已回到预览模式，图案不会被误改');
    updateUndoRedo();
  }

  function isEditing() { return state.mode === 'edit'; }

  /** 手机上（窄屏）不显示、也不允许编辑功能 */
  function editDisabled() { return isNarrow(); }

  /** 编辑类操作统一入口：预览模式下给出明确提示，而不是默默没反应 */
  function needEdit() {
    if (editDisabled()) { toast('手机上只能看和导出，改图请用电脑打开', 'err'); return false; }
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
    // 第 4 个参数是 addEventListener 的 options/capture。
    // 之前这里只有三个形参，调用处传的 `true`（要注册到捕获阶段）被静默丢掉，
    // 监听器实际落在冒泡阶段 —— 于是「点空白收起面板」变成了「点球自己也把它关掉」。
    const on = (id, ev, fn, opts) => {
      const el = $(id);
      if (!el) return null;
      el.addEventListener(ev, fn, opts);
      return el;
    };

    // 工具按钮
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => setTool(b.getAttribute('data-tool')));
    });
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const n = +b.getAttribute('data-preset');
        $('gridW').value = n;
        if ($('keepRatio').checked && state.img) syncHeightFromImage(); else $('gridH').value = n;
        syncMirrorsFromSide();
        syncBeadSizeHint();
        saveSettings();
      });
    });
    // 手机版的一键板数已经删掉（改用弹窗里那组 data-preset-modal）

    // 预览区色块清单
    on('chipList', 'click', onChipClick);

    // 图片
    on('imageFile', 'change', (e) => loadImageFile(e.target.files && e.target.files[0]));
    on('imageFile2', 'change', (e) => loadImageFile(e.target.files && e.target.files[0]));
    on('dropZone', 'click', (e) => {
      const t = e.target;
      // label 自己会触发 input，别重复弹两次文件框
      if (t.tagName === 'INPUT' || (t.closest && t.closest('label'))) return;
      $('imageFile2').click();
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

    // ---- 主入口：「转图纸」= 选图片 → 弹参数窗 ----
    // 两个入口（顶栏 / 侧边栏）走同一条路
    const startMake = () => { $('imageFile').click(); };
    on('btnMake', 'click', startMake);
    on('btnMake2', 'click', startMake);
    // 「重新配置」：不重新选图，直接拿当前参数再弹一次窗
    on('btnReconfig', 'click', openGenModal);
    on('btnDemo', 'click', loadDemo);

    // ---- 导出浮层 ----
    on('btnExport', 'click', (e) => { e.stopPropagation(); toggleExportMenu(); });
    on('miPng', 'click', () => { closeExportMenu(); exportPng(); });
    on('miPrint', 'click', () => { closeExportMenu(); printPattern(); });
    on('miCsv', 'click', () => { closeExportMenu(); exportCsv(); });
    on('miProject', 'click', () => { closeExportMenu(); saveProject(); });
    on('miOpen', 'click', () => { closeExportMenu(); $('projectFile').click(); });
    on('miNew', 'click', () => { closeExportMenu(); newProject(); });
    // 点别处 / 按 Esc 关掉浮层
    document.addEventListener('click', (e) => {
      if (!exportMenuOpen) return;
      const w = $('btnExport') && $('btnExport').parentElement;
      if (w && !w.contains(e.target)) closeExportMenu();
    });

    // ---- 悬浮色块球 ----
    on('btnChipBall', 'click', toggleChipPanel);
    on('btnChipClose', 'click', () => setChipPanel(false));
    // 点画布别处就收起面板（不然一直挡着图）。
    // 必须排除球和面板自身 —— 它们就在 canvasWrap 里面，
    // 不排除的话「点球」会先冒泡到这里把面板关掉，再靠 click 重新打开，
    // 看着能用，实际是在赌事件顺序。
    on('canvasWrap', 'pointerdown', (e) => {
      if (!chipPanelIsOpen()) return;
      const t = e.target;
      if (t && t.closest && (t.closest('#btnChipBall') || t.closest('#chipPanel'))) return;
      setChipPanel(false);
    });

    // ---- 生成参数弹窗 ----
    on('genModalOk', 'click', confirmGenModal);
    on('genModalCancel', 'click', closeGenModal);
    on('genModalClose', 'click', closeGenModal);
    // 点遮罩空白处关闭（点弹窗本体不关）
    on('genModal', 'click', (e) => { if (e.target === $('genModal')) closeGenModal(); });
    // 弹窗里的控件改动 → 立刻写回侧边栏
    for (const [m] of GEN_MODAL_PAIRS) {
      on(m, 'input', syncSideFromModal);
      on(m, 'change', syncSideFromModal);
    }
    // 弹窗里的板子预设
    document.querySelectorAll('[data-preset-modal]').forEach((b) => {
      b.addEventListener('click', () => {
        const n = +b.dataset.presetModal;
        $('gridWModal').value = n;
        $('gridHModal').value = n;
        syncSideFromModal();
      });
    });

    // 参数
    ['brightness', 'contrast', 'saturation', 'alphaThreshold'].forEach((id) => {
      on(id, 'input', () => { syncSliderLabels(); saveSettings(); });
    });
    on('gridW', 'input', () => { if ($('keepRatio').checked) syncHeightFromImage(); syncMirrorsFromSide(); syncBeadSizeHint(); saveSettings(); });
    on('gridH', 'input', () => { syncMirrorsFromSide(); syncBeadSizeHint(); saveSettings(); });
    on('keepRatio', 'change', () => { if ($('keepRatio').checked) syncHeightFromImage(); syncBeadSizeHint(); saveSettings(); });
    ['maxColors', 'dither', 'keepAlpha', 'dropBg'].forEach((id) => on(id, 'change', () => { syncMirrorsFromSide(); saveSettings(); }));
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
    // 模式切换按钮已移除，改用 P 键（见下方快捷键）
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

    // 项目（导出浮层里的几个入口在下面统一接）
    on('projectFile', 'change', (e) => { openProjectFile(e.target.files && e.target.files[0]); e.target.value = ''; });

    // 窄屏点侧边栏里的按钮后自动收起抽屉，不然会挡住画布
    document.querySelector('.panel').addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b || !isNarrow()) return;
      if (b.id === 'btnSidebar' || b.closest('.details-toggle')) return;
      // 生成/导入这类动作执行完就收起，方便立刻看结果
      if (['btnMake2', 'btnDemo', 'btnApplyPalette', 'btnExportCsv'].includes(b.id) || b.tagName === 'SUMMARY') return;
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
      if (k === 'p') { if (!editDisabled()) setMode(isEditing() ? 'preview' : 'edit'); return; }
      // 其余是绘制类：预览模式下不响应
      if (!isEditing()) return;
      if (k === 'b') setTool('brush');
      else if (k === 'e') setTool('eraser');
      else if (k === 'i') setTool('picker');
      else if (k === 'g') setTool('fill');
    });

    // 全屏预览
    on('btnFullscreen', 'click', toggleFullscreen);
    on('btnExitFullscreen', 'click', exitFullscreen);

    // 双击画布切换全屏。
    // 只在「非编辑模式」下生效 —— 编辑模式里双击会连画两格，那是用户想画东西，
    // 不能把图给切成全屏了。
    const mayFsByGesture = () => !isEditing();
    on('canvasWrap', 'dblclick', (e) => {
      if (!mayFsByGesture()) return;
      e.preventDefault();
      toggleFullscreen();
    });
    // 手机上双击常常被识别成两次单击，用「320ms 内两次 touchend 且基本没移动」补一手
    let lastTap = 0, lastTapX = 0, lastTapY = 0;
    on('canvasWrap', 'touchend', (e) => {
      if (e.touches && e.touches.length) return;      // 还有手指按着，不是双击
      if (!mayFsByGesture()) { lastTap = 0; return; }
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const now = Date.now();
      const moved = Math.abs(t.clientX - lastTapX) + Math.abs(t.clientY - lastTapY);
      if (now - lastTap < 320 && moved < 30) {
        lastTap = 0;
        toggleFullscreen();
      } else {
        lastTap = now; lastTapX = t.clientX; lastTapY = t.clientY;
      }
    }, { passive: true });

    // 用户按 Esc 或浏览器自己退出全屏时，把界面状态同步回来。
    // 注意：走 CSS 全屏（没有真调 API）时这两个事件不会触发，所以只在真的退出时收尾。
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && fsActive) exitFullscreen();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      if (!document.webkitFullscreenElement && fsActive) exitFullscreen();
    });
    // Esc 也能退（CSS 全屏路径下没有 fullscreenchange，得自己听键盘）
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // 弹窗开着就先关弹窗，别一下子把全屏也退了
      if (genModalOpen) { e.preventDefault(); closeGenModal(); return; }
      if (fsActive) { e.preventDefault(); exitFullscreen(); }
    });

    // 窗口尺寸变化时同步抽屉状态
    window.addEventListener('resize', () => {
      if (!isNarrow()) { $('scrim').hidden = true; document.body.classList.remove('sidebar-open'); }
      else $('scrim').hidden = !document.body.classList.contains('sidebar-open');
      syncFsTip();
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

  /** 测试用：拿到编辑器实例（验证双指缩放这类手势行为用）。
   *  用 getter 是因为 editor 是在 init() 里才创建的。 */
  Object.defineProperty(window, '__editorForTest', { get: () => editor, configurable: true });

  /** 测试用：直接喂一组用量数据渲染色块面板。
   *  用来验证「颜色集合变了 → 滚动位置记忆作废」这条规则 ——
   *  靠界面很难造出「颜色集合变化」，直接喂数据才测得准。
   *  回传内部记住的滚动位置：jsdom 里清空子节点会让 scrollTop 自然变 0，
   *  光看 scrollTop 分不清「规则真的生效」还是「碰巧就是 0」，必须看这个记忆值。 */
  window.__renderChipsForTest = (list) => {
    state.counts = {
      list,
      total: list.reduce((n, r) => n + r.count, 0),
      colors: list.length,
    };
    renderChips();
    return { remembered: chipScrollTop, domScroll: $('chipList').scrollTop };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
