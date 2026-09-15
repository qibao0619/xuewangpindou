/**
 * 变异测试：确认「滚动位置记忆」那两条断言不是假绿。
 *
 * 用法（两步，故意分开）：
 *   node tools/mutate-chips.mjs <1|2>   把 app.js 改坏，写出 app.js.mutbak 备份
 *   node tools/mutate-chips.mjs restore 还原
 *
 * 为什么不在脚本里直接跑测试：沙箱禁止 Node 用管道启动子进程（EPERM），
 * 所以由外面的 shell 负责「跑测试」这一步。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const P = 'js/app.js';
const BAK = 'js/app.js.mutbak';

const MUTATIONS = {
  1: { name: '颜色变化时不清零', from: 'if (!sameColors) chipScrollTop = 0;', to: 'if (false) chipScrollTop = 0;', expect: '颜色集合变化后记忆被清零' },
  2: { name: '永远不恢复位置', from: 'host.scrollTop = sameColors ? chipScrollTop : 0;', to: 'host.scrollTop = 0;', expect: '颜色没变时滚动位置被恢复' },
  3: { name: '不记录用户滚动位置', from: 'else if (chipPanelIsOpen()) chipScrollTop = host.scrollTop;', to: 'else if (false) chipScrollTop = host.scrollTop;', expect: '颜色没变时记住当前滚动位置' },
};

const arg = process.argv[2];

if (arg === 'restore') {
  if (!existsSync(BAK)) { console.log('没有备份文件，无需还原'); process.exit(0); }
  writeFileSync(P, readFileSync(BAK, 'utf8'));
  unlinkSync(BAK);
  console.log('已还原 js/app.js');
  process.exit(0);
}

const m = MUTATIONS[arg];
if (!m) { console.log('用法: node tools/mutate-chips.mjs <1|2|restore>'); process.exit(2); }

const orig = readFileSync(P, 'utf8');
writeFileSync(BAK, orig);                      // 先备份，坏了我还能恢复
if (!orig.includes(m.from)) { console.log('✗ 找不到替换目标: ' + m.from); process.exit(1); }
const mutated = orig.replace(m.from, m.to);
if (mutated === orig) { console.log('✗ 替换没生效'); process.exit(1); }
writeFileSync(P, mutated);
console.log('已注入变异 [' + m.name + ']');
console.log('期望这条断言变红：' + m.expect);
