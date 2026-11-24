/**
 * 免封包扫描的静态核验：同名文件夹、散装优先、纯散装资源组、PNG 预览。
 * 用法：node tools/test-loose.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { scanDirectory, decodeThumb } = require('../electron/scan');

function makeArchive(rows) {
  const names = rows.map((r) => Buffer.from(r.name + '\0'));
  const namesSize = names.reduce((n, b) => n + b.length, 0);
  const namesStart = 8 + rows.length * 12;
  let pos = namesStart + namesSize;
  const table = rows.map((r, i) => {
    const nameOff = names.slice(0, i).reduce((n, b) => n + b.length, 0);
    const data = Buffer.from(r.data);
    const row = { nameOff, off: pos, size: data.length, data };
    pos += data.length;
    return row;
  });
  const out = Buffer.alloc(pos);
  out.writeUInt32LE(rows.length, 0);
  out.writeUInt32LE(namesSize, 4);
  table.forEach((r, i) => {
    const o = 8 + i * 12;
    out.writeUInt32LE(r.nameOff, o);
    out.writeUInt32LE(r.off, o + 4);
    out.writeUInt32LE(r.size, o + 8);
  });
  let at = namesStart;
  names.forEach((b) => {
    b.copy(out, at);
    at += b.length;
  });
  table.forEach((r) => r.data.copy(out, r.off));
  return out;
}

const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp-loose-scan-'));
try {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  fs.mkdirSync(path.join(root, 'graph_bg'));
  fs.writeFileSync(path.join(root, 'graph_bg', 'BG999_000.png'), png);
  fs.writeFileSync(path.join(root, 'graph_bg', 'BG999_001.png'), png);
  fs.mkdirSync(path.join(root, 'graph_bs'));
  fs.writeFileSync(path.join(root, 'graph_bs', 'CHR_TEST_基_制服'), Buffer.from('plain'));
  fs.writeFileSync(
    path.join(root, 'graph_bg.bin'),
    makeArchive([
      { name: 'BG999_000', data: 'TEST' },
      { name: 'BG888_000', data: 'TEST' },
    ])
  );

  const progress = [];
  const scan = scanDirectory(root, (p) => progress.push(p));
  const bg = scan.archives.find((a) => a.file === 'graph_bg.bin');
  const bs = scan.archives.find((a) => a.file === 'graph_bs.bin');

  assert.ok(bg && bg.loose && !bg.looseOnly, 'graph_bg 应该和归档合并');
  assert.strictEqual(bg.looseCount, 2);
  assert.deepStrictEqual(
    bg.entries.map((e) => e.name),
    ['BG999_000', 'BG999_001', 'BG888_000'],
    '散装条目应排在归档前，并覆盖同名归档条目'
  );
  assert.strictEqual(bg.entries[0].magic, 'PNG');
  assert.strictEqual(bg.entries[0].w, 1);
  assert.strictEqual(bg.entries[0].h, 1);

  assert.ok(bs && bs.loose && bs.looseOnly, '没有 .bin 的 graph_bs 也应成为资源组');
  assert.strictEqual(bs.entries[0].name, 'CHR_TEST_基_制服');

  const pngEntry = bg.entries[1];
  const thumb = decodeThumb(pngEntry.path, pngEntry.off, pngEntry.size, 120);
  assert.strictEqual(thumb.w, 1);
  assert.strictEqual(thumb.h, 1);
  assert.ok(thumb.dataUrl.startsWith('data:image/png;base64,'));

  assert.ok(progress.length >= 2, '应产生扫描进度');
  console.log('ok   免封包合并：graph_bg 散装 2 条覆盖归档同名条目');
  console.log('ok   纯散装资源组：graph_bs 无 .bin 也能建组');
  console.log('ok   PNG 散装图预览：1x1 data URL');
  console.log('ok   进度事件：' + progress.length + ' 条');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
