/* ==========================================================================
   hcb-ir-editor · 插入面板 / 默认参数
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 插入面板
   * ------------------------------------------------------------------ */

  let palette = null;

  function closePalette() {
    if (!palette) return;
    const cur = palette;
    palette = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onPaletteKey, true);
    cur.classList.remove('is-open');
    setTimeout(() => cur.remove(), 120);
  }

  function onDocDown(e) {
    if (palette && !palette.contains(e.target)) closePalette();
  }

  function onPaletteKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePalette();
    }
  }

  function openPalette(anchor, sc, list, index) {
    closePalette();
    const pop = el('div', 'popover palette');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '插入原语');

    const search = el('div', 'palette__search');
    search.innerHTML = icon('search', 'icon icon--14');
    const input = el('input', 'palette__input');
    input.type = 'search';
    input.placeholder = '插入原语';
    input.setAttribute('aria-label', '搜索原语');
    search.appendChild(input);
    pop.appendChild(search);

    const body = el('div', 'palette__body');
    pop.appendChild(body);

    const pick = (key) => {
      const block = makeBlock(key, { sc, list, index });
      list.splice(typeof index === 'number' ? index : list.length, 0, block);
      touch();
      closePalette();
      state.blockId = block.id;
      renderMain();
      renderInspector();
      renderChapters();
      const fresh = document.querySelector('[data-block-id="' + block.id + '"]');
      if (fresh) fresh.scrollIntoView({ block: 'center' });
    };

    const rows = [];
    GROUP_ORDER.forEach((g) => {
      const keys = Object.keys(TYPES).filter((k) => TYPES[k].group === g && !TYPES[k].hidden);
      if (!keys.length) return;
      const head = el('div', 'palette__group', esc(GROUPS[g].label));
      body.appendChild(head);
      keys.forEach((key) => {
        const def = TYPES[key];
        const item = el('button', 'palette-item');
        item.type = 'button';
        item.dataset.type = key;
        item.dataset.group = g;
        item.innerHTML =
          '<span class="palette-item__swatch">' + icon(def.icon, 'icon icon--12') + '</span>' +
          '<span class="palette-item__name">' + esc(key) + '</span>' +
          '<span class="palette-item__desc">' + esc(def.label) + '</span>';
        item.addEventListener('click', () => pick(key));
        body.appendChild(item);
        rows.push({ item, head, hay: (key + ' ' + def.label + ' ' + GROUPS[g].label).toLowerCase() });
      });
    });

    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((r) => {
        const hit = !q || r.hay.indexOf(q) >= 0;
        r.item.hidden = !hit;
        if (hit) shown++;
      });
      // 组标题只在组内有可见项时保留
      Array.prototype.forEach.call(body.children, (n) => {
        if (!n.classList.contains('palette__group')) return;
        let next = n.nextElementSibling;
        let any = false;
        while (next && !next.classList.contains('palette__group')) {
          if (!next.hidden) any = true;
          next = next.nextElementSibling;
        }
        n.hidden = !any;
      });
      body.dataset.count = String(shown);
    };
    input.addEventListener('input', filter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = rows.find((r) => !r.item.hidden);
        if (first) first.item.click();
      }
    });

    document.body.appendChild(pop);

    const r = anchor.getBoundingClientRect();
    const w = 260;
    pop.style.width = w + 'px';
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const above = spaceBelow < 280 && spaceAbove > spaceBelow;
    pop.style.maxHeight = Math.max(200, Math.min(440, above ? spaceAbove : spaceBelow)) + 'px';
    pop.style.left = Math.round(Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 12))) + 'px';
    pop.style.top =
      Math.round(above ? Math.max(8, r.top - pop.offsetHeight - 6) : Math.min(r.bottom + 6, window.innerHeight - 60)) + 'px';
    palette = pop;

    requestAnimationFrame(() => {
      pop.classList.add('is-open');
      input.focus();
    });

    setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onPaletteKey, true);
    }, 0);
  }

  /* 新块的默认参数，键与 DSL 入参一致 */
  const DEFAULTS = {
    start: {},
    end: {},
    label: { name: '' },
    jump: { target: '' },
    sel: { prompt: '', options: [{ text: '', target: '' }] },
    ssel: {},
    achieve: { no: '' },
    chaload: { name: '', aliases: '' },
    cha: { name: '', show: '', voice: '' },
    dia: { text: '', size: '' },
    msg: { mode: 'normal' },
    bg: { id: '', diff: '' },
    bgload: { id: '', file: '', name: '' },
    cgload: { name: '' },
    cg: { name: '', keep: false, x: 0, y: 0, zoom: 2000, time: 900 },
    white: {},
    black: {},
    eyecatch: { no: '' },
    movie: {},
    effect: { no: 0, time: 1000 },
    bs: { cha: 1, pose: 1, cloth: 1, face: 1, l: -1, pos: 'm', z: 1000, x: 0, y: 0, lyr: 1 },
    bsfade: {},
    bs_fade: { cha: 1, mode: 1 },
    bs_move: { cha: 1, dx: 0, dy: 0, z: '', time: 1000 },
    bs_color: { cha: 1, r: 255, g: 255, b: 255 },
    bs_ani: { cha: 1, no: 0 },
    bgm: { no: '' },
    bgmstop: { time: '' },
    se: { no: '', mode: '', vol: '', time: '' },
    wait: { time: 800 },
    shake: { num: 2, mode: 0, width: 40 },
    motion: { x: 0, y: 0, z: 0, time: 1000 },
    v3d: { x: 0, y: 0, z: 0, time: '' },
    snow: { no: '' },
    fog: {},
    endback: { no: 1 },
    global_set: { no: 1, value: 1 },
    global_eq: { no: 1, value: 1, target: '' },
    note: { text: '' },
    custom: { line: '' },
  };

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data || {}));
  }

  function listOwner(blocks, list) {
    for (const b of blocks || []) {
      if (b.children === list) return b;
      if (b.children) {
        const hit = listOwner(b.children, list);
        if (hit) return hit;
      }
    }
    return null;
  }

  function allProjectBlocks() {
    const out = [];
    (CHAPTERS || []).forEach((ch) => (ch.scenes || []).forEach((sc) => flatten(sc.blocks, out)));
    return out;
  }

  function blocksBeforeScene(sc) {
    const out = [];
    for (const ch of CHAPTERS || []) {
      for (const s of ch.scenes || []) {
        if (s === sc) return out;
        flatten(s.blocks, out);
      }
    }
    return out;
  }

  /* 插入点之前最近的一个同类型块。 */
  function previousSameBlock(type, sc, list, index) {
    const at = typeof index === 'number' ? Math.max(0, Math.min(index, list.length)) : list.length;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (list[i].type === type) return list[i];
    }

    const owner = listOwner(sc.blocks, list);
    const boundary = list[0] || owner;
    if (boundary) {
      const all = allProjectBlocks();
      const pos = all.indexOf(boundary);
      if (pos >= 0) {
        // 列表为空时插入点在 owner 之后，owner 本身也算前一个；否则从列表首块之前找。
        const start = list.length ? pos - 1 : pos;
        for (let i = start; i >= 0; i -= 1) {
          if (all[i].type === type) return all[i];
        }
      }
      return null;
    }

    // 空场景：从这份场景之前的块里找。
    const before = blocksBeforeScene(sc);
    for (let i = before.length - 1; i >= 0; i -= 1) {
      if (before[i].type === type) return before[i];
    }
    return null;
  }

  function makeBlock(type, ctx) {
    const source = ctx && ctx.sc && ctx.list ? previousSameBlock(type, ctx.sc, ctx.list, ctx.index) : null;
    return {
      id: nid(),
      type,
      data: source ? cloneData(source.data) : cloneData(DEFAULTS[type]),
    };
  }

