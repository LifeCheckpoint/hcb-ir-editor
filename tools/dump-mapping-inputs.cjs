const fs = require('node:fs');
const path = require('node:path');
const { scanDirectory } = require('../electron/scan');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.ref', 'fvp');
const gameDir = process.env.GAME_DIR || '';
if (!gameDir) {
  console.error('请先设置 GAME_DIR 到放 .bin 的游戏目录');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const scan = scanDirectory(gameDir);
const archive = (file) => scan.archives.find((a) => a.file === file);

const bs = archive('graph_bs.bin');
const bsMeta = {};
for (const e of bs.entries) bsMeta[e.name] = { cells: e.cells || 1, w: e.w, h: e.h, type: e.type };
fs.writeFileSync(path.join(outDir, 'bs_meta.json'), JSON.stringify(bsMeta), 'utf8');

fs.writeFileSync(path.join(outDir, 'bg_names.json'), JSON.stringify(archive('graph_bg.bin').entries.map((e) => e.name)), 'utf8');

const cg = [];
for (const file of ['graph_vis.bin', 'graph_vish.bin']) {
  for (const e of archive(file).entries) cg.push({ file, name: e.name });
}
fs.writeFileSync(path.join(outDir, 'cg_names.json'), JSON.stringify(cg), 'utf8');

const audio = {
  bgm: archive('bgm.bin').entries.map((e) => e.name),
  se: archive('se.bin').entries.map((e) => e.name),
};
fs.writeFileSync(path.join(outDir, 'audio_names.json'), JSON.stringify(audio), 'utf8');

// 背景显示名是生成时的输入；没有它仍能生成，只是名字会空。
const domainPath = path.join(outDir, 'domain.json');
if (!fs.existsSync(domainPath)) {
  fs.writeFileSync(domainPath, JSON.stringify({ bg: [] }), 'utf8');
  console.warn('domain.json 不存在，背景名将为空；用旧的 hcb_build.py 表补一份即可。');
}

const loaded = fs
  .readFileSync(path.join(root, '.ref', 'cg_loaded.txt'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^".*"$/.test(l))
  .map((l) => l.slice(1, -1));
fs.writeFileSync(path.join(outDir, 'cg_loaded.json'), JSON.stringify(loaded), 'utf8');

console.log('graph_bs', Object.keys(bsMeta).length, 'bg', archive('graph_bg.bin').entries.length, 'cg', cg.length, 'cg_loaded', loaded.length, 'audio', audio.bgm.length + audio.se.length);
