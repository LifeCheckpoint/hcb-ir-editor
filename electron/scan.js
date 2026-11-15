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

function scanDirectory(dir) {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.bin$/i.test(d.name))
    .map((d) => path.join(dir, d.name))
    .sort();
  const archives = [];
  for (const f of files) {
    try {
      const a = parseArchive(f);
      if (a) archives.push(a);
    } catch (err) {
      archives.push({ file: path.basename(f), path: f, error: String(err.message || err), entries: [] });
    }
  }
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

/* 解一条 hzc1 的缩略图（类型 2 只取第一格） */
function decodeThumb(file, off, size, maxW) {
  const buf = readEntry(file, off, size);
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
