/* ==========================================================================
   资源工作区：真实归档 + 语义层
   底层：扫描游戏目录得到的 .bin 名称表
   上层：绑定表（项目里的名字 → 引擎调用 → 扫描到的文件）
   ========================================================================== */

(function () {
  'use strict';

  const L = window.LUCIDE || {};
  const icon = (name, cls) =>
    '<svg class="' + (cls || 'icon') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (L[name] || '') + '</svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kb = (n) => (n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const hex = (n) => '0x' + n.toString(16).toUpperCase();

  /* 资源来源：扫描到的游戏目录；没扫描时就是空的 */
  let ARCHIVES = window.RES ? window.RES.archives() : [];

  /* ------------------------------------------------------------------ *
   * 真实条目索引
   * ------------------------------------------------------------------ */

  const ENTRY_INDEX = [];
  function rebuildIndex() {
    ARCHIVES = window.RES ? window.RES.archives() : [];
    ENTRY_INDEX.length = 0;
    for (const a of ARCHIVES) {
      const full = a.scanned && window.RES ? window.RES.entries(a.file) : null;
      if (full) {
        for (const e of full) ENTRY_INDEX.push({ archive: a, group: e.group, entry: e });
      } else {
        for (const g of a.groups) for (const e of g.items) ENTRY_INDEX.push({ archive: a, group: g.key, entry: e });
      }
    }
  }
  rebuildIndex();
  const findEntries = (name) => ENTRY_INDEX.filter((x) => x.entry.name === name);
  const searchEntries = (fragment) => ENTRY_INDEX.filter((x) => x.entry.name.includes(fragment));

  /* ------------------------------------------------------------------ *
   * 绑定表：项目里的名字 → 引擎调用 → 扫描到的文件
   * ------------------------------------------------------------------ */

  const BINDING_KIND = { bg: '背景', bs: '立绘', cg: 'CG', se: '音效', bgm: 'BGM' };

  let BINDINGS = [];
  let bindSeq = 0;

  const nextBindId = () => {
    let id;
    do {
      id = 'bind-' + ++bindSeq;
    } while (BINDINGS.some((b) => b.id === id));
    return id;
  };

  const parseCall = (call) => {
    const m = /^\[([a-z_]+)(?:,(.+))?\]$/.exec(String(call || '').trim());
    if (!m) return null;
    return { cmd: m[1], args: m[2] ? m[2].split(',').map((x) => x.trim()) : [] };
  };

  const kindOfCall = (cmd) => BINDING_KIND[cmd] || cmd;

  function resolveBinding(b) {
    const call = parseCall(b.call);
    if (!call) return { status: 'missing', reason: '调用格式不对', entries: [] };
    if (!window.RES || window.RES.mode() !== 'scan') return { status: 'missing', reason: '没有扫描游戏目录', entries: [] };

    if (call.cmd === 'bg') {
      const id = call.args[0];
      const diff = call.args[1];
      if (id == null || id === '') return { status: 'missing', reason: '缺少背景编号', entries: [] };
      const entry = window.WIRING && window.WIRING.bgEntry(id, diff);
      const ref = window.WIRING && window.WIRING.bgRef(id, diff);
      return entry
        ? { status: 'resolved', entries: [{ archive: { file: 'graph_bg.bin' }, entry }] }
        : { status: 'missing', reason: ref ? ref.text : '没有接线路由', entries: [] };
    }

    if (call.cmd === 'cg') {
      const name = call.args[0];
      const entry = window.WIRING ? window.WIRING.cgEntry(name) : null;
      const ref = window.WIRING ? window.WIRING.cgRef(name) : null;
      if (!entry) return { status: 'missing', reason: ref ? ref.text : '没有接线路由', entries: [] };
      const hit = window.RES.find(window.WIRING.cgFile(name));
      return { status: 'resolved', entries: hit ? [hit] : [{ archive: { file: 'graph_vis.bin' }, entry }] };
    }

    if (call.cmd === 'se' || call.cmd === 'bgm') {
      const raw = String(call.args[0]);
      const e = window.WIRING ? window.WIRING.audioEntry(call.cmd, raw) : null;
      const ref = window.WIRING ? window.WIRING.audioRef(call.cmd, raw) : null;
      if (!e) return { status: 'missing', reason: ref ? ref.text : '没有接线路由', entries: [] };
      const hit = window.RES.find(window.WIRING.audioFile(call.cmd, raw));
      return { status: 'resolved', entries: hit ? [hit] : [] };
    }

    if (call.cmd === 'bs') {
      const m = window.MAPPING;
      if (!m || !m.has()) return { status: 'missing', reason: '项目没有映射表，立绘编号无法解析', entries: [] };
      const cha = call.args[0];
      const pose = call.args[1];
      const cloth = call.args[2];
      const row = m.sprite(cha, pose, cloth);
      if (!row) return { status: 'missing', reason: '映射表没有 立绘 ' + cha + '/' + pose + '/' + cloth, entries: [] };
      if (!row.body) return { status: 'missing', reason: '映射表 立绘 ' + cha + '/' + pose + '/' + cloth + ' 没有 body', entries: [] };
      const hit = window.RES.find(row.body);
      if (!hit) return { status: 'missing', reason: '映射表 立绘 ' + cha + '/' + pose + '/' + cloth + ' → ' + row.body + '；归档里没有', entries: [] };
      return { status: 'resolved', entries: [hit] };
    }

    return { status: 'unknown', reason: '这个原语还没接', entries: [] };
  }

  const statusText = (s) => (s === 'resolved' ? '已解析' : s === 'unknown' ? '未接' : '缺失');

  const state = { view: 'assets', archive: 0, group: '*', entry: null, binding: null, tab: 'preview', page: 0 };

  window.BINDINGS = {
    serialize: () => BINDINGS.map((b) => ({ id: b.id, name: b.name, call: b.call, note: b.note || '' })),
    load: (list) => {
      BINDINGS = Array.isArray(list)
        ? list.map((b) => ({ id: b.id || nextBindId(), name: b.name || '', call: b.call || '', note: b.note || '' }))
        : [];
      state.binding = BINDINGS[0] ? BINDINGS[0].id : null;
    },
    add: (list) => {
      let n = 0;
      (list || []).forEach((b) => {
        const name = String((b && b.name) || '').trim();
        if (!name || BINDINGS.some((x) => x.name === name)) return;
        BINDINGS.push({ id: nextBindId(), name, call: b.call || '', note: b.note || '' });
        n++;
      });
      if (n) state.binding = state.binding || BINDINGS[0].id;
      return n;
    },
    count: () => BINDINGS.length,
    refresh: () => render(),
  };

  const archive = () => ARCHIVES[state.archive];
  const groups = () => archive().groups;

  /* 全部条目：扫描到的用完整列表，样本用抽样清单 */
  function allItems() {
    const a = archive();
    if (!a) return [];
    if (a.scanned && window.RES) {
      const list = window.RES.entries(a.file).map((e) => ({
        name: e.name,
        offset: e.offset,
        size: e.size,
        magic: e.magic,
        rawSize: e.raw || null,
        w: e.w,
        h: e.h,
        type: e.type,
        cells: e.cells,
        path: e.path,
        group: e.group,
      }));
      return state.group === '*' ? list : list.filter((e) => e.group === state.group);
    }
    const list = state.group === '*' ? a.groups.flatMap((g) => g.items) : (a.groups.find((g) => g.key === state.group) || { items: [] }).items;
    return list;
  }

  const PAGE_SIZE = 100;
  const pageCount = () => Math.max(1, Math.ceil(allItems().length / PAGE_SIZE));

  function pageItems() {
    const list = allItems();
    const n = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(state.page, n - 1));
    return list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  }

  const currentEntry = () => pageItems().find((e) => e.name === state.entry) || pageItems()[0];

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  const navEl = document.getElementById('res-nav');
  const mainEl = document.getElementById('res-main');
  const detailEl = document.getElementById('res-detail');

  function renderNav() {
    const navArchive = (a, i) =>
      '<button class="res-nav__item' + (state.view === 'assets' && i === state.archive ? ' is-active' : '') + '" type="button" data-archive="' + i + '">' +
      icon(a.kind === 'voice' ? 'mic' : a.kind === 'bgm' || a.kind === 'se' ? 'volume-2' : a.kind === 'background' ? 'mountain' : a.kind === 'sprite' ? 'user-round' : 'image', 'icon icon--14') +
      '<span>' + esc(a.file.replace('.bin', '')) + '</span><span class="res-nav__count">' + a.count + '</span></button>';

    const scanned = window.RES.mode() === 'scan';
    const mapStats = window.MAPPING ? window.MAPPING.stats() : { total: 0 };
    navEl.innerHTML =
      '<div class="res-source">' +
      '<div class="res-source__label">来源</div>' +
      '<button class="res-source__btn" type="button" data-scan>' + icon('folder', 'icon icon--14') +
      '<span>' + (scanned ? '重新扫描' : '扫描游戏目录') + '</span></button>' +
      '<div class="res-source__meta">' + esc(sourceText()) + '</div>' +
      '</div>' +
      '<div class="res-nav__group">' +
      '<button class="res-nav__item' + (state.view === 'bindings' ? ' is-active' : '') + '" type="button" data-view="bindings">' +
      icon('link', 'icon icon--14') + '<span>绑定表</span><span class="res-nav__count">' + BINDINGS.length + '</span></button>' +
      '<button class="res-nav__item' + (state.view === 'mapping' ? ' is-active' : '') + '" type="button" data-view="mapping">' +
      icon('files', 'icon icon--14') + '<span>映射表</span><span class="res-nav__count">' + mapStats.total + '</span></button>' +
      '</div>' +
      (scanned
        ? '<label class="search">' + icon('search', 'icon icon--14') + '<input type="search" placeholder="搜索" aria-label="搜索" /></label>' +
          '<div class="res-nav__group"><div class="res-nav__group-label">归档</div>' + ARCHIVES.map(navArchive).join('') + '</div>'
        : '<p class="res-hint">选到放 .bin 的那一层。</p>');
  }

  function sourceText() {
    if (window.RES.mode() === 'scan') {
      const root = window.RES.root() || '';
      const short = root.length > 26 ? '…' + root.slice(-24) : root;
      return short + '　' + ARCHIVES.length + ' 个归档';
    }
    return '还没扫描';
  }

  /* —— 资源视图 —— */
  function renderAssets() {
    const a = archive();
    if (!a) {
      mainEl.innerHTML = '<div class="res-empty">还没有扫描游戏目录</div>';
      return;
    }
    const items = pageItems();
    const cur = currentEntry();
    const total = allItems().length;
    const pages = pageCount();
    const rows = items
      .map(
        (e) =>
          '<tr data-name="' + esc(e.name) + '" class="' + (e.name === cur.name ? 'is-selected' : '') + '">' +
          '<td class="res-cell-name">' + esc(e.name) + '</td>' +
          '<td class="res-num">' + kb(e.size) + '</td>' +
          '<td class="res-num">' + (e.rawSize ? kb(e.rawSize) : '—') + '</td>' +
          '<td class="res-num">' + hex(e.offset) + '</td></tr>'
      )
      .join('');

    const chips =
      '<button class="res-chip' + (state.group === '*' ? ' is-on' : '') + '" type="button" data-group="*">全部 ' + a.count + '</button>' +
      groups().map((g) => '<button class="res-chip' + (state.group === g.key ? ' is-on' : '') + '" type="button" data-group="' + esc(g.key) + '">' + esc(g.key) + ' ' + g.count + '</button>').join('');

    mainEl.innerHTML =
      '<div class="res-main__top"><div class="res-title">' + esc(a.label) + '</div>' +
      '<div class="res-sub"><span>' + esc(a.file) + '</span><span>' + a.count + ' 条</span><span>' + (a.bytes / 1048576).toFixed(1) + ' MB</span><span>' + esc(a.magic) + '</span></div>' +
      '<div class="res-filters">' + chips + '</div></div>' +
      '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>名称</th><th class="res-num">压缩</th><th class="res-num">解压后</th><th class="res-num">偏移</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="res-pager">' +
      '<button class="res-pager__btn" type="button" data-page="-1"' + (state.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="res-pager__info">第 <input class="res-pager__input" type="text" inputmode="numeric" value="' + (state.page + 1) + '" aria-label="页码" /> / ' + pages + ' 页' +
      '<span class="res-pager__total">共 ' + total + ' 条</span></span>' +
      '<button class="res-pager__btn" type="button" data-page="1"' + (state.page >= pages - 1 ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    mainEl.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => { state.group = b.dataset.group; state.entry = null; state.page = 0; render(); }));
    mainEl.querySelectorAll('[data-name]').forEach((tr) =>
      tr.addEventListener('click', () => {
        state.entry = tr.dataset.name;
        mainEl.querySelectorAll('.res-table tbody tr').forEach((row) => row.classList.toggle('is-selected', row === tr));
        renderDetail();
      })
    );
    mainEl.querySelectorAll('[data-page]').forEach((b) =>
      b.addEventListener('click', () => {
        state.page = Math.max(0, Math.min(pages - 1, state.page + Number(b.dataset.page)));
        state.entry = null;
        render();
      })
    );
    const jump = mainEl.querySelector('.res-pager__input');
    if (jump) {
      const go = () => {
        const n = Number(jump.value);
        if (!Number.isFinite(n)) return;
        state.page = Math.max(0, Math.min(pages - 1, Math.round(n) - 1));
        state.entry = null;
        render();
      };
      jump.addEventListener('change', go);
      jump.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    }
  }

  /* 只改选中态，不重建表格，滚动位置就不会跳回顶部 */
  function syncSelection() {
    const cur = currentEntry();
    mainEl.querySelectorAll('.res-table tbody tr').forEach((row) => {
      row.classList.toggle('is-selected', !!cur && row.dataset.name === cur.name);
    });
  }

  /* —— 绑定表 —— */
  function renderBindings() {
    const rows = BINDINGS.length
      ? BINDINGS.map((b) => {
          const r = resolveBinding(b);
          const call = parseCall(b.call);
          const kind = call ? kindOfCall(call.cmd) : '—';
          const target = r.status === 'resolved' && r.entries[0] ? r.entries[0].archive.file + '  ' + r.entries[0].entry.name : r.reason || '—';
          return (
            '<tr data-binding="' + esc(b.id) + '" class="' + (b.id === state.binding ? 'is-selected' : '') + '">' +
            '<td class="res-cell-name">' + esc(b.name) + '</td>' +
            '<td>' + esc(kind) + '</td>' +
            '<td class="res-cell-mono">' + esc(b.call) + '</td>' +
            '<td class="res-cell-name">' + esc(target) + '</td>' +
            '<td><span class="res-status res-status--' + r.status + '"><span class="res-status__dot"></span>' + statusText(r.status) + '</span></td></tr>'
          );
        }).join('')
      : '<tr><td colspan="5"><div class="empty">还没有绑定。导入 DSL 后，bgload 与 cgload 会登记到这里。</div></td></tr>';

    mainEl.innerHTML =
      '<div class="res-main__top"><div class="res-title">绑定表</div>' +
      '<div class="res-sub"><span>' + BINDINGS.length + ' 条</span><span>' +
      (window.RES.mode() === 'scan' ? '按当前扫描解析' : '还没有扫描游戏目录') + '</span></div></div>' +
      '<div class="res-table-wrap"><table class="res-table res-table--wide"><thead><tr><th>名称</th><th>类型</th><th>调用</th><th>文件</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    mainEl.querySelectorAll('[data-binding]').forEach((tr) =>
      tr.addEventListener('click', () => {
        state.binding = tr.dataset.binding;
        state.tab = 'overview';
        mainEl.querySelectorAll('.res-table tbody tr').forEach((row) => row.classList.toggle('is-selected', row === tr));
        renderDetail();
      })
    );
  }

  /* —— 映射表视图 —— */
  let mappingError = '';

  function renderMapping() {
    const map = window.MAPPING;
    const has = !!(map && map.has());
    const s = map ? map.stats() : { total: 0, characters: 0, sprites: 0, bg: 0, cg: 0, bgm: 0, se: 0 };
    const mpath = map && map.path ? map.path() : '';
    const shortPath = (p) => (p.length > 72 ? '…' + p.slice(-70) : p);

    const rows = [];
    if (has) {
      map.characters().forEach((c) =>
        rows.push(['角色', c.no, c.name, c.aliases.filter((a) => a !== c.name).join('、') || '—'])
      );
      map.sprites().forEach((sp) =>
        rows.push(['立绘', sp.cha + ' / ' + sp.pose + ' / ' + sp.cloth, sp.poseName + ' / ' + sp.clothName, (sp.body || '—') + (sp.sheet ? ' + 表情' : '')])
      );
      map.bgs().forEach((b) =>
        rows.push(['背景', b.no, b.name, (b.file || '—') + (b.variants.size ? '  +' + b.variants.size + ' 差分' : '')])
      );
      map.cgs().forEach((c) => rows.push(['CG', '—', c.label || c.name, c.file]));
      map.audios('bgm').forEach((a) => rows.push(['BGM', a.no, a.name || '—', a.file]));
      map.audios('se').forEach((a) => rows.push(['音效', a.no, a.name || '—', a.file]));
      map.voices().forEach((v) => rows.push(['语音', v.no, v.name || '—', v.file]));
    }

    const table = has
      ? '<div class="res-table-wrap"><table class="res-table res-table--wide"><thead><tr><th>类型</th><th>序号</th><th>名称</th><th>文件</th></tr></thead><tbody>' +
        rows
          .map(
            (r) =>
              '<tr><td class="res-cell-name">' + esc(r[0]) + '</td><td class="res-cell-mono">' + esc(r[1]) + '</td><td>' +
              esc(r[2]) + '</td><td class="res-cell-mono">' + esc(r[3]) + '</td></tr>'
          )
          .join('') +
        '</tbody></table></div>'
      : '<div class="res-empty">还没有映射表。导入一份 TOML，手工指定角色、立绘、背景、CG、音频的序号。</div>';

    mainEl.innerHTML =
      '<div class="res-main__top"><div class="res-title">映射表</div>' +
      '<div class="res-sub"><span>' + (has ? esc(map.name() || 'TOML') : '还没导入') + '</span>' +
      (has
        ? '<span>' + s.total + ' 条</span><span>角色 ' + s.characters + '</span><span>立绘 ' + s.sprites + '</span><span>背景 ' + s.bg + '</span><span>CG ' + s.cg + '</span><span>音频 ' + (s.bgm + s.se) + '</span>'
        : '<span>手写 TOML，把序号接到资源条目上</span>') +
      '</div>' +
      (has && mpath ? '<div class="mapping-path" title="' + esc(mpath) + '">' + esc(shortPath(mpath)) + '</div>' : '') +
      '<div class="res-filters">' +
      (has && mpath ? '<button class="res-chip" type="button" data-mapping-reload>重新载入</button>' : '') +
      '<button class="res-chip" type="button" data-mapping-import>导入 TOML…</button>' +
      (has ? '<button class="res-chip" type="button" data-mapping-clear>移除</button>' : '') +
      '</div></div>' +
      (mappingError ? '<div class="mapping-error">' + esc(mappingError) + '</div>' : '') +
      table;

    const rel = mainEl.querySelector('[data-mapping-reload]');
    if (rel) rel.addEventListener('click', reloadMapping);
    const imp = mainEl.querySelector('[data-mapping-import]');
    if (imp) imp.addEventListener('click', importMapping);
    const clr = mainEl.querySelector('[data-mapping-clear]');
    if (clr) clr.addEventListener('click', clearMapping);
  }

  async function importMapping() {
    mappingError = '';
    if (!window.shell || !window.shell.pickMapping) {
      mappingError = '没有读取映射表的通道';
      state.view = 'mapping';
      render();
      return;
    }
    const res = await window.shell.pickMapping();
    if (res) applyMapping(res);
  }

  async function reloadMapping() {
    mappingError = '';
    const path = window.MAPPING ? window.MAPPING.path() : '';
    if (!path) return;
    if (!window.shell || !window.shell.readMapping) {
      mappingError = '没有读取映射表的通道';
      render();
      return;
    }
    const res = await window.shell.readMapping(path);
    if (!res || res.error) {
      mappingError = (res && res.error) || '读取失败';
      render();
      return;
    }
    applyMapping(res);
  }

  async function loadMappingFile(file) {
    const res = await window.shell.readMapping(file);
    applyMapping(res);
  }

  function applyMapping(res) {
    mappingError = '';
    state.view = 'mapping';
    if (!res || res.error) {
      mappingError = (res && res.error) || '读取失败';
      render();
      return;
    }
    try {
      window.MAPPING.load(res);
    } catch (err) {
      mappingError = String((err && err.message) || err);
      render();
      return;
    }
    if (window.PROJECT) {
      window.PROJECT.markDirty();
      window.PROJECT.mappingChanged();
    }
    render();
  }

  function clearMapping() {
    if (window.MAPPING) window.MAPPING.clear();
    mappingError = '';
    state.view = 'mapping';
    if (window.PROJECT) {
      window.PROJECT.markDirty();
      window.PROJECT.mappingChanged();
    }
    render();
  }

  /* —— 详情 —— */
  function renderDetail() {
    stopAudio();
    if (state.view === 'mapping') {
      detailEl.innerHTML = '';
      return;
    }
    if (state.view === 'bindings') return renderBindingDetail();
    return renderAssetDetail();
  }

  function renderAssetDetail() {
    const a = archive();
    if (!a) {
      detailEl.innerHTML = '';
      return;
    }
    const e = currentEntry();
    const tab = state.tab;
    if (!e) return;
    const g = groups().find((x) => x.items.some((i) => i.name === e.name)) || groups()[0];

    const body =
      tab === 'preview'
        ? assetPreview(a, e)
        : '<div class="res-meta">' +
          meta('归档', a.file, true) + meta('格式', e.magic, true) + meta('压缩大小', kb(e.size), true) +
          meta('解压后', e.rawSize ? kb(e.rawSize) : '—', true) + meta('偏移', hex(e.offset), true) +
          (g ? meta('分组', g.key + '　' + g.count + ' 条') : '') + '</div>';

    detailEl.innerHTML =
      '<div class="res-detail__head"><div class="res-detail__kick"><span class="res-kind">' + esc(a.label) + '</span>' + (g ? '<span class="res-kind">' + esc(g.key) + '</span>' : '') +
      '<span class="res-detail__id">' + esc(a.file) + '</span></div><h2 class="res-detail__title">' + esc(e.name) + '</h2></div>' +
      '<div class="res-tabs">' + [['preview', '预览'], ['overview', '概览']].map(([k, l]) => '<button class="res-tab' + (tab === k ? ' is-on' : '') + '" type="button" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="res-body">' + body + '</div>';

    detailEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderDetail(); }));
    detailEl.querySelectorAll('[data-name-pick]').forEach((b) => b.addEventListener('click', () => { state.entry = b.dataset.namePick; renderDetail(); syncSelection(); }));
    detailEl.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { state.entry = b.dataset.layer; renderDetail(); syncSelection(); }));
    if (window.RES && window.RES.mode() === 'scan') {
      hydrateThumbs(detailEl);
      hydrateAudio(detailEl);
    }
  }

  function assetPreview(a, e) {
    if (a.kind === 'sprite') {
      const base = e.name.replace(/^CHR_/, '');
      const shot =
        a.scanned && e.path
          ? '<div class="asset-frame asset-frame--img"><img class="asset-thumb" data-thumb="' + esc(e.path) + '" data-off="' + e.offset + '" data-size="' + e.size + '" alt=""></div>'
          : '<div class="asset-frame"><span class="asset-frame__tag">hzc1 未解码</span>' +
            '<div class="layer-canvas"><span class="layer-slab layer-slab--body">身体</span><span class="layer-slab layer-slab--face">表情</span></div></div>';
      return (
        shot +
        '<div class="layer-stack">' +
        [['身体层', base], ['表情层', base + '_表情'], ['下半身 L', base + 'L'], ['上半身 U', base + 'U']]
          .map(([label, target]) => {
            const full = 'CHR_' + target;
            const exists = !!findEntries(full).length;
            return '<button class="layer-row' + (e.name === full ? ' is-on' : '') + (exists ? '' : ' is-missing') + '" type="button" data-layer="' + esc(full) + '"' + (exists ? '' : ' disabled') + '>' +
              '<span class="layer-row__dot"></span><span class="layer-row__name">' + label + '</span><span class="layer-row__file">' + esc(target) + '</span></button>';
          }).join('') +
        '</div><p class="note-line">身体与表情是两份文件，L / U 是上下半身分块。</p>'
      );
    }
    if (a.kind === 'voice' || a.kind === 'bgm' || a.kind === 'se') {
      const playable = a.scanned && e.path && window.shell && window.shell.loadAudio;
      const body = playable
        ? '<div class="audio-player" data-audio="' + esc(JSON.stringify({ path: e.path, offset: e.offset, size: e.size, magic: e.magic })) + '">' +
          '<button class="audio-player__btn" type="button" aria-label="播放">' + icon('play', 'icon icon--14') + '</button>' +
          '<div class="audio-player__track"><span class="audio-player__fill"></span></div>' +
          '<span class="audio-player__time">--:--</span></div>'
        : '<div class="asset-frame asset-frame--audio"><span class="asset-frame__tag">' + esc(e.magic) + '</span><p class="note-line">扫描游戏目录后才能播放</p></div>';
      return body + '<div class="res-meta">' + meta('大小', kb(e.size), true) + meta('偏移', hex(e.offset), true) + '</div>';
    }
    const shot =
      a.scanned && e.path
        ? '<div class="asset-frame asset-frame--img"><img class="asset-thumb" data-thumb="' + esc(e.path) + '" data-off="' + e.offset + '" data-size="' + e.size + '" alt=""></div>'
        : '<div class="asset-frame"><span class="asset-frame__tag">hzc1 未解码</span>' + icon('image', 'icon') + '</div>';
    return shot;
  }

  /* 扫描模式下预览图按需解码，解完替换占位 */
  function hydrateThumbs(root) {
    root.querySelectorAll('img[data-thumb]').forEach(async (img) => {
      const entry = { path: img.dataset.thumb, offset: Number(img.dataset.off), size: Number(img.dataset.size) };
      const url = await window.RES.thumb(entry, 260);
      if (url) img.src = url;
      else {
        const note = document.createElement('span');
        note.className = 'asset-unsupported';
        note.textContent = '这种格式还没解';
        img.replaceWith(note);
      }
    });
  }

  /* 音频：按范围取出，做成 Blob 播放 */
  let audio = null;

  function stopAudio() {
    if (!audio) return;
    try {
      audio.el.pause();
    } catch (_) {
      /* ignore */
    }
    URL.revokeObjectURL(audio.url);
    audio = null;
  }

  async function hydrateAudio(root) {
    const card = root.querySelector('[data-audio]');
    if (!card || !window.RES || window.RES.mode() !== 'scan' || !window.shell.loadAudio) return;
    const info = JSON.parse(card.dataset.audio);
    const res = await window.shell.loadAudio({ file: info.path, off: info.offset, size: info.size });
    if (!res || !res.bytes || !card.isConnected) return;
    const mime = res.magic === 'RIFF' ? 'audio/wav' : 'audio/ogg';
    const url = URL.createObjectURL(new Blob([res.bytes], { type: mime }));
    const el = new Audio(url);
    const btn = card.querySelector('.audio-player__btn');
    const fill = card.querySelector('.audio-player__fill');
    const time = card.querySelector('.audio-player__time');
    const fmt = (t) => {
      if (!Number.isFinite(t)) return '--:--';
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      return m + ':' + String(s).padStart(2, '0');
    };
    const setTime = () => {
      time.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration);
    };
    el.addEventListener('loadedmetadata', setTime);
    el.addEventListener('timeupdate', () => {
      if (el.duration) fill.style.width = (el.currentTime / el.duration) * 100 + '%';
      setTime();
    });
    el.addEventListener('ended', () => {
      btn.innerHTML = icon('play', 'icon icon--14');
      fill.style.width = '0%';
      setTime();
    });
    btn.addEventListener('click', () => {
      if (el.paused) {
        el.play();
        btn.innerHTML = icon('pause', 'icon icon--14');
      } else {
        el.pause();
        btn.innerHTML = icon('play', 'icon icon--14');
      }
    });
    audio = { el, url };
  }

  function meta(k, v, mono) {
    return '<div class="res-meta__row"><span class="res-meta__k">' + esc(k) + '</span><span class="res-meta__v' + (mono ? ' is-mono' : '') + '">' + esc(v) + '</span></div>';
  }

  function renderBindingDetail() {
    const b = BINDINGS.find((x) => x.id === state.binding) || BINDINGS[0];
    if (!b) {
      detailEl.innerHTML = '';
      return;
    }
    state.binding = b.id;
    const r = resolveBinding(b);
    const call = parseCall(b.call);
    const kind = call ? kindOfCall(call.cmd) : '—';
    const tab = state.tab === 'preview' ? 'overview' : state.tab;
    const hit = r.status === 'resolved' ? r.entries[0] : null;

    const body =
      tab === 'chain'
        ? chain(b, r)
        : '<div class="res-meta">' +
          meta('名称', b.name, true) + meta('类型', kind) + meta('调用', b.call, true) +
          meta('文件', hit ? hit.archive.file + '  ' + hit.entry.name : '—', true) +
          meta('偏移', hit ? hex(hit.entry.offset) : '—', true) +
          (b.note ? meta('备注', b.note) : '') +
          meta('状态', statusText(r.status) + (r.reason ? '　' + r.reason : '')) + '</div>';

    detailEl.innerHTML =
      '<div class="res-detail__head"><div class="res-detail__kick"><span class="res-kind">绑定</span>' +
      '<span class="res-status res-status--' + r.status + '"><span class="res-status__dot"></span>' + statusText(r.status) + '</span></div>' +
      '<h2 class="res-detail__title">' + esc(b.name) + '</h2></div>' +
      '<div class="res-tabs">' + [['overview', '概览'], ['chain', '链']].map(([k, l]) => '<button class="res-tab' + (tab === k ? ' is-on' : '') + '" type="button" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="res-body">' + body + '</div>';

    detailEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => { state.tab = btn.dataset.tab; renderDetail(); }));
  }

  function chain(b, r) {
    const call = parseCall(b.call);
    const kind = call ? kindOfCall(call.cmd) : '—';
    const frames = [
      { kind: '绑定', value: b.name, meta: b.note || '项目里的名字' },
      { kind: '类型', value: kind, meta: '由调用决定' },
      { kind: '调用', value: b.call, meta: 'DSL 原语' },
    ];
    if (r.status === 'resolved' && r.entries[0]) {
      frames.push({ kind: '条目', value: r.entries[0].entry.name, meta: r.entries[0].archive.file });
      frames.push({ kind: '位置', value: hex(r.entries[0].entry.offset), meta: kb(r.entries[0].entry.size) });
    } else {
      frames.push({ kind: '条目', value: '未命中', meta: r.reason || '没有找到对应文件', state: r.status === 'unknown' ? 'warn' : 'bad' });
    }
    return '<div class="chain">' + frames.map((f, i) =>
      '<div class="chain__frame" data-state="' + (f.state || 'ok') + '"><span class="chain__no">' + (i + 1) + '</span><div class="chain__content">' +
      '<div class="chain__line"><span class="chain__kind">' + esc(f.kind) + '</span><code class="chain__value">' + esc(f.value) + '</code></div>' +
      '<div class="chain__meta">' + esc(f.meta) + '</div></div></div>').join('') + '</div>';
  }

  function render() {
    renderNav();
    if (state.view === 'assets') renderAssets();
    else if (state.view === 'bindings') renderBindings();
    else renderMapping();
    renderDetail();
  }

  function bindEvents() {
    navEl.addEventListener('click', async (e) => {
      const scanBtn = e.target.closest('[data-scan]');
      if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.querySelector('span').textContent = '扫描中…';
        const res = await window.RES.pickAndScan();
        if (!res) {
          render();
          return;
        }
        if (res.error) {
          scanBtn.disabled = false;
          scanBtn.querySelector('span').textContent = '扫描失败';
          scanBtn.title = res.error;
          return;
        }
        state.archive = 0;
        state.group = '*';
        state.entry = null;
        state.page = 0;
        state.tab = 'preview';
        render();
        return;
      }
      const view = e.target.closest('[data-view]');
      if (view) {
        state.view = view.dataset.view;
        state.tab = state.view === 'assets' ? 'preview' : 'overview';
        render();
        return;
      }
      const btn = e.target.closest('[data-archive]');
      if (btn) {
        state.archive = Number(btn.dataset.archive);
        state.view = 'assets';
        state.group = '*';
        state.entry = null;
        state.page = 0;
        state.tab = 'preview';
        render();
      }
    });
  }

  /* 扫描结果变化时整块重画；两边工作区共用 window.RES */
  if (window.RES) {
    window.RES.on(() => {
      rebuildIndex();
      state.archive = 0;
      state.group = '*';
      state.entry = null;
      state.page = 0;
      render();
    });
  }

  function setWorkspace(mode) {
    document.getElementById('workspace-write').hidden = mode !== 'write';
    document.getElementById('workspace-resource').hidden = mode !== 'resource';
    document.querySelectorAll('.workspace-switch__btn').forEach((b) => {
      const on = b.dataset.workspace === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // 切过来时按当前项目重算绑定，写作区的 bgload/chaload 改动才看得到
    if (mode === 'resource') render();
  }

  function boot() {
    document.querySelectorAll('.workspace-switch__btn').forEach((b) => b.addEventListener('click', () => setWorkspace(b.dataset.workspace)));
    bindEvents();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
