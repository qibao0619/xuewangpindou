/**
 * 本轮改动的行为测试（替代原来那个「只查 CSS 里有没有规则」的假测试）。
 *
 * 覆盖：
 *   A. 悬浮球：竖向单列、色号+颗数、滚动记忆（会话内）、颜色变了作废
 *   B. 悬浮球全屏：不隐藏、定位到 fixed、点色块能高亮
 *   C/D. 主页面精简：顶栏转图纸+导出浮层、手机隐藏编辑工具、无手机生成区
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = await import('file:///E:/dsh/DSH%20Desktop/resources/app/node_modules/jsdom/lib/api.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = resolve(ROOT, rel);
  try { res.writeHead(200, { 'Content-Type': MIME[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' }); res.end(readFileSync(f)); }
  catch (_) { res.writeHead(404); res.end(''); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

const errors = [];
const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(window) {
    const noop = () => {};
    const fake = (canvas) => ({
      canvas, filter: 'none',
      setTransform: noop, resetTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
      save: noop, restore: noop, beginPath: noop, closePath: noop, rect: noop, fill: noop,
      moveTo: noop, lineTo: noop, stroke: noop, clip: noop, arc: noop, fillText: noop,
      strokeText: noop, drawImage: noop, setLineDash: noop, translate: noop, scale: noop, rotate: noop,
      measureText: (s) => ({ width: String(s).length * 6 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: noop,
    });
    window.HTMLCanvasElement.prototype.getContext = function () { return fake(this); };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));
  },
});

const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 900));

let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (i ? ' → ' + i : '')); } };
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
const appSrc = readFileSync(resolve(ROOT, 'js/app.js'), 'utf8');

// 先生成内容
click($('btnDemo'));
await tick(400);

console.log('=== A1/A2. 竖向单列 + 色号 + 颗数 ===');
{
  click($('btnChipBall'));
  await tick(80);
  const chips = [...doc.querySelectorAll('#chipList .pchip')];
  ok('面板里有色块', chips.length > 0, chips.length + ' 个');
  // 竖向单列：CSS 必须是 column 方向
  ok('清单是竖向单列（flex-direction: column）',
    /\.chip-list \{[\s\S]{0,200}flex-direction: column/.test(css));
  ok('不再是横向换行网格（没有 flex-wrap: wrap）',
    !/\.chip-list \{[\s\S]{0,200}flex-wrap: wrap/.test(css));
  if (chips.length) {
    // 色号要完整（M09），不能是截断的 09
    const codeText = chips[0].querySelector('b').textContent.trim();
    ok('显示完整色号（如 M09，不是 09）', /^[A-Za-z]/.test(codeText) || codeText.length > 2,
      '实际 = "' + codeText + '"');
    const numText = chips[0].querySelector('span').textContent.trim();
    ok('显示颗数（带「颗」字）', /颗$/.test(numText), '实际 = "' + numText + '"');
    // 不许出现颜色名（深红/浅蓝 之类）——用户明确不要
    const allText = chips.map((c) => c.textContent).join(' ');
    ok('没有出现颜色名（深红/浅蓝等）', !/(深红|浅蓝|浅绿|深蓝|酒红|米白|天蓝|草绿)/.test(allText));
  }
}

console.log('\n=== A3/A4. 滚动位置记忆 ===');
{
  const host = $('chipList');
  // jsdom 不做布局，scrollTop 可写但读回来要靠我们自己的逻辑
  click($('btnChipBall'));  // 关
  await tick(50);
  Object.defineProperty(host, 'scrollTop', { value: 120, writable: true, configurable: true });
  click($('btnChipBall'));  // 开（此时会记下 120）
  await tick(60);
  host.scrollTop = 120;
  // 再关再开，模拟用户收起后重新打开
  click($('btnChipBall'));
  await tick(50);
  click($('btnChipBall'));
  await tick(80);
  ok('收起再打开，滚动位置被记住（不是回到 0）', host.scrollTop === 120, '实际 = ' + host.scrollTop);

  // 颜色集合变了 → 记忆作废。
  // 注意 1：不能靠「再点一次示例图案」造这个条件 —— 示例图案只有 1 种颜色，
  //         重新生成色号一模一样，指纹没变，保留位置才是对的。
  // 注意 2：也不能只看 scrollTop。jsdom 里清空子节点会让 scrollTop 自然变 0，
  //         那样「规则生效」和「碰巧是 0」分不出来（早先那版测试就是这么假通过的）。
  //         所以断言看的是内部记忆值 remembered。
  const listA = [{ index: 0, count: 5, color: { code: 'M09', hex: '#a00' } },
                 { index: 1, count: 3, color: { code: 'M10', hex: '#0a0' } }];
  const listB = [{ index: 2, count: 9, color: { code: 'B01', hex: '#00a' } }];

  // 面板必须开着，否则 chipPanelIsOpen() 为假、位置根本不会被记录
  if ($('chipPanel').hidden) { click($('btnChipBall')); await tick(60); }
  ok('面板处于打开状态（位置才会被记录）', $('chipPanel').hidden === false);

  // 第一次喂 A：定下指纹
  window.__renderChipsForTest(listA);
  await tick(40);
  // 用户滚动 → 再发生一次「颜色没变」的重渲染
  host.scrollTop = 120;
  const kept = window.__renderChipsForTest(listA);
  ok('颜色没变时记住当前滚动位置', kept.remembered === 120, '记忆值 = ' + kept.remembered);
  ok('颜色没变时滚动位置被恢复', kept.domScroll === 120, 'dom = ' + kept.domScroll);

  // 换成完全不同的颜色集合 → 记忆必须清零
  const reset = window.__renderChipsForTest(listB);
  ok('颜色集合变化后记忆被清零', reset.remembered === 0, '记忆值 = ' + reset.remembered);
  ok('应用了「会话内记忆」而不是写 localStorage',
    /let chipScrollTop = 0/.test(appSrc) && !/localStorage[\s\S]{0,80}chipScrollTop/.test(appSrc));
}

console.log('\n=== B1/B2. 全屏下悬浮球可用 ===');
{
  ok('全屏隐藏规则里没有 chip-panel',
    !/body\.fs-on [^{]*\.chip-panel[^{]*\{[^}]*display:\s*none/.test(css));
  ok('全屏隐藏规则里没有 chip-ball',
    !/body\.fs-on [^{]*\.chip-ball[^{}]*\{[^}]*display:\s*none/.test(css));
  ok('全屏时面板改成 fixed 定位（参照系对齐屏幕）',
    /body\.fs-on \.chip-panel \{[\s\S]{0,200}position: fixed/.test(css));
  ok('全屏时球也改成 fixed 定位', /body\.fs-on \.chip-ball \{[\s\S]{0,160}position: fixed/.test(css));

  click($('btnFullscreen'));
  await tick(200);
  ok('进入全屏', doc.body.classList.contains('fs-on'));
  $('chipPanel').hidden = true;
  click($('btnChipBall'));
  await tick(80);
  ok('全屏下点球能打开面板', $('chipPanel').hidden === false);
}

console.log('\n=== B3. 全屏下点色块能高亮 ===');
{
  click($('btnChipBall'));
  await tick(60);
  const chips = [...doc.querySelectorAll('#chipList .pchip')];
  if (chips.length) {
    const before = doc.getElementById('optHighlight').checked;
    click(chips[0]);
    await tick(100);
    const after = doc.getElementById('optHighlight').checked;
    ok('点色块后高亮开关被打开', after === true, '之前 ' + before + '，之后 ' + after);
    ok('该色块带上 active 样式',
      [...doc.querySelectorAll('#chipList .pchip')].some((c) => c.classList.contains('active')));
    ok('全屏下点色块不报错', errors.length === 0, errors.slice(0, 3).join(' || '));
  } else {
    ok('有可点的色块', false, '面板里没有色块');
  }
  // 退出全屏，别影响后面的用例
  click($('btnExitFullscreen'));
  await tick(150);
}

console.log('\n=== B4. 球不会「自己点自己又被自己关」 ===');
{
  ok('canvasWrap 的收起逻辑排除了球和面板',
    /closest\('#btnChipBall'\)[\s\S]{0,80}closest\('#chipPanel'\)/.test(appSrc));
  $('chipPanel').hidden = true;
  const ball = $('btnChipBall');
  const pd = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  pd.target || Object.defineProperty(pd, 'target', { value: ball });
  ball.dispatchEvent(pd);
  await tick(30);
  click(ball);
  await tick(60);
  ok('触屏顺序（pointerdown → click）后球是打开状态', $('chipPanel').hidden === false);
  // 点画布空白仍然要能收起
  const wrap = $('canvasWrap');
  const pd2 = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(pd2, 'target', { value: $('grid') });
  wrap.dispatchEvent(pd2);
  await tick(60);
  ok('触屏点画布空白：面板收起', $('chipPanel').hidden === true);
}

console.log('\n=== C1. 手机隐藏编辑工具（含漏网的画笔组） ===');
{
  ok('CSS 里点名隐藏了 .tools（画笔/橡皮/吸管/填充）',
    /\.tools \{ display: none !important; \}/.test(css));
  // 行为验证：用 CSS 层叠审计确认手机上确实不可见
  const { parseCss, hiddenBy } = await import('./css-audit.mjs');
  const rules = parseCss(css);
  const dom2 = new JSDOM(html);
  const d2 = dom2.window.document;
  for (const sel of ['[data-tool="brush"]', '[data-tool="eraser"]', '[data-tool="picker"]', '[data-tool="fill"]']) {
    const el = d2.querySelector(sel);
    const hid = hiddenBy(rules, el, { mobile: true });
    ok('手机上隐藏 ' + sel, !!hid, hid ? '' : '仍然可见！');
  }
  // 「预览 / 编辑」整组按钮已从页面移除（手机上本来就不用，桌面靠 P 键）
  ok('「预览/编辑」切换按钮已整组移除',
    !d2.getElementById('modePreview') && !d2.getElementById('modeEdit') && !d2.querySelector('.mode-switch'));
  // 底部状态栏手机上整个隐藏
  ok('手机上隐藏底部状态栏',
    !!hiddenBy(rules, d2.querySelector('.statusbar'), { mobile: true }));
  ok('桌面端状态栏仍然显示',
    !hiddenBy(rules, d2.querySelector('.statusbar'), { mobile: false }));
  // 桌面端工具栏仍然可见
  const brushDesk = hiddenBy(rules, d2.querySelector('[data-tool="brush"]'), { mobile: false });
  ok('桌面端画笔仍然可见', !brushDesk, brushDesk ? '被误藏了' : '');
}

console.log('\n=== D. 主页面精简 ===');
{
  ok('有「转图纸」主入口', !!$('btnMake'));
  // 位置要求：放在画布上方的工具栏里，不是顶栏
  ok('「转图纸」在工具栏里（画布正上方）',
    !!$('btnMake').closest('.stage-toolbar'), '放错位置了');
  ok('「转图纸」不在顶栏里', !$('btnMake').closest('.topbar'));
  ok('有「导出 ▾」按钮', !!$('btnExport'));
  ok('有导出浮层', !!$('exportMenu'));
  ok('浮层里有 PNG/打印/CSV/项目/导入/清空',
    ['miPng', 'miPrint', 'miCsv', 'miProject', 'miOpen', 'miNew'].every((id) => !!$(id)));
  ok('浮层默认收起', $('exportMenu').hidden === true);
  click($('btnExport'));
  await tick(60);
  ok('点「导出 ▾」展开浮层', $('exportMenu').hidden === false);
  ok('展开时 aria-expanded=true', $('btnExport').getAttribute('aria-expanded') === 'true');
  click($('miPng'));
  await tick(60);
  ok('点了菜单项后浮层自动收起', $('exportMenu').hidden === true);

  // 手机生成区已经删掉
  ok('没有手机生成区 #mobileGen', !$('mobileGen'));
  ok('HTML 里没有 mobile-gen', !/mobile-gen/.test(html));
  ok('没有抽屉里的「导出与打印」重复分区', !$('sectMobileExport'));
  // 重复的导出入口都清了
  ok('没有顶栏旧的导出项目/PNG/打印按钮',
    !$('btnSaveProject') && !$('btnExportPng') && !$('btnPrint'));
  ok('没有工具栏的「导出 PNG」', !$('btnExportPng2'));
  ok('没有手机版的导出按钮', !$('btnExportPngM') && !$('btnPrintM'));
  // 参数控件收成隐藏 input（仍作数据源）
  ok('生成参数仍是隐藏 input 作唯一数据源',
    !!$('gridW') && !!$('gridH') && !!$('maxColors') && !!$('keepRatio') && !!$('dropBg'));
  ok('参数 input 放在 hidden 容器里',
    /class="hidden-params" hidden/.test(html));
  // 弹窗里有锁定比例
  ok('弹窗里有「锁定原图比例」', !!$('keepRatioModal'));
  ok('弹窗里保留一键板数',
    doc.querySelectorAll('[data-preset-modal]').length === 3);
  // 「重新配置」
  ok('有「重新配置」按钮（改参数不用重选图）', !!$('btnReconfig'));
}

console.log('\n=== 无脚本错误 ===');
ok('全程无脚本错误', errors.length === 0, errors.slice(0, 4).join(' || '));

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过（' + pass + ' 项）'));
window.close();
server.close();
process.exitCode = fail ? 1 : 0;
