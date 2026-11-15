/**
 * DSL 解析器的静态核验：不开窗口，直接跑 src/dsl.js。
 * 用法：node tools/test-dsl.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

require('../src/dsl.js');
const DSL = globalThis.HCB_DSL;

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

/* 1. 真实脚本：混编码，自动逐行判断 */
const raw = fs.readFileSync(path.join(root, '.ref', 'Script.txt'));
const dec = DSL.decode(raw, 'auto');
check('encoding', dec.encoding, 'mixed');
check('utf8 lines', dec.detail.utf8, 861);
check('gbk lines', dec.detail.gbk, 998);
check('no replacement chars', dec.text.includes('\uFFFD'), false);

const parsed = DSL.parse(dec.text, { split: true });
check('lines', parsed.stats.lines, 1859);
check('labels', parsed.stats.labels, 10);
check('sections', parsed.stats.sections, 11);
check('unknown test', parsed.stats.unknown.test, 7);
check('raw blocks', parsed.stats.unknownLines, 9);
check('unterminated sel', parsed.stats.unterminatedSel, 0);

const all = parsed.sections.flatMap((s) => s.blocks);
const diaExtra = all.filter((b) => b.type === 'dia' && b.extra);
check('dia extra count', diaExtra.length, 21);
check('dia extra tail', diaExtra[0].extra, ['1']);
check('dia extra size', diaExtra[0].data.size, 'nil');

const chaload = all.find((b) => b.type === 'chaload');
check('chaload name', chaload.data.name, '其他角色');
check('chaload aliases keep commas', chaload.data.aliases.includes('1:    雪雪'), true);

const cg = all.filter((b) => b.type === 'cg');
check('cg keep form', cg[0].data.keep, true);
check('cg keep time', cg[0].data.time, '1000');
check('cg full form', all.filter((b) => b.type === 'cg' && b.data.keep === false).length, 0);

const bs = all.find((b) => b.type === 'bs');
check('bs lyr', bs.data.lyr, '1');
check('bs face', bs.data.face, '12');

const se4 = all.find((b) => b.type === 'se' && b.data.vol);
check('se volume form', [se4.data.no, se4.data.mode, se4.data.vol, se4.data.time], ['66', 'loop', '75', '2000']);

const sections = parsed.sections.map((s) => s.title);
check('section titles', sections.slice(0, 3), ['预载', 'start', 'testing2']);

const flat = DSL.parse(dec.text, { split: false });
check('split off sections', flat.stats.sections, 1);

/* 2. 显式编码 */
const asGbk = DSL.decode(raw, 'gb18030');
check('gbk decode ok', !!asGbk.text && !asGbk.error, true);
const asUtf8 = DSL.decode(raw, 'utf-8');
check('utf8 decode rejects mixed bytes', !!asUtf8.error, true);

/* 3. fixture：每个原语都认 */
const fixture = fs.readFileSync(path.join(root, 'tests', 'fixture.txt'), 'utf8');
const fx = DSL.parse(fixture, { split: true });
const fxAll = fx.sections.flatMap((s) => s.blocks);
const types = new Set(fxAll.map((b) => b.type));
const expectedTypes = [
  'start', 'end', 'label', 'jump', 'sel', 'ssel', 'achieve', 'chaload',
  'cha', 'dia', 'msg', 'bg', 'bgload', 'cgload', 'cg', 'white', 'black',
  'eyecatch', 'movie', 'effect', 'bs', 'bsfade', 'bs_fade', 'bs_move',
  'bs_color', 'bs_ani', 'bgm', 'bgmstop', 'se', 'wait', 'shake', 'motion',
  'v3d', 'snow', 'fog', 'endback', 'global_set', 'global_eq', 'note', 'custom',
];
expectedTypes.forEach((t) => check('fixture has ' + t, types.has(t), true));

const custom = fxAll.find((b) => b.type === 'custom');
check('custom keeps line', custom.data.line, '[test,pushint(1)]');
const sel = fxAll.find((b) => b.type === 'sel');
check('sel options', sel.data.options.map((o) => o.target), ['::end', '::end']);
check('fixture unknown', fx.stats.unknownLines, 1);
check('fixture sections', fx.stats.sections, 4);

/* 4. 导出编码：GBK 与 Windows code page 936 一致 */
const { encodeGbk } = require('../electron/gbk');
const gbk = encodeGbk('大雅 私服 表情 12');
check('gbk bytes', gbk.bytes.toString('hex'), 'b4f3d1c520cbbdb7fe20b1edc7e9203132');
check('gbk ascii', encodeGbk('abc').bytes.toString('hex'), '616263');
check('gbk rejects emoji', encodeGbk('😀').bad.length, 1);

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
