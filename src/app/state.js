/* ==========================================================================
   hcb-ir-editor · 全局状态 / 下拉与菜单
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */

  const state = {
    chapterId: null,
    blockId: null,
    filter: '',
    renaming: null,
    renamingScene: null,
    collapsedScenes: {},
  };

  const currentChapter = () => CHAPTERS.find((c) => c.id === state.chapterId) || CHAPTERS[0] || null;

  function currentBlock() {
    if (!state.blockId) return null;
    const hit = listOfBlock(state.blockId);
    if (!hit) return null;
    return { block: hit.list.find((b) => b.id === state.blockId), scene: hit.scene };
  }

  function selectBlock(id) {
    state.blockId = id;
    renderMain();
    renderInspector();
    renderChapters();
    const node = document.querySelector('.block.is-selected');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ *
   * 浮层：下拉菜单与右键菜单
   * ------------------------------------------------------------------ */

  let openSelect = null;

  function closeSelect(instant) {
    if (!openSelect) return;
    const cur = openSelect;
    openSelect = null;
    document.removeEventListener('mousedown', cur.onDoc, true);
    document.removeEventListener('keydown', cur.onKey, true);
    window.removeEventListener('scroll', cur.onScroll, true);
    cur.trigger.setAttribute('aria-expanded', 'false');
    cur.trigger.classList.remove('is-open');
    cur.menu.classList.remove('is-open');
    setTimeout(() => cur.menu.remove(), instant ? 0 : 140);
  }

  function makeSelect(options, value, onChange, opts) {
    opts = opts || {};
    const wrap = el('div', 'select');
    const trigger = el('button', 'select-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    let current = value == null ? '' : String(value);

    const same = (o) => String(o.value) === current;
    const has = (v) => options.some((o) => String(o.value) === String(v));
    const paint = () => {
      const hit = options.find(same);
      trigger.innerHTML =
        '<span class="select-trigger__lead">' +
        (hit && hit.swatch ? '<i class="swatch" style="background:' + hit.swatch + '"></i>' : '') +
        '<span class="select-trigger__label">' + esc(hit ? hit.label : opts.placeholder || '—') + '</span>' +
        '</span>' +
        icon('chevron-down', 'icon icon--14 select-trigger__chev');
      trigger.classList.toggle('is-placeholder', !hit);
    };
    paint();

    const setActive = (items, i) => {
      items.forEach((n, j) => n.classList.toggle('is-active', j === i));
      if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    };

    const open = () => {
      if (openSelect && openSelect.trigger === trigger) {
        closeSelect();
        return;
      }
      closeSelect();
      const menu = el('div', 'select-menu');
      menu.setAttribute('role', 'listbox');
      const items = [];
      let active = Math.max(0, options.findIndex(same));

      options.forEach((o) => {
        const item = el('button', 'select-option');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', same(o) ? 'true' : 'false');
        item.innerHTML =
          '<span class="select-option__lead">' +
          (o.swatch ? '<i class="swatch" style="background:' + o.swatch + '"></i>' : '') +
          '<span class="select-option__label">' + esc(o.label) + '</span>' +
          '</span>' +
          (same(o) ? icon('check', 'icon icon--14') : '');
        item.addEventListener('click', () => {
          current = o.value;
          paint();
          onChange(o.value);
          closeSelect();
          trigger.focus();
        });
        items.push(item);
        menu.appendChild(item);
      });

      document.body.appendChild(menu);

      const r = trigger.getBoundingClientRect();
      const w = Math.max(Math.ceil(r.width), 168);
      menu.style.width = w + 'px';
      const h = menu.offsetHeight;
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
      menu.style.left = Math.round(Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      menu.style.top = Math.round(top) + 'px';

      requestAnimationFrame(() => menu.classList.add('is-open'));
      trigger.setAttribute('aria-expanded', 'true');
      trigger.classList.add('is-open');
      setActive(items, active);

      const onDoc = (e) => {
        if (!menu.contains(e.target) && !trigger.contains(e.target)) closeSelect();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeSelect();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          active = Math.min(items.length - 1, active + 1);
          setActive(items, active);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          active = Math.max(0, active - 1);
          setActive(items, active);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          items[active].click();
        } else if (e.key === 'Tab') {
          closeSelect();
        }
      };
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
      menu.addEventListener('mousedown', (e) => e.stopPropagation());

      // 菜单自己滚动时不要关掉自己
      const onScroll = (e) => {
        if (menu.contains(e.target)) return;
        closeSelect();
      };
      window.addEventListener('scroll', onScroll, true);

      openSelect = { menu, trigger, onDoc, onKey, onScroll };
    };

    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    wrap.appendChild(trigger);
    wrap._has = has;
    return wrap;
  }

  let openMenu = null;

  function closeMenu() {
    if (!openMenu) return;
    const cur = openMenu;
    openMenu = null;
    document.removeEventListener('mousedown', cur.onDoc, true);
    document.removeEventListener('keydown', cur.onKey, true);
    window.removeEventListener('scroll', cur.onScroll, true);
    cur.pop.classList.remove('is-open');
    setTimeout(() => cur.pop.remove(), 140);
  }

  function showMenu(x, y, items) {
    closeMenu();
    const pop = el('div', 'menu');
    pop.setAttribute('role', 'menu');
    items.forEach((it) => {
      if (it.sep) {
        pop.appendChild(el('div', 'menu__sep'));
        return;
      }
      const btn = el('button', 'menu__item' + (it.danger ? ' is-danger' : ''));
      btn.type = 'button';
      btn.disabled = !!it.disabled;
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = (it.icon ? icon(it.icon, 'icon icon--14') : '<span class="menu__gap"></span>') + '<span>' + esc(it.label) + '</span>';
      btn.addEventListener('click', () => {
        closeMenu();
        it.action();
      });
      pop.appendChild(btn);
    });

    document.body.appendChild(pop);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = Math.round(Math.min(x, window.innerWidth - w - 8)) + 'px';
    pop.style.top = Math.round(Math.min(y, window.innerHeight - h - 8)) + 'px';
    requestAnimationFrame(() => pop.classList.add('is-open'));

    const onDoc = (e) => {
      if (!pop.contains(e.target)) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    pop.addEventListener('mousedown', (e) => e.stopPropagation());

    const onScroll = () => closeMenu();
    window.addEventListener('scroll', onScroll, true);

    openMenu = { pop, onDoc, onKey, onScroll };
    const first = pop.querySelector('.menu__item:not(:disabled)');
    if (first) first.focus();
  }

