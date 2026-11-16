/* ==========================================================================
   hcb-ir-editor · 菜单栏 / 快捷键
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 菜单栏
   * ------------------------------------------------------------------ */

  const MENUS = [
    {
      id: 'file',
      label: '文件',
      items: [
        { label: '新建项目', shortcut: 'Ctrl N', action: () => newProject() },
        { label: '打开项目…', shortcut: 'Ctrl O', action: () => openProject() },
        { label: '保存', shortcut: 'Ctrl S', action: () => saveProject(false) },
        { label: '另存为…', shortcut: 'Ctrl Shift S', action: () => saveProject(true) },
        { sep: true },
        { label: '导入 DSL…', shortcut: 'Ctrl I', action: () => openDslDialog() },
        { sep: true },
        { label: '导出 DSL…', shortcut: 'Ctrl E', action: () => exportDsl() },
        { label: '导入旧工程…', note: '未接入', disabled: true },
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      items: [
        { label: '撤销', shortcut: 'Ctrl Z', disabled: () => !window.HISTORY || !window.HISTORY.canUndo(), action: () => window.HISTORY && window.HISTORY.undo() },
        { label: '重做', shortcut: 'Ctrl Shift Z', disabled: () => !window.HISTORY || !window.HISTORY.canRedo(), action: () => window.HISTORY && window.HISTORY.redo() },
        { sep: true },
        { label: '剪切', shortcut: 'Ctrl X', disabled: true },
        { label: '复制', shortcut: 'Ctrl C', disabled: true },
        { label: '粘贴', shortcut: 'Ctrl V', disabled: true },
        { label: '全选', shortcut: 'Ctrl A', action: () => selectAllBlocks() },
      ],
    },
    {
      id: 'view',
      label: '视图',
      items: [
        {
          label: '显示章节栏',
          checked: () => !document.body.classList.contains('hide-left'),
          action: () => document.body.classList.toggle('hide-left'),
        },
        {
          label: '显示参数栏',
          checked: () => !document.body.classList.contains('hide-right'),
          action: () => document.body.classList.toggle('hide-right'),
        },
        { sep: true },
        {
          label: '专注模式',
          shortcut: 'Ctrl \\',
          checked: () => document.body.classList.contains('focus-mode'),
          action: () => document.body.classList.toggle('focus-mode'),
        },
      ],
    },
    {
      id: 'settings',
      label: '设置',
      items: [
        { label: '偏好设置…', shortcut: 'Ctrl ,' },
        { label: '键盘快捷键', shortcut: 'Ctrl K' },
        { sep: true },
        { label: '关于 hcb-ir-editor', note: 'v0.1.0' },
      ],
    },
  ];

  let menubarOpen = null;
  let menubarDrop = null;

  function buildMenubar() {
    const bar = document.getElementById('menubar');
    if (!bar) return;
    MENUS.forEach((menu) => {
      const btn = el('button', 'menu-btn', esc(menu.label));
      btn.type = 'button';
      btn.dataset.menu = menu.id;
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menubarOpen && menubarOpen.id === menu.id) closeMenubar();
        else openMenubar(menu, btn);
      });
      btn.addEventListener('mouseenter', () => {
        if (menubarOpen && menubarOpen.id !== menu.id) openMenubar(menu, btn);
      });
      bar.appendChild(btn);
    });
  }

  function openMenubar(menu, btn) {
    closeMenubar();
    const drop = el('div', 'menubar__drop');
    drop.setAttribute('role', 'menu');

    menu.items.forEach((item) => {
      if (item.sep) {
        drop.appendChild(el('div', 'menu__sep'));
        return;
      }
      const isChecked = item.checked ? item.checked() : false;
      const b = el('button', 'menu-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      b.disabled = typeof item.disabled === 'function' ? item.disabled() : !!item.disabled;
      b.innerHTML =
        '<span class="menu-item__check">' + (isChecked ? icon('check', 'icon icon--12') : '') + '</span>' +
        '<span class="menu-item__label">' + esc(item.label) + '</span>' +
        (item.shortcut ? '<span class="menu-item__shortcut">' + esc(item.shortcut) + '</span>' : '') +
        (item.note ? '<span class="menu-item__note">' + esc(item.note) + '</span>' : '');
      b.addEventListener('click', () => {
        closeMenubar();
        if (item.action) item.action();
      });
      drop.appendChild(b);
    });

    document.body.appendChild(drop);

    const r = btn.getBoundingClientRect();
    const w = drop.offsetWidth;
    drop.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
    drop.style.top = Math.round(r.bottom + 6) + 'px';

    requestAnimationFrame(() => drop.classList.add('is-open'));
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');

    const onDoc = (e) => {
      if (!drop.contains(e.target) && !btn.contains(e.target)) closeMenubar();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenubar();
        btn.focus();
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);

    menubarOpen = { id: menu.id, btn, onDoc, onKey };
    menubarDrop = drop;
  }

  function closeMenubar() {
    if (!menubarOpen) return;
    const cur = menubarOpen;
    menubarOpen = null;
    document.removeEventListener('mousedown', cur.onDoc, true);
    document.removeEventListener('keydown', cur.onKey, true);
    cur.btn.classList.remove('is-open');
    cur.btn.setAttribute('aria-expanded', 'false');
    if (menubarDrop) {
      const drop = menubarDrop;
      menubarDrop = null;
      drop.classList.remove('is-open');
      setTimeout(() => drop.remove(), 130);
    }
  }

  /* ------------------------------------------------------------------ *
   * 键盘
   * ------------------------------------------------------------------ */

  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        saveProject(e.shiftKey);
        return;
      }
      if (k === 'o') {
        e.preventDefault();
        openProject();
        return;
      }
      if (k === 'n') {
        e.preventDefault();
        newProject();
        return;
      }
      if (k === 'i') {
        e.preventDefault();
        openDslDialog();
        return;
      }
      if (k === 'e') {
        e.preventDefault();
        exportDsl();
        return;
      }
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) window.HISTORY && window.HISTORY.redo();
        else window.HISTORY && window.HISTORY.undo();
        return;
      }
      if (k === 'y') {
        e.preventDefault();
        window.HISTORY && window.HISTORY.redo();
        return;
      }
      if (k === 'a' && !typing) {
        e.preventDefault();
        selectAllBlocks();
        return;
      }
    }

    if (e.key === 'Escape' && !typing) {
      if (closeSelectIfOpen() || closeMenuIfOpen()) return;
      clearSelection();
      return;
    }
    if (typing) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    const ch = currentChapter();
    if (!ch) return;
    const all = [];
    (ch.scenes || []).forEach((sc) => flatten(sc.blocks).forEach((b) => all.push(b)));
    if (!all.length) return;
    e.preventDefault();
    const i = all.findIndex((b) => b.id === state.blockId);
    const next = e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
    selectBlock(all[next === -1 ? 0 : next].id);
  }

  function closeSelectIfOpen() {
    if (!openSelect) return false;
    closeSelect();
    return true;
  }

  function closeMenuIfOpen() {
    if (!openMenu) return false;
    closeMenu();
    return true;
  }

