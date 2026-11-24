/**
 * 扫描游戏目录里的 .bin，解析名称表；按需解码 hzc1 缩略图。
 * 纯 Node，不依赖 Electron，方便直接跑测试。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dec = new TextDecoder('shift_jis');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

function parseNameTable(buf) {
  const count = buf.readUInt32LE(0);
  const namesStart = 8 + count * 12;
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 12;
    const nameOff = buf.readUInt32LE(o);
    const off = buf.readUInt32LE(o + 4);
    const size = buf.readUInt32LE(o + 8);
    const start = namesStart + nameOff;
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    const name = dec.decode(Uint8Array.from(buf.subarray(start, end)));
    out.push({ name, off, size });
  }
  return out;
}

const TYPE_LABEL = { 1: 'RGBA', 2: '脸部表' };

/* 解析一个 .bin：名称表 + 每个条目的头部信息 */
function parseArchive(file) {
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 8);
    if (head.length < 8) return null;
    const count = head.readUInt32LE(0);
    if (!count || count > 5e6) return null;
    const namesSize = readAt(fd, 4, 4).readUInt32LE(0);
    const tableBuf = readAt(fd, 0, 8 + count * 12 + namesSize);
    const names = parseNameTable(tableBuf);
    const entries = names.map((e) => {
      const magicBuf = readAt(fd, e.off, 4);
      const magic = magicBuf.toString('latin1');
      const row = { name: e.name, off: e.off, size: e.size, magic };
      if (magic === 'hzc1') {
        const h = readAt(fd, e.off, 48);
        row.kind = 'image';
        row.raw = h.readUInt32LE(4);
        row.type = h[18];
        row.w = h.readUInt16LE(20);
        row.h = h.readUInt16LE(22);
        // 0 = BGR 24 位，1 = BGRA 32 位，2 = 逐格表情表（32 位），3/4 = 暂未解
        row.bpp = row.w && row.h ? Math.round(row.raw / (row.w * row.h)) : 0;
        row.cells = row.type === 2 ? Math.max(1, Math.round(row.bpp / 4)) : 1;
      } else if (magic === 'OggS') {
        row.kind = 'audio';
      } else if (magic === 'RIFF') {
        row.kind = 'audio';
      } else {
        row.kind = 'other';
      }
      return row;
    });
    return { file: path.basename(file), path: file, count, bytes: stat.size, entries };
  } finally {
    fs.closeSync(fd);
  }
}

const LOOSE_BASES = new Set([
  'graph_bs',
  'graph_bg',
  'graph_vis',
  'graph_vish',
  'graph',
  'graph_sd',
  'patch',
  'voice',
  'bgm',
  'se',
  'se_env',
  'se_sys',
]);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function looseName(root, file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const ext = path.extname(rel);
  return ext ? rel.slice(0, -ext.length) : rel;
}

/* 免封包文件：散装目录里的文件没有归档偏移，直接按整文件读取。 */
function parseLooseFile(file, root) {
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  let head;
  try {
    head = readAt(fd, 0, 64);
  } finally {
    fs.closeSync(fd);
  }
  const rel = path.relative(root, file).split(path.sep).join('/');
  const ext = path.extname(rel);
  const row = {
    name: looseName(root, file),
    off: 0,
    size: stat.size,
    magic: head.length >= 4 ? head.subarray(0, 4).toString('latin1') : '',
    loose: true,
    path: file,
    ext: ext ? ext.slice(1).toLowerCase() : '',
  };

  if (row.magic === 'hzc1' && head.length >= 28) {
    const raw = head.readUInt32LE(4);
    const type = head[18];
    const w = head.readUInt16LE(20);
    const h = head.readUInt16LE(22);
    row.kind = 'image';
    row.raw = raw;
    row.type = type;
    row.w = w;
    row.h = h;
    row.bpp = w && h ? Math.round(raw / (w * h)) : 0;
    row.cells = type === 2 ? Math.max(1, Math.round(row.bpp / 4)) : 1;
  } else if (head.length >= 24 && head.subarray(0, 8).equals(PNG_SIG)) {
    row.kind = 'image';
    row.magic = 'PNG';
    row.type = 0;
    row.bpp = 4;
    row.cells = 1;
    row.w = head.readUInt32BE(16);
    row.h = head.readUInt32BE(20);
  } else if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    row.kind = 'image';
    row.magic = 'JPEG';
    row.type = 0;
    row.bpp = 4;
    row.cells = 1;
  } else if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'GIF8') {
    row.kind = 'image';
    row.magic = 'GIF';
    row.type = 0;
    row.bpp = 4;
    row.cells = 1;
  } else if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    row.kind = 'image';
    row.magic = 'WEBP';
    row.type = 0;
    row.bpp = 4;
    row.cells = 1;
  } else if (row.magic === 'OggS' || row.magic === 'RIFF') {
    row.kind = 'audio';
  } else {
    row.kind = 'other';
  }
  return row;
}

function scanLooseDirectory(root) {
  const found = new Map();
  const walk = (dir) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of list) {
      const file = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(file);
      } else if (ent.isFile()) {
        try {
          const row = parseLooseFile(file, root);
          if (!found.has(row.name)) found.set(row.name, row);
        } catch (err) {
          const name = looseName(root, file);
          if (!found.has(name)) {
            found.set(name, {
              name,
              off: 0,
              size: 0,
              magic: '',
              loose: true,
              path: file,
              error: String((err && err.message) || err),
            });
          }
        }
      }
    }
  };
  walk(root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function scanDirectory(dir, onProgress) {
  const report = (p) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(p);
    } catch (_) {
      /* 进度订阅方出错不影响扫描 */
    }
  };
  report({ phase: 'list', percent: 0, text: '正在读取游戏目录…' });
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const bins = new Map();
  const dirs = new Map();
  for (const ent of dirents) {
    if (ent.isFile() && /\.bin$/i.test(ent.name)) {
      const key = ent.name.replace(/\.bin$/i, '').toLowerCase();
      if (!bins.has(key)) bins.set(key, { name: ent.name, path: path.join(dir, ent.name) });
    } else if (ent.isDirectory()) {
      const key = ent.name.replace(/\.bin$/i, '').toLowerCase();
      if (!dirs.has(key)) dirs.set(key, { name: ent.name, path: path.join(dir, ent.name) });
    }
  }

  const work = [];
  for (const [key, bin] of bins) {
    work.push({ key, bin, folder: dirs.get(key) || null });
  }
  for (const [key, folder] of dirs) {
    if (!bins.has(key) && LOOSE_BASES.has(key)) work.push({ key, bin: null, folder });
  }
  work.sort((a, b) => a.key.localeCompare(b.key));

  const total = work.length;
  const archives = [];
  report({
    phase: 'scan',
    completed: 0,
    total,
    percent: total ? 2 : 100,
    text: total ? '找到 ' + total + ' 个资源组' : '目录里没有 .bin 或散装资源目录',
  });

  for (let i = 0; i < total; i += 1) {
    const item = work[i];
    const label = item.bin ? item.bin.name : item.folder.name;
    report({
      phase: 'scan',
      completed: i,
      total,
      percent: Math.round((i / total) * 100),
      file: label,
      text: '正在读取 ' + label,
    });

    let archive = null;
    if (item.bin) {
      try {
        archive = parseArchive(item.bin.path);
      } catch (err) {
        archive = {
          file: item.bin.name,
          path: item.bin.path,
          error: String((err && err.message) || err),
          entries: [],
        };
      }
    }

    const loose = item.folder ? scanLooseDirectory(item.folder.path) : [];
    if (loose.length) {
      const baseEntries = archive && Array.isArray(archive.entries) ? archive.entries : [];
      const looseNames = new Set(loose.map((e) => e.name));
      const entries = loose.concat(baseEntries.filter((e) => !looseNames.has(e.name)));
      const looseBytes = loose.reduce((n, e) => n + (e.size || 0), 0);
      const file = archive ? archive.file : item.key + '.bin';
      archives.push({
        ...(archive || {}),
        file,
        path: archive ? archive.path : item.folder.path,
        count: entries.length,
        bytes: (archive ? archive.bytes || 0 : 0) + looseBytes,
        entries,
        loose: true,
        looseCount: loose.length,
        looseOnly: !archive,
      });
    } else if (archive) {
      archives.push(archive);
    } else if (item.folder) {
      archives.push({
        file: item.key + '.bin',
        path: item.folder.path,
        count: 0,
        bytes: 0,
        entries: [],
        loose: true,
        looseCount: 0,
        looseOnly: true,
      });
    }

    report({
      phase: 'scan',
      completed: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 100),
      file: label,
      text: '已读取 ' + label,
    });
  }
  report({ phase: 'scan', completed: total, total, percent: 100, text: '读取完成' });
  return { root: dir, scannedAt: Date.now(), archives };
}

/* ---------- PNG ---------- */
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const rows = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (stride + 1)] = 0;
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* BGR / BGRA -> RGBA，按比例面积平均（预乘 alpha） */
function toRGBA(src, w, h, scale, ch) {
  const tw = Math.max(1, Math.round(w / scale));
  const th = Math.max(1, Math.round(h / scale));
  const out = Buffer.alloc(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      const y0 = Math.floor((ty * h) / th);
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * ch;
          const al = ch === 4 ? src[i + 3] : 255;
          b += src[i] * al;
          g += src[i + 1] * al;
          r += src[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return { w: tw, h: th, data: out };
}

/* 只读这一条：头 48 字节 + 压缩数据 */
function readEntry(file, off, size) {
  const fd = fs.openSync(file, 'r');
  try {
    return readAt(fd, off, size);
  } finally {
    fs.closeSync(fd);
  }
}

function imageMime(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

function imageSize(buf, mime) {
  if (mime === 'image/png' && buf.length >= 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  return { w: 0, h: 0 };
}

/* 免封包图片直接回原文件；PNG 能读出宽高。 */
function decodeLooseImage(buf) {
  const mime = imageMime(buf);
  if (!mime) return null;
  const size = imageSize(buf, mime);
  return {
    w: size.w,
    h: size.h,
    type: 0,
    bpp: 4,
    cells: 1,
    dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'),
  };
}

/* 解一条 hzc1 的缩略图（类型 2 只取第一格） */
function decodeThumb(file, off, size, maxW) {
  const buf = readEntry(file, off, size);
  const looseImage = decodeLooseImage(buf);
  if (looseImage) return looseImage;
  if (buf.length < 28) return { error: 'unsupported' };
  const raw = buf.readUInt32LE(4);
  const type = buf[18];
  const w = buf.readUInt16LE(20);
  const h = buf.readUInt16LE(22);
  const bpp = w && h ? Math.round(raw / (w * h)) : 0;
  if (bpp !== 3 && bpp !== 4) return { error: 'unsupported', type, w, h, bpp };
  const px = zlib.inflateSync(buf.subarray(44));
  let img = px;
  let ch = bpp;
  if (type === 2) {
    img = Buffer.alloc(w * h * 4);
    px.copy(img, 0, 0, w * h * 4);
    ch = 4;
  }
  const scale = Math.max(1, Math.round(w / Math.max(24, maxW || 120)));
  const small = toRGBA(img, w, h, scale, ch);
  return {
    w,
    h,
    type,
    bpp,
    cells: type === 2 ? Math.max(1, Math.round(bpp / 4)) : 1,
    dataUrl: 'data:image/png;base64,' + encodePNG(small.w, small.h, small.data).toString('base64'),
  };
}

/* 表情表：按格拼回整图再缩小 */
function decodeSheet(file, off, size, maxW) {
  const buf = readEntry(file, off, size);
  const looseImage = decodeLooseImage(buf);
  if (looseImage) {
    return { type: 0, cells: 1, cols: 1, rows: 1, cellW: looseImage.w, cellH: looseImage.h, w: looseImage.w, h: looseImage.h, tw: looseImage.w, th: looseImage.h, dataUrl: looseImage.dataUrl };
  }
  if (buf.length < 28) return { error: 'unsupported' };
  const type = buf[18];
  const cw = buf.readUInt16LE(20);
  const ch = buf.readUInt16LE(22);
  const px = zlib.inflateSync(buf.subarray(44));
  const cells = Math.max(1, Math.round(px.length / (cw * ch * 4)));
  const cols = 6;
  const rows = Math.ceil(cells / cols);
  const W = cw * cols;
  const H = ch * rows;
  const src = Buffer.alloc(W * H * 4);
  for (let c = 0; c < cells; c++) {
    const ox = (c % cols) * cw;
    const oy = Math.floor(c / cols) * ch;
    for (let y = 0; y < ch; y++) {
      px.copy(src, ((oy + y) * W + ox) * 4, (c * ch + y) * cw * 4, (c * ch + y + 1) * cw * 4);
    }
  }
  const scale = Math.max(1, Math.round(W / Math.max(120, maxW || 420)));
  const img = toRGBA(src, W, H, scale, 4);
  return {
    type,
    cells,
    cols,
    rows,
    cellW: cw,
    cellH: ch,
    w: W,
    h: H,
    tw: img.w / cols,
    th: img.h / rows,
    dataUrl: 'data:image/png;base64,' + encodePNG(img.w, img.h, img.data).toString('base64'),
  };
}

module.exports = { scanDirectory, parseArchive, decodeThumb, decodeSheet, TYPE_LABEL };
