/**
 * 映射表的静态核验：TOML 解析 + 归一化 + 查询。
 * 用法：node tools/test-mapping.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const toml = require('@iarna/toml');

require('../src/mapping.js');
const M = globalThis.MAPPING;

const root = path.join(__dirname, '..');
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log('FAIL', name, 'actual=', JSON.stringify(actual), 'expected=', JSON.stringify(expected));
  } else {
    console.log('ok  ', name, JSON.stringify(actual));
  }
}

function throws(name, fn) {
  try {
    fn();
    failed++;
    console.log('FAIL', name, '(no error)');
  } catch (err) {
    console.log('ok  ', name, String(err.message || err));
  }
}

const raw = fs.readFileSync(path.join(root, 'mappings', 'sample.toml'), 'utf8');
const data = toml.parse(raw);
M.load({ name: 'sample.toml', raw, data });

check('stats', M.stats(), { characters: 2, sprites: 1, bg: 2, cg: 1, bgm: 1, se: 1, voice: 0, total: 8 });
check('character 3', M.character(3).name, '千和');
check('alias', M.characterByName('ちわ').no, 3);
check('sprite body', M.sprite(3, 1, 0).body, 'CHR_千和_基_制服');
check('sprite faces', M.sprite(3, 1, 0).faces, 48);
check('bg base', M.bgFile(67, 0), 'BG067_000');
check('bg diff 1 is base', M.bgFile(67, 1), 'BG067_000');
check('bg variant', M.bgFile(67, 2), 'BG067_010');
check('bg custom', M.bgFile(500), 'BG500');
check('cg file', M.cgFile('KURO_e011a1'), 'KURO_e011a1');
check('bgm file', M.audioFile('bgm', 44), '044');
check('se file', M.audioFile('se', 209), '209');
check('serialize keys', Object.keys(M.serialize()).sort(), ['data', 'name', 'path', 'raw']);

/* 错误输入不能把已有映射弄坏 */
throws('duplicate bg', () => M.load({ data: { bg: [{ no: 67, file: 'a' }, { no: 67, file: 'b' }] } }));
check('state kept after error', M.stats().bg, 2);

throws('character without name', () => M.load({ data: { character: [{ no: 1 }] } }));
throws('sprite without pose', () => M.load({ data: { sprite: [{ cha: 1, cloth: 1 }] } }));

M.clear();
check('cleared', M.stats().total, 0);
check('cg fallback', M.cgFile('X'), 'X');
check('bg fallback', M.bgFile(67), null);

/* 立绘编号可以和角色编号分开：bs 是剧本里的第一个参数 */
M.load({
  data: {
    character: [{ no: 5, name: '测试角色' }],
    sprite: [{ cha: 5, bs: 99, pose: 1, cloth: 0, body: 'CHR_TEST', sheet: 'CHR_TEST_表情' }],
  },
});
check('bs lookup', M.sprite(99, 1, 0).body, 'CHR_TEST');
check('bs keeps cha', M.sprite(99, 1, 0).cha, 5);
check('old cha lookup misses', M.sprite(5, 1, 0), null);
check('spriteByCha still works', M.spriteByCha(5, 1, 0).body, 'CHR_TEST');
M.clear();

/* 生成出来的完整表也要能解析 */
const sakuraPath = path.join(root, 'mappings', 'sakura.toml');
if (fs.existsSync(sakuraPath)) {
  const sakuraRaw = fs.readFileSync(sakuraPath, 'utf8');
  M.load({ name: 'sakura.toml', raw: sakuraRaw, data: toml.parse(sakuraRaw) });
  check('sakura stats', M.stats(), { characters: 24, sprites: 99, bg: 62, cg: 238, bgm: 70, se: 304, voice: 0, total: 797 });
  check('sakura 14', M.sprite(14, 1, 0).body, 'CHR_ハル２_基_制服');
  check('sakura 3 cloth 0', M.sprite(3, 1, 0).body, 'CHR_千和_基_制服');
  check('sakura bg 67', M.bgFile(67), 'BG067_000');
  check('sakura bg 67 diff 2', M.bgFile(67, 2), 'BG067_010');
  check('sakura bg 67 diff 3', M.bgFile(67, 3), 'BG067_020');
  M.clear();
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
