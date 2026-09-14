/**
 * 手写 ZIP 打包（零依赖）。
 * 为什么不用 Compress-Archive：
 *   1) 它写出的嵌套路径用反斜杠（js\app.js），GitHub 网页上传会把整条当文件名，建出一堆平铺的垃圾文件；
 *   2) 它会跳过以点开头的文件（.gitignore / .github 可能丢）。
 * 这里自己写，保证路径是正斜杠、dotfile 不丢。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '..', 'xuwangpindou-upload.zip');

/* ---------- 收集要上传的文件（按 .gitignore） ---------- */
const ignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const ignoreDirs = ignore.filter((l) => l.endsWith('/')).map((l) => l.slice(0, -1));
const ignoreExts = ignore.filter((l) => l.startsWith('*')).map((l) => l.slice(1));
const ignoreNames = ignore.filter((l) => !l.endsWith('/') && !l.startsWith('*'));

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignoreDirs.includes(name) || ignoreNames.includes(name)) continue;
    if (ignoreExts.some((e) => name.endsWith(e))) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push({ full, rel: relative(ROOT, full).replace(/\\/g, '/') });
  }
})(ROOT);
files.sort((a, b) => a.rel.localeCompare(b.rel));

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* ---------- 组装 ZIP ---------- */
const DOS_TIME = 0; // 0 表示不指定时间，解压工具会用默认值
const DOS_DATE = 0x21; // 1980-01-01

const locals = [];
const centrals = [];
let offset = 0;

for (const f of files) {
  const data = readFileSync(f.full);
  const deflated = deflateRawSync(data, { level: 9 });
  // 压缩后没变小的（比如 PNG），就直接存原样
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const nameBytes = Buffer.from('xuwangpindou/' + f.rel, 'utf8');

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);   // 本地文件头签名
  local.writeUInt16LE(20, 4);           // 解压所需版本
  local.writeUInt16LE(0x0800, 6);       // 标志：文件名是 UTF-8
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);           // 无扩展字段
  nameBytes.copy(local, 30);

  locals.push(local, body);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
  central.writeUInt16LE(20, 4);         // 创建所需版本
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);         // 扩展字段长度
  central.writeUInt16LE(0, 32);         // 注释长度
  central.writeUInt16LE(0, 34);         // 磁盘号
  central.writeUInt16LE(0, 36);         // 内部属性
  central.writeUInt32LE(0, 38);         // 外部属性
  central.writeUInt32LE(offset, 42);    // 本地头偏移
  nameBytes.copy(central, 46);
  centrals.push(central);

  offset += local.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

writeFileSync(OUT, Buffer.concat([...locals, centralBuf, end]));

console.log('✅ ' + OUT);
console.log('   ' + files.length + ' 个文件，' + (statSync(OUT).size / 1024).toFixed(1) + ' KB');
console.log('   顶层目录 xuwangpindou/，路径全部用正斜杠');
console.log('   dotfile 已包含: ' + files.filter((f) => f.rel.split('/').some((s) => s.startsWith('.'))).map((f) => f.rel).join(', '));
