/**
 * misaka — 打包器（零依赖）
 *
 *   node scripts/pack.mjs [--out DIR] [--version X.Y.Z]
 *
 * 产出：
 *   <out>/misaka-<ver>.zip       解压到 ~/.dsh/skills 即得 ~/.dsh/skills/misaka/…
 *   <out>/misaka-<ver>.sha256    "<hash>  misaka-<ver>.zip"
 *   <out>/misaka-<ver>.manifest.json  { files: [{ path, bytes, sha256 }] }
 *
 * 不依赖 tar / Compress-Archive / 任何 npm 包：自己写 ZIP 容器
 * （deflate-raw + CRC32 + 本地头/中央目录/EOCD）。
 *
 * 幂等：条目顺序固定（递归字典序）、时间戳固定 1980-01-01、压缩级别固定 9，
 * 因此同一份源码重跑产出的 zip 字节完全一致，sha256 可对账。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

// zip 顶层目录名取 SKILL.md frontmatter 的 name（仓库根目录叫什么不影响包结构），
// 取不到才退回目录名。这样同一个包既能从 ~/.dsh/skills/misaka 打，也能从任意克隆目录打。
const SKILL_NAME = skillName();

function skillName() {
  try {
    const head = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8').slice(0, 400);
    const m = head.match(/^---[\s\S]*?^name:\s*([A-Za-z0-9._-]+)\s*$/m);
    if (m) return m[1];
  } catch { /* 忽略 */ }
  return path.basename(ROOT);
}

const SKIP_DIRS = new Set(['dist', 'node_modules', '.git', '__pycache__']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'manifest.json', '.gitignore']);

// ---------- args ----------
const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const OUT = path.resolve(flag('out', path.join(process.cwd(), 'dist')));
const VERSION = flag('version', readVersion());

function readVersion() {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

// ---------- collect ----------
function collect(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collect(abs, acc);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      if (/\.(zip|sha256)$/.test(e.name)) continue;
      acc.push(abs);
    }
  }
  return acc;
}

const files = collect(ROOT)
  .map((abs) => ({ abs, rel: path.relative(ROOT, abs).split(path.sep).join('/') }))
  .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

// ---------- crc32 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

// ---------- zip ----------
const DOS_DATE = 0x0021; // 1980-01-01，固定以保幂等
const DOS_TIME = 0x0000;

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    let method = 8;
    let payload = zlib.deflateRawSync(raw, { level: 9 });
    if (payload.length >= raw.length) {
      method = 0;
      payload = raw;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra
    cd.writeUInt16LE(0, 32);              // comment
    cd.writeUInt16LE(0, 34);              // disk
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------- main ----------
const entries = files.map((f) => ({
  name: `${SKILL_NAME}/${f.rel}`,
  data: fs.readFileSync(f.abs),
}));

// 附带 VERSION 已在源树里；INSTALL.md 同理。
const zipName = `${SKILL_NAME}-${VERSION}.zip`;
const zipBuf = buildZip(entries);
const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, zipName), zipBuf);
fs.writeFileSync(path.join(OUT, `${SKILL_NAME}-${VERSION}.sha256`), `${sha}  ${zipName}\n`);

const manifest = {
  name: SKILL_NAME,
  version: VERSION,
  builtFrom: ROOT,
  entries: entries.length,
  bytes: zipBuf.length,
  sha256: sha,
  files: files.map((f) => {
    const data = fs.readFileSync(f.abs);
    return {
      path: f.rel,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
  }),
};
fs.writeFileSync(path.join(OUT, `${SKILL_NAME}-${VERSION}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');

console.log(JSON.stringify({
  zip: path.join(OUT, zipName),
  sha256: sha,
  entries: entries.length,
  bytes: zipBuf.length,
  version: VERSION,
}, null, 2));
