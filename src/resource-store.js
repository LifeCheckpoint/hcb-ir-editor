/* 资源来源：扫描游戏目录得到的归档。写作区与资源区都从这里取数据。 */
(function () {
  'use strict';

  const listeners = new Set();
  const thumbCache = new Map();
  const state = { scan: null, raw: null };

  const KIND = {
    graph_bs: ['sprite', '立绘'],
    graph_bg: ['background', '背景'],
    graph_vis: ['cg', '事件立绘'],
    graph_vish: ['cg', '事件差分'],
    graph: ['ui', '界面'],
    graph_sd: ['ui', 'SD 立绘'],
    patch: ['patch', '补丁'],
    voice: ['voice', '语音'],
    bgm: ['bgm', 'BGM'],
    se: ['se', '音效'],
    se_env: ['se', '环境音'],
    se_sys: ['se', '系统音'],
  };

  const kindOf = (file) => {
    const base = String(file).replace(/\.bin$/i, '');
    return KIND[base] || ['other', base];
  };

  function groupKey(name) {
    if (name.indexOf('CHR_') === 0) return name.split('_')[1] || '其他';
    if (/^BG\d/.test(name)) return (name.match(/^BG\d+/) || ['BG'])[0];
    if (/^\d+$/.test(name)) return name.length > 3 ? name.slice(0, 3) : name;
    const m = name.match(/^[A-Za-z]+/);
    return m ? m[0] : '其他';
  }

  function toArchive(a) {
    const [kind, label] = kindOf(a.file);
    const groupsMap = new Map();
    for (const e of a.entries) {
      const k = groupKey(e.name);
      let g = groupsMap.get(k);
      if (!g) groupsMap.set(k, (g = { key: k, count: 0, bytes: 0, shown: 0, items: [] }));
      g.count++;
      g.bytes += e.size;
      if (g.items.length < 60) {
        g.items.push({
          name: e.name,
          offset: e.off,
          size: e.size,
          magic: e.magic,
          rawSize: e.raw || null,
          w: e.w,
          h: e.h,
          type: e.type,
          cells: e.cells,
          path: e.path || a.path,
          loose: !!e.loose,
        });
        g.shown = g.items.length;
      }
    }
    const groups = [...groupsMap.values()].sort((x, y) => y.count - x.count).slice(0, 8);
    return {
      file: a.file,
      path: a.path,
      label,
      kind,
      count: a.count,
      bytes: a.bytes,
      magic: (a.entries[0] || {}).magic || '',
      loose: !!a.loose,
      looseCount: a.looseCount || 0,
      looseOnly: !!a.looseOnly,
      groups,
      scanned: true,
    };
  }

  /* 立绘表由项目映射表构建，scan 只提供条目偏移和缩略图。 */

  function buildSpriteChars() {
    if (!state.raw) return [];
    const a = state.raw.find((x) => x.file === 'graph_bs.bin');
    if (!a) return [];
    const map = window.MAPPING;
    if (!map || !map.has()) return [];
    const chars = new Map();
    const entryOf = (e) => ({ path: e.path || a.path, offset: e.off, size: e.size, name: e.name });
    const findEntry = (name) => a.entries.find((e) => e.name === name) || null;
    const offsetX = (e) => (e.offsetX == null ? e.faceX || 0 : e.offsetX);
    const offsetY = (e) => (e.offsetY == null ? e.faceY || 0 : e.offsetY);
    const bodyOf = (e) => ({
      entry: entryOf(e), w: e.w, h: e.h,
      offsetX: offsetX(e), offsetY: offsetY(e),
      pivotX: e.pivotX || 0, pivotY: e.pivotY || 0,
    });
    const sheetOf = (e) => ({
      entry: entryOf(e), cellW: e.w, cellH: e.h, cells: e.cells || 1, cols: 6,
      faceX: offsetX(e), faceY: offsetY(e),
      pivotX: e.pivotX || 0, pivotY: e.pivotY || 0,
    });
    const addPose = (g, no, name) => {
      const i = g.poseNos.indexOf(no);
      if (i < 0) {
        g.poseNos.push(no);
        g.poses.push(name || String(no));
      } else {
        g.poses[i] = name || String(no);
      }
    };
    const addCloth = (g, no, name) => {
      const i = g.clothNos.indexOf(no);
      if (i < 0) {
        g.clothNos.push(no);
        g.cloths.push(name || String(no));
      } else {
        g.cloths[i] = name || String(no);
      }
    };

    // 立绘表只由映射表构建，不再从 graph_bs 的名字反推 cha/pose/cloth。
    map.sprites().forEach((row) => {
      // cha 是角色编号，bs 是剧本 [bs] 的第一个参数；旧表没有 bs 时两者相同。
      const key = Number(row.bs == null ? row.cha : row.bs);
      let g = chars.get(key);
      if (!g) {
        const who = map.character(row.cha);
        g = {
          name: who ? who.name : '角色 ' + row.cha,
          cha: key,
          characterNo: row.cha,
          viewX: who && who.viewX ? who.viewX : 0,
          poses: [],
          poseNos: [],
          cloths: [],
          clothNos: [],
          bodies: {},
          sheets: {},
          bodyVariants: {},
          sheetVariants: {},
        };
        chars.set(key, g);
      }
      addPose(g, row.pose, row.poseName);
      addCloth(g, row.cloth, row.clothName);
      const k = row.pose + '|' + row.cloth;
      const body = row.body ? findEntry(row.body) : null;
      if (body) g.bodies[k] = bodyOf(body);
      const sheet = row.sheet ? findEntry(row.sheet) : null;
      if (sheet) {
        const sh = sheetOf(sheet);
        if (row.faces != null) sh.cells = row.faces;
        g.sheets[k] = sh;
      }
      const bodyBase = g.bodies[k] || null;
      const sheetBase = g.sheets[k] || null;
      const bodyStem = row.body ? row.body.replace(/[LUS]$/, '') : '';
      const sheetStem = row.sheet ? row.sheet.replace(/[LUS](_表情)$/, '$1') : '';
      g.bodyVariants[k] = { '1': bodyBase, '-1': bodyBase, '0': bodyBase, '2': bodyBase };
      g.sheetVariants[k] = { '1': sheetBase, '-1': sheetBase, '0': sheetBase, '2': sheetBase };
      // 实机 l 值：0=L，-1=U，1=默认，2=S；缺变体回退默认。
      [['0', 'L'], ['-1', 'U'], ['2', 'S']].forEach(([lv, suffix]) => {
        const vBody = bodyStem ? findEntry(bodyStem + suffix) : null;
        if (vBody) g.bodyVariants[k][lv] = bodyOf(vBody);
        const sheetName = sheetStem ? sheetStem.replace(/(_表情)$/, suffix + '$1') : '';
        const vSheet = sheetName ? findEntry(sheetName) : null;
        if (vSheet) {
          const sh = sheetOf(vSheet);
          if (row.faces != null) sh.cells = row.faces;
          g.sheetVariants[k][lv] = sh;
        }
      });
    });

    let out = [...chars.values()].filter(
      (c) =>
        (Object.keys(c.bodies).length ||
          Object.values(c.bodyVariants || {}).some((v) => Object.values(v).some(Boolean))) &&
        c.poses.length &&
        c.cloths.length
    );
    out.forEach((c) => {
      const allSheets = Object.values(c.sheets).concat(
        ...Object.values(c.sheetVariants || {}).map((v) => Object.values(v))
      );
      allSheets.forEach((s) => {
        if (!s || s.tw != null) return;
        const W = s.cellW * s.cols;
        const scale = Math.max(1, Math.round(W / 420));
        s.tw = s.cellW / scale;
        s.th = s.cellH / scale;
        s.rows = Math.ceil(s.cells / s.cols);
      });
    });
    out.sort((a2, b2) => (a2.cha == null ? 99 : a2.cha) - (b2.cha == null ? 99 : b2.cha) || a2.name.localeCompare(b2.name));
    return out;
  }

  let spriteCache = null;

  const RES = {
    mode: () => (state.scan ? 'scan' : 'empty'),
    root: () => (state.scan ? state.scan.root : ''),
    scannedAt: () => (state.scan ? state.scan.scannedAt : 0),
    archives: () => (state.scan ? state.scan.archives : []),
    scan: () => state.scan,
    entries(file) {
      if (!state.raw) return [];
      const a = state.raw.find((x) => x.file === file);
      if (!a) return [];
      return a.entries.map((e) => ({ ...e, offset: e.off, path: e.path || a.path, group: groupKey(e.name) }));
    },
    find(name) {
      if (!state.raw) return null;
      for (const a of state.raw) {
        const hit = a.entries.find((e) => e.name === name);
        if (hit) return { archive: a, entry: { ...hit, offset: hit.off, path: hit.path || a.path } };
      }
      return null;
    },
    names(file) {
      const a = state.raw && state.raw.find((x) => x.file === file);
      return a ? a.entries.map((e) => e.name) : [];
    },
    spriteChars() {
      if (!state.scan) return [];
      if (!spriteCache) spriteCache = buildSpriteChars();
      return spriteCache;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    resetSprites() {
      spriteCache = null;
    },
    setScan(scan) {
      state.raw = scan ? scan.archives || [] : null;
      state.scan = scan ? { ...scan, archives: (scan.archives || []).map(toArchive) } : null;
      thumbCache.clear();
      spriteCache = null;
      listeners.forEach((fn) => fn(RES));
    },
    async scanDirectory(dir) {
      if (!window.shell || !window.shell.scanResources) return { error: '没有扫描通道' };
      if (window.SCAN_UI) window.SCAN_UI.start();
      let res;
      try {
        res = await window.shell.scanResources(dir);
      } catch (err) {
        res = { error: String((err && err.message) || err) };
      }
      if (res && res.archives && res.archives.length) RES.setScan(res);
      if (res && res.error === '已取消') return null;
      if (window.SCAN_UI) {
        if (res && res.error) window.SCAN_UI.fail(res.error);
        else window.SCAN_UI.finish();
      }
      return res;
    },
    async pickAndScan() {
      if (!window.shell || !window.shell.scanResources) return { error: '没有扫描通道' };
      const dir = await window.shell.pickDirectory();
      if (!dir) return null;
      return RES.scanDirectory(dir);
    },
    thumb(entry, w) {
      const key = (entry.path || '') + ':' + entry.offset + ':' + (w || 160);
      if (thumbCache.has(key)) return thumbCache.get(key);
      if (!window.shell || !window.shell.loadThumb || !entry.path) return Promise.resolve(null);
      const p = window.shell
        .loadThumb({ file: entry.path, off: entry.offset, size: entry.size, w: w || 160 })
        .then((r) => (r && r.dataUrl ? r.dataUrl : null))
        .catch(() => null);
      thumbCache.set(key, p);
      return p;
    },
    sheet(entry, w) {
      const key = 'sheet:' + (entry.path || '') + ':' + entry.offset + ':' + (w || 420);
      if (thumbCache.has(key)) return thumbCache.get(key);
      if (!window.shell || !window.shell.loadSheet || !entry.path) return Promise.resolve(null);
      const p = window.shell
        .loadSheet({ file: entry.path, off: entry.offset, size: entry.size, w: w || 420 })
        .then((r) => (r && r.dataUrl ? r : null))
        .catch(() => null);
      thumbCache.set(key, p);
      return p;
    },
  };

  window.RES = RES;
})();
