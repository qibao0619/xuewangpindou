/**
 * CSS 层叠感知的元素可见性审计。
 *
 * 之前那个审计脚本只收集 `@media (max-width:900px)` 里的 `display:none` 选择器，
 * 完全没考虑「后面的规则会覆盖前面的」以及「基础样式里就有 display:none」，
 * 于是既漏报（漏网的按钮说成隐藏）又误报（手机生成区说成隐藏）。
 *
 * 这里按真实的 CSS 层叠顺序算：把样式表摊平成有序规则列表，
 * 对每个元素用 matches() 找出所有命中的规则，取「优先级 + 顺序」最高的那条 display。
 */
import { readFileSync } from 'node:fs';

/**
 * 极简 CSS 解析：把样式表摊平成 [{ selector, body, media, order }]。
 * 用括号配对来确定块的范围 —— 之前靠正则猜 @media 的结束位置，猜错了，
 * 结果所有规则都被算进 @media 里，审计全乱。
 */
export function parseCss(cssText) {
  const src = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let order = 0;

  /** 从 open 处的 '{' 开始，返回配对 '}' 的索引 */
  const matchBrace = (open) => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return src.length;
  };

  /** 解析一段规则块（不含外层括号），mediaCtx 是当前的媒体条件 */
  const walk = (start, end, mediaCtx) => {
    let i = start;
    while (i < end) {
      // 跳过空白
      while (i < end && /\s/.test(src[i])) i++;
      if (i >= end) break;

      const brace = src.indexOf('{', i);
      if (brace < 0 || brace >= end) break;
      const head = src.slice(i, brace).trim();
      const close = matchBrace(brace);
      if (close > end) break;
      const body = src.slice(brace + 1, close);

      if (head.startsWith('@media') || head.startsWith('@supports')) {
        walk(brace + 1, close, mediaCtx ? mediaCtx + ' && ' + head : head);
      } else if (head.startsWith('@')) {
        // @keyframes / @font-face 等：跳过内容
      } else if (head) {
        for (const sel of head.split(',')) {
          const s = sel.trim();
          if (s) out.push({ selector: s, body, media: mediaCtx || '', order: order++ });
        }
      }
      i = close + 1;
    }
  };

  walk(0, src.length, '');
  return out;
}

/** 简单特异性：id=100, class/attr/pseudo=10, tag=1 */
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  const s = sel.replace(/\s*>\s*/g, ' ').replace(/:not\(([^)]*)\)/g, '$1');
  a = (s.match(/#[\w-]+/g) || []).length;
  b = (s.match(/\.[\w-]+/g) || []).length
    + (s.match(/\[[^\]]+\]/g) || []).length
    + (s.match(/:(?!:)[\w-]+/g) || []).length;
  c = (s.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
  return a * 100 + b * 10 + c;
}

/**
 * 判断一个元素在给定环境下最终 display 是否为 none。
 * env: { mobile:boolean } —— 简化：只区分手机断点。
 */
export function displayOf(rules, el, env) {
  let best = null;   // { spec, order, value }
  for (const r of rules) {
    // 媒体查询过滤：只让「屏幕 + 当前宽度」适用的规则参与计算。
    // 特别注意 @media print —— 里面有 body>*{display:none}，是给打印用的，
    // 不算清楚会把整个页面判成隐藏。
    const media = r.media || '';
    if (/@media\s+print/.test(media)) continue;
    if (/@supports/.test(media) && !/max-width|min-width/.test(media)) continue;
    const isMax900 = /max-width:\s*900px/.test(media);
    const isMax560 = /max-width:\s*560px/.test(media);
    const isMinW = /min-width:\s*\d+px/.test(media);
    if (env.mobile) {
      if (isMinW) continue;                    // 手机下不适用 min-width 规则
    } else {
      if (isMax900 || isMax560) continue;      // 桌面下不适用窄屏规则
    }
    let hit = false;
    try { hit = el.matches(r.selector); } catch (_) { continue; }
    if (!hit) continue;
    const m = /(?:^|;)\s*display\s*:\s*([^;!]+)(!important)?/.exec(r.body);
    if (!m) continue;
    const spec = specificity(r.selector) + (m[2] ? 1000 : 0);   // !important 压过一切
    const cand = { spec, order: r.order, value: m[1].trim() };
    if (!best || cand.spec > best.spec || (cand.spec === best.spec && cand.order >= best.order)) best = cand;
  }
  return best ? best.value : null;
}

/** 元素及其所有祖先里，有没有谁被隐藏 */
export function hiddenBy(rules, el, env) {
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const d = displayOf(rules, cur, env);
    if (d === 'none') {
      return { self: cur === el, tag: cur.tagName.toLowerCase(), id: cur.id || '', cls: cur.className || '' };
    }
    cur = cur.parentElement;
  }
  return null;
}

/** 命令行直接跑：打印手机端可见按钮 */
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '\\';
  const { JSDOM } = await import('file:///E:/dsh/DSH%20Desktop/resources/app/node_modules/jsdom/lib/api.js');
  const dom = new JSDOM(readFileSync(ROOT + 'index.html', 'utf8'));
  const doc = dom.window.document;
  const rules = parseCss(readFileSync(ROOT + 'styles.css', 'utf8'));
  console.log('解析到 ' + rules.length + ' 条规则');

  for (const env of [{ mobile: true }, { mobile: false }]) {
    console.log('\n=== ' + (env.mobile ? '手机（≤900px）' : '桌面（>900px）') + ' 可见按钮 ===');
    const vis = [], hid = [];
    for (const b of doc.querySelectorAll('button')) {
      if (b.hidden) { hid.push({ b, why: '<button hidden>' }); continue; }
      const h = hiddenBy(rules, b, env);
      if (h) hid.push({ b, why: h.id ? '#' + h.id : '.' + String(h.cls).split(' ')[0] });
      else vis.push(b);
    }
    for (const b of vis) {
      console.log('  ' + (b.id || '(无id)').padEnd(20) + (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
    }
    console.log('  --- 隐藏 ' + hid.length + ' 个 ---');
    for (const h of hid) {
      console.log('      ' + (h.b.id || '(无id)').padEnd(20) + h.why);
    }
  }
}
