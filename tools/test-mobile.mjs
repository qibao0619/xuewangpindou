/**
 * 手机布局体检：把 styles.css 按手机视口宽度过一遍，
 * 检查有没有「一屏塞不下又被 overflow:hidden 锁死」这类会让内容被压没的组合。
 * jsdom 不做布局计算，所以这里做的是「规则级」检查 —— 拦得住结构性错误，拦不住像素级手感。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

let bad = 0;
const ok = (name, cond, info) => {
  if (!cond) bad++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (info ? '  → ' + info : ''));
};

console.log('=== 手机布局结构检查 ===');

// 1. 正文外层不能同时「锁死高度」又「塞四块内容」
const mobileBlock = css.slice(css.indexOf('@media (max-width: 900px)'));
ok('手机媒体查询里放开了滚动', /overflow: visible/.test(mobileBlock));
ok('手机媒体查询里 height 改成 auto', /height: auto/.test(mobileBlock));
ok('手机上 body 不再是撑满一屏的 flex 列', /body \{ display: block; \}/.test(mobileBlock));

// 2. 画布必须有确定高度，否则会被别的块挤成 0
ok('画布给了明确高度（vh/dvh）', /\.canvas-wrap \{[^}]*height: \d+vh/.test(mobileBlock));

// 3. 触摸目标尺寸
const btnRules = [...mobileBlock.matchAll(/min-height: (\d+)px/g)].map((m) => +m[1]);
const minBtn = Math.min(...btnRules.filter((n) => n >= 30), 999);
ok('手机上按钮最小高度够手指点（≥38px）', minBtn >= 38, '最小 ' + minBtn + 'px');
// 手机上的输入框现在都在弹窗里（生成区已删除），照样要给足字号防 iOS 放大
ok('iOS 输入框字号≥16px（防自动放大）',
  /\.modal-body \.input, \.modal-body select \{[\s\S]{0,140}font-size: 16px/.test(css));

// 4. 安全区
ok('顶部/底部留了安全区', /env\(safe-area-inset/.test(css));

// 5. 窗口单位
ok('用了 dvh 适配地址栏伸缩', /100dvh/.test(css));
// 允许「100vh 打底、紧跟一行 100dvh 覆盖」这种写法（老浏览器兜底），
// 只揪出「用了 100vh 但附近没有 dvh 覆盖」的裸用。
{
  const lines = css.split('\n');
  const naked = lines.filter((l, i) => {
    if (!/100vh/.test(l)) return false;
    if (/100dvh/.test(l)) return false;                 // 同一行就覆盖了
    const near = lines.slice(i + 1, i + 3).join(' ');
    return !/100dvh/.test(near);                        // 后面两行内没有 dvh 覆盖
  });
  ok('没有「裸用 100vh 且无 dvh 兜底」的地方', naked.length === 0, naked.map((l) => l.trim()).join(' | '));
}

// 6. 吸顶元素别互相盖住
const stickyCount = (mobileBlock.match(/position: sticky/g) || []).length;
ok('吸顶元素数量合理（≤2，多了会叠在一起）', stickyCount <= 2, stickyCount + ' 个');

// 7. 触屏滚动
ok('工具栏横向滚动带惯性', /-webkit-overflow-scrolling: touch/.test(mobileBlock));
ok('画布 touch-action: none（画布自己处理手势）', /\.canvas-wrap \{[^}]*touch-action: none/.test(css));

// 8. 抽屉宽度：只看侧边栏，全屏画布用 100vw 是对的
const drawerWidths = [...css.matchAll(/\.panel \{[^}]*width: (\d+)vw/g)].map((m) => +m[1]);
ok('抽屉宽度不超过 90vw（否则会盖住整个屏幕）',
  drawerWidths.every((w) => w <= 90), drawerWidths.join(', ') + 'vw');

console.log('\n=== Service Worker 更新策略 ===');
// 这次的教训：手机上看到的还是旧样式，因为 sw.js 对 styles.css 用了「缓存优先」，
// 改了样式但手机上一直返回缓存里的旧文件。html/css/js 必须走网络优先。
const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
ok('sw.js 对 html/css/js 走网络优先（否则改了手机上不生效）',
  /MUST_BE_FRESH/.test(sw) && /html\|css\|js/.test(sw));
ok('sw.js 里有缓存版本号', /const VERSION = '[^']+'/.test(sw));
ok('缓存版本号是 v3 或更新（改了静态文件就要 +1）',
  (() => {
    const m = sw.match(/const VERSION = 'xuwangpindou-v(\d+)'/);
    return !!m && +m[1] >= 3;
  })(), (sw.match(/const VERSION = '[^']+'/) || [''])[0]);
ok('球和弹窗的样式都在', /\.chip-ball \{/.test(css) && /\.modal \{/.test(css));
ok('手机隐藏底部状态栏（格/色/尺寸手机上没有用）', /\.statusbar \{ display: none !important; \}/.test(css));

console.log('\n=== 手机端顶栏 ===');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
ok('顶栏有「导出 ▾」浮层按钮（手机桌面共用）', /id="btnExport"/.test(html));
ok('导出选项收在浮层里（不占顶栏）', /class="menu-pop" id="exportMenu"/.test(html));
ok('手机顶栏保留操作区（放转图纸 + 导出）', !/\.topbar-actions \{ display: none; \}/.test(mobileBlock));
ok('手机上「预览/编辑」按钮已移除', !/id="modeEdit"/.test(html) && !/id="modePreview"/.test(html));
ok('「转图纸」挪到了画布上方的工具栏', /class="stage-toolbar"[\s\S]{0,400}id="btnMake"/.test(html));
ok('顶栏里没有「转图纸」了', !/class="topbar-actions"[\s\S]{0,300}id="btnMake"/.test(html));
ok('抽屉里不再有重复的「导出与打印」分区', !/id="sectMobileExport"/.test(html));
ok('品牌名不换行（超长省略号）', /white-space: nowrap; overflow: hidden; text-overflow: ellipsis/.test(mobileBlock));
ok('色块清单是竖向单列（一行一个颜色）', /\.chip-list \{[\s\S]{0,200}flex-direction: column/.test(css));
ok('色块清单限高可内部滚动', /\.chip-panel \{[\s\S]{0,300}max-height/.test(css));

console.log('\n=== 全屏预览样式 ===');
ok('全屏时隐藏顶栏/工具栏/状态栏/色块清单',
  /body\.fs-on \.topbar[\s\S]{0,200}display: none !important/.test(css));
ok('全屏画布铺满视口（固定定位 + dvh）',
  /body\.fs-on \.canvas-wrap \{[\s\S]{0,300}position: fixed; inset: 0[\s\S]{0,200}100dvh/.test(css));
ok('退出按钮够大（≥42px，手机上点得准）',
  /\.exit-fs \{[\s\S]{0,300}min-height: 42px/.test(css));
ok('退出按钮全屏时浮在画布上（绝对定位 + 高层级）',
  /\.exit-fs \{[\s\S]{0,200}position: absolute; top: 10px; right: 10px; z-index: 5/.test(css));
ok('原生 fullscreen 也铺满（:fullscreen 兼容）',
  /\.canvas-wrap:fullscreen/.test(css) && /-webkit-full-screen/.test(css));
ok('全屏提示会淡出', /\.fs-tip\.gone \{ opacity: 0/.test(css));
// 转屏是靠不住的：网页不能强制设备转向，转不动时竖屏全屏也必须好看
ok('竖屏全屏也铺满（不是只在横屏生效）',
  !/fs-on[\s\S]{0,400}orientation: landscape/.test(css));
ok('全屏不依赖转屏是否成功（CSS 全屏兜底独立于 API）',
  /body\.fs-on \.canvas-wrap/.test(css));

console.log('\n' + (bad ? '✗ ' + bad + ' 项有问题' : '✓ 手机布局结构检查全部通过'));
console.log('（注意：这是规则级检查，真正的像素观感必须在手机上肉眼确认）');
process.exitCode = bad ? 1 : 0;
