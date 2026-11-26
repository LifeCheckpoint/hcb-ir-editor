/* ==========================================================================
   映射表：把 DSL 里的序号手工接到资源条目上
   TOML 由主进程解析，这里只做归一化和查询；不碰扫描结果，也不改块参数。
   没有映射表时，资源的解析和原来一样（扫描 + bgload 声明 + 默认约定）。
   ========================================================================== */

(function (root) {
  'use strict';

  const state = {
    name: '',
    path: '',
    raw: '',
    data: null,
    characters: new Map(),
    byName: new Map(),
    sprites: [],
    spriteByCha: new Map(),
    spriteByBs: new Map(),
    bg: new Map(),
    cg: new Map(),
    bgm: new Map(),
    se: new Map(),
    voice: new Map(),
  };

  const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const str = (v) => (v == null ? '' : String(v).trim());
  const num = (v, where) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(where + ' 必须是数字');
    return n;
  };

  function normalize(data) {
    data = data || {};
    const out = {
      characters: new Map(),
      byName: new Map(),
      sprites: [],
      spriteByCha: new Map(),
      spriteByBs: new Map(),
      bg: new Map(),
      cg: new Map(),
      bgm: new Map(),
      se: new Map(),
      voice: new Map(),
    };

    asList(data.character).forEach((row, i) => {
      const where = 'character[' + (i + 1) + ']';
      const no = num(row.no, where + '.no');
      const name = str(row.name);
      if (!name) throw new Error(where + ' 缺少 name');
      if (out.characters.has(no)) throw new Error('角色编号 ' + no + ' 重复');
      const aliases = asList(row.aliases).map(str).filter(Boolean);
      const hit = { no, name, aliases };
      out.characters.set(no, hit);
      [name].concat(aliases).forEach((n) => {
        const prev = out.byName.get(n);
        if (prev && prev !== hit) throw new Error('角色名或别名「' + n + '」重复');
        out.byName.set(n, hit);
      });
    });

    asList(data.sprite).forEach((row, i) => {
      const where = 'sprite[' + (i + 1) + ']';
      const cha = num(row.cha, where + '.cha');
      const bs = row.bs == null ? cha : num(row.bs, where + '.bs');
      const pose = num(row.pose, where + '.pose');
      const cloth = num(row.cloth, where + '.cloth');
      const key = bs + '|' + pose + '|' + cloth;
      if (out.sprites.some((s) => s.key === key)) throw new Error('立绘 ' + key + ' 重复');
      const faces = Array.isArray(row.faces) ? row.faces.length : row.faces == null ? null : num(row.faces, where + '.faces');
      const hit = {
        key,
        cha,
        bs,
        pose,
        cloth,
        poseName: str(row.pose_name) || String(pose),
        clothName: str(row.cloth_name) || String(cloth),
        name: str(row.name),
        body: str(row.body),
        sheet: str(row.sheet),
        faces,
      };
      out.sprites.push(hit);
      if (!out.spriteByCha.has(cha)) out.spriteByCha.set(cha, []);
      out.spriteByCha.get(cha).push(hit);
      if (!out.spriteByBs.has(bs)) out.spriteByBs.set(bs, []);
      out.spriteByBs.get(bs).push(hit);
    });

    asList(data.bg).forEach((row, i) => {
      const where = 'bg[' + (i + 1) + ']';
      const no = num(row.no, where + '.no');
      if (out.bg.has(no)) throw new Error('背景编号 ' + no + ' 重复');
      const variants = new Map();
      asList(row.variant).forEach((v, j) => {
        const diff = num(v.diff, where + '.variant[' + (j + 1) + '].diff');
        variants.set(diff, str(v.file));
      });
      if (row.variants && typeof row.variants === 'object') {
        Object.keys(row.variants).forEach((d) => variants.set(Number(d), str(row.variants[d])));
      }
      out.bg.set(no, { no, name: str(row.name) || '背景 ' + no, file: str(row.file), variants });
    });

    asList(data.cg).forEach((row, i) => {
      const where = 'cg[' + (i + 1) + ']';
      const name = str(row.name);
      if (!name) throw new Error(where + ' 缺少 name');
      if (out.cg.has(name)) throw new Error('CG「' + name + '」重复');
      out.cg.set(name, { name, label: str(row.label), file: str(row.file) || name });
    });

    asList(data.voice).forEach((row, i) => {
      const where = 'voice[' + (i + 1) + ']';
      const no = num(row.no, where + '.no');
      if (out.voice.has(no)) throw new Error('语音 ' + no + ' 重复');
      out.voice.set(no, { no, name: str(row.name), file: str(row.file) || String(no) });
    });

    ['bgm', 'se'].forEach((kind) => {
      asList(data[kind]).forEach((row, i) => {
        const where = kind + '[' + (i + 1) + ']';
        const no = num(row.no, where + '.no');
        if (out[kind].has(no)) throw new Error((kind === 'bgm' ? 'BGM ' : '音效 ') + no + ' 重复');
        out[kind].set(no, { no, name: str(row.name), file: str(row.file) || String(no) });
      });
    });

    return out;
  }

  function load(payload) {
    if (!payload) {
      clear();
      return;
    }
    const data = payload.data || payload;
    const next = normalize(data);
    state.name = str(payload.name);
    state.path = str(payload.path);
    state.raw = typeof payload.raw === 'string' ? payload.raw : '';
    state.data = data;
    state.characters = next.characters;
    state.byName = next.byName;
    state.sprites = next.sprites;
    state.spriteByCha = next.spriteByCha;
    state.spriteByBs = next.spriteByBs;
    state.bg = next.bg;
    state.cg = next.cg;
    state.bgm = next.bgm;
    state.se = next.se;
    state.voice = next.voice;
  }

  function clear() {
    state.name = '';
    state.path = '';
    state.raw = '';
    state.data = null;
    state.characters = new Map();
    state.byName = new Map();
    state.sprites = [];
    state.spriteByCha = new Map();
    state.spriteByBs = new Map();
    state.bg = new Map();
    state.cg = new Map();
    state.bgm = new Map();
    state.se = new Map();
    state.voice = new Map();
  }

  function stats() {
    const s = {
      characters: state.characters.size,
      sprites: state.sprites.length,
      bg: state.bg.size,
      cg: state.cg.size,
      bgm: state.bgm.size,
      se: state.se.size,
      voice: state.voice.size,
    };
    s.total = s.characters + s.sprites + s.bg + s.cg + s.bgm + s.se + s.voice;
    return s;
  }

  const character = (no) => state.characters.get(Number(no)) || null;
  const characterByName = (name) => state.byName.get(str(name)) || null;
  const sprite = (bs, pose, cloth) =>
    state.sprites.find((s) => s.bs === Number(bs) && s.pose === Number(pose) && s.cloth === Number(cloth)) || null;
  const spriteByCha = (cha, pose, cloth) =>
    state.sprites.find((s) => s.cha === Number(cha) && s.pose === Number(pose) && s.cloth === Number(cloth)) || null;
  const sprites = () => state.sprites.slice();
  const characters = () => [...state.characters.values()];
  const bgs = () => [...state.bg.values()];
  const audios = (kind) => [...(kind === 'bgm' ? state.bgm : state.se).values()];
  const voices = () => [...state.voice.values()];
  const cgs = () => [...state.cg.values()];

  function bg(no, diff) {
    const row = state.bg.get(Number(no));
    if (!row) return null;
    let file = row.file;
    if (diff != null && diff !== '' && row.variants.has(Number(diff))) file = row.variants.get(Number(diff));
    return { no: row.no, name: row.name, file: file || '', variants: row.variants };
  }

  const bgFile = (no, diff) => {
    const hit = bg(no, diff);
    return hit && hit.file ? hit.file : null;
  };

  const cg = (name) => state.cg.get(str(name)) || null;
  const cgFile = (name) => {
    const hit = cg(name);
    return hit ? hit.file : str(name);
  };

  const audio = (kind, no) => (kind === 'bgm' ? state.bgm : state.se).get(Number(no)) || null;
  const voice = (no) => state.voice.get(Number(no)) || null;
  const audioFile = (kind, no) => {
    const hit = audio(kind, no);
    return hit && hit.file ? hit.file : null;
  };

  function serialize() {
    if (!stats().total) return null;
    return { name: state.name, path: state.path, raw: state.raw, data: state.data };
  }

  root.MAPPING = {
    load,
    clear,
    serialize,
    stats,
    has: () => stats().total > 0,
    name: () => state.name,
    path: () => state.path,
    data: () => state.data,
    character,
    characterByName,
    characters,
    sprite,
    spriteByCha,
    sprites,
    bgs,
    cgs,
    audios,
    voices,
    voice,
    voiceFile: (no) => {
      const hit = voice(no);
      return hit ? hit.file : null;
    },
    bg,
    bgFile,
    cg,
    cgFile,
    audio,
    audioFile,
  };
})(typeof window !== 'undefined' ? window : globalThis);
