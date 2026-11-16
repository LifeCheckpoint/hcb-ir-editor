/* ==========================================================================
   hcb-ir-editor · 主栏 / 场景 / 拖拽
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 主栏
   * ------------------------------------------------------------------ */

  const mainEl = document.getElementById('main');

  function renderMain() {
    normalizeSelection();
    if (window.HISTORY) window.HISTORY.syncSelection();
    const ch = currentChapter();
    mainEl.innerHTML = '';

    if (!ch) {
      renderStart();
      return;
    }

    const doc = el('div', 'doc');
    doc.appendChild(
      el(
        'div',
        'crumbs',
        '<span>' + esc(ch.route) + '</span><span class="crumbs__sep">/</span><span class="crumbs__current">' + esc(ch.title) + '</span>'
      )
    );
    doc.appendChild(el('h1', 'doc-title', esc(ch.title)));

    const count = countBlocks(ch);
    doc.appendChild(
      el(
        'div',
        'doc-meta',
        '<span>' + count + ' 块</span>' +
          '<span>' + charCount(ch) + ' 字</span>'
      )
    );

    doc.appendChild(el('div', 'doc-divider'));
    (ch.scenes || []).forEach((sc) => doc.appendChild(renderScene(sc)));
    mainEl.appendChild(doc);
  }

  /* 还没有章节时的起始页：入口只有文件与导入 */
  function renderStart() {
    if (mainEl) mainEl.scrollTop = 0;
    const box = el('div', 'start');
    box.appendChild(el('h1', 'start__title', 'hcb-ir-editor'));
    box.appendChild(
      el('p', 'start__text', CHAPTERS.length || projectPath ? '这个项目还没有章节。' : '打开一个项目，或导入一份 DSL 脚本。')
    );

    const actions = el('div', 'start__actions');
    const btn = (label, cls, action) => {
      const b = el('button', cls, esc(label));
      b.type = 'button';
      b.addEventListener('click', action);
      actions.appendChild(b);
    };

    if (CHAPTERS.length || projectPath) {
      btn('新建章节', 'btn-primary', addChapter);
      btn('导入 DSL…', 'btn-ghost', () => openDslDialog());
      btn('打开项目…', 'btn-ghost', openProject);
    } else {
      btn('打开项目…', 'btn-primary', openProject);
      btn('新建项目', 'btn-ghost', newProject);
      btn('导入 DSL…', 'btn-ghost', () => openDslDialog());
    }
    box.appendChild(actions);
    mainEl.appendChild(box);
  }

  function renderScene(sc) {
    const collapsed = !!state.collapsedScenes[sc.id];
    const group = el('section', 'scene-group' + (collapsed ? ' is-collapsed' : ''));

    const head = el('div', 'scene-group__head');
    const toggle = el('button', 'scene-group__toggle', icon(collapsed ? 'chevron-right' : 'chevron-down', 'icon icon--14'));
    toggle.type = 'button';
    toggle.title = collapsed ? '展开场景' : '折叠场景';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', (collapsed ? '展开场景 ' : '折叠场景 ') + sc.title);
    head.appendChild(toggle);
    head.appendChild(el('span', 'scene-group__no', esc(sc.no)));
    head.appendChild(el('span', 'scene-group__title', esc(sc.title)));
    head.appendChild(el('span', 'scene-group__where', esc(sc.where)));
    if (collapsed) head.appendChild(el('span', 'scene-group__summary', flatten(sc.blocks).length + ' 块'));
    group.appendChild(head);

    const body = el('div', 'scene-group__body');
    body.hidden = collapsed;

    const stack = el('div', 'stack');
    stack.setAttribute('role', 'group');
    stack.setAttribute('aria-label', sc.title);
    blockListNodes(sc.blocks, sc).forEach((node) => stack.appendChild(node));
    body.appendChild(stack);

    const add = el('button', 'add-row', icon('plus', 'icon icon--12') + '<span>添加功能块</span>');
    add.type = 'button';
    add.addEventListener('click', (e) => openPalette(e.currentTarget, sc, sc.blocks, sc.blocks.length));
    body.appendChild(add);

    group.appendChild(body);

    toggle.addEventListener('click', () => toggleScene(sc, group, body, toggle, head));

    return group;
  }

  /* 折叠用高度过渡，不用重建整篇文档，避免内容突变 */
  let sceneAnimSeq = 0;

  function toggleScene(sc, group, body, toggle, head) {
    if (body.dataset.animating) return;

    const collapsed = !state.collapsedScenes[sc.id];
    state.collapsedScenes[sc.id] = collapsed;
    touchUI();

    const summary = head.querySelector('.scene-group__summary');
    if (collapsed && !summary) head.appendChild(el('span', 'scene-group__summary', flatten(sc.blocks).length + ' 块'));
    if (!collapsed && summary) summary.remove();

    group.classList.toggle('is-collapsed', collapsed);
    toggle.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down', 'icon icon--14');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? '展开场景' : '折叠场景';

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      body.hidden = collapsed;
      return;
    }

    // 用令牌防止上一轮的兜底定时器打断新一轮动画
    const token = 'a' + ++sceneAnimSeq;
    body.dataset.animating = token;
    const finish = () => {
      if (body.dataset.animating !== token) return;
      body.dataset.animating = '';
      body.style.height = '';
      if (collapsed) body.hidden = true;
    };
    body.addEventListener(
      'transitionend',
      (e) => {
        if (e.propertyName === 'height') finish();
      },
      { once: true }
    );
    setTimeout(finish, 400);

    if (collapsed) {
      body.style.height = body.scrollHeight + 'px';
      body.offsetHeight;
      body.style.height = '0px';
    } else {
      body.hidden = false;
      body.style.height = '0px';
      body.offsetHeight;
      body.style.height = body.scrollHeight + 'px';
    }
  }

  /* 聚焦模式：同类型的块正常显示，连续的非聚焦块合成一条灰条。 */
  function blockListNodes(list, sc) {
    if (!isFocusActive()) return list.map((b) => blockNode(b, sc, list));
    const out = [];
    let i = 0;
    while (i < list.length) {
      if (isFocusType(list[i].type)) {
        out.push(blockNode(list[i], sc, list));
        i += 1;
        continue;
      }
      let j = i;
      while (j < list.length && !isFocusType(list[j].type)) j += 1;
      out.push(focusGapNode(list.slice(i, j), list));
      i = j;
    }
    return out;
  }

  function focusGapNode(run, list) {
    const gap = el('div', 'focus-gap');
    gap.dataset.focusGap = 'true';
    gap.dataset.count = String(run.length);
    gap.setAttribute('title', run.length + ' 个块已收起');
    gap.appendChild(el('span', 'focus-gap__count', run.length + ' 个块'));
    gap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    gap.addEventListener('dragover', (e) => {
      if (!drag || drag.list !== list) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = gap.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearDropMarks();
      dropTarget = null;
      gap.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      dropGap = { run, list, after };
    });
    gap.addEventListener('dragleave', (e) => {
      if (!gap.contains(e.relatedTarget)) gap.classList.remove('is-drop-before', 'is-drop-after');
    });
    gap.addEventListener('drop', (e) => {
      if (!drag || !dropGap || drag.list !== list) return;
      e.preventDefault();
      const from = list.indexOf(drag.block);
      if (from < 0) return endDrag();
      const anchor = dropGap.after ? run[run.length - 1] : run[0];
      list.splice(from, 1);
      let at = list.indexOf(anchor);
      if (at < 0) return endDrag();
      if (dropGap.after) at += 1;
      list.splice(at, 0, drag.block);
      state.blockId = drag.block.id;
      state.selectedIds = [drag.block.id];
      state.anchorId = drag.block.id;
      touch();
      endDrag();
      renderMain();
      renderInspector();
      renderChapters();
    });
    return gap;
  }

  function blockNode(block, sc, list) {
    const v = viewOf(block);
    const def = v.def;

    const node = el('div', 'block' + (v.empty ? ' is-empty' : ''));
    node.dataset.type = block.type;
    node.dataset.blockId = block.id;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', isBlockSelected(block.id) ? 'true' : 'false');
    node.tabIndex = 0;
    if (isBlockSelected(block.id)) node.classList.add('is-selected');
    node.draggable = false;

    const codeLine = v.code && !def.hideCode ? v.code[0] + (v.code.length > 1 ? '  +' + (v.code.length - 1) : '') : '';
    node.innerHTML =
      '<span class="block__handle" draggable="true" title="拖动排序" aria-hidden="true">' + icon('grip-vertical', 'icon icon--12') + '</span>' +
      '<span class="block__glyph">' + icon(def.icon) + '</span>' +
      '<span class="block__body">' +
      '<span class="block__head">' +
      '<span class="block__kind">' + esc(block.type) + '</span>' +
      '<span class="block__name">' + esc(def.label) + '</span>' +
      (v.speaker ? '<span class="block__speaker">' + esc(v.speaker) + '</span>' : '') +
      (v.warn ? '<span class="block__warn" title="参数不完整"></span>' : '') +
      (v.meta ? '<span class="block__meta">' + esc(v.meta) + '</span>' : '') +
      '</span>' +
      '<span class="block__line">' +
      '<span class="block__text">' + (v.mono ? '<code>' + esc(v.text) + '</code>' : esc(v.text)) + '</span>' +
      (codeLine ? '<code class="block__code">' + esc(codeLine) + '</code>' : '') +
      '</span>' +
      '</span>' +
      '<button class="block__add" type="button" title="在下面插入" aria-label="在下面插入功能块">' + icon('plus', 'icon icon--12') + '</button>';

    node.addEventListener('click', (e) => {
      // 正在选中这段 DSL 原文时不要重建块栈，否则选区会丢
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.anchorNode && node.contains(sel.anchorNode)) return;
      selectBlock(block.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectBlock(block.id);
      }
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBlockMenu(e.clientX, e.clientY, block, sc, list);
    });

    node.querySelector('.block__add').addEventListener('click', (e) => {
      e.stopPropagation();
      const index = list.indexOf(block) + 1;
      openPalette(e.currentTarget, sc, list, index);
    });

    const handle = node.querySelector('.block__handle');
    handle.addEventListener('dragstart', (e) => startDrag(e, block, list, node));
    handle.addEventListener('dragend', endDrag);
    handle.addEventListener('click', (e) => e.stopPropagation());

    node.addEventListener('dragover', (e) => onDragOver(e, block, list, node));
    node.addEventListener('dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) node.classList.remove('is-drop-before', 'is-drop-after');
    });
    node.addEventListener('drop', (e) => onDrop(e, block, list));

    if (!block.children || !block.children.length) return node;

    const wrap = document.createElement('div');
    wrap.dataset.blockWrap = block.id;
    wrap.appendChild(node);
    const nested = el('div', 'stack stack--nested');
    nested.setAttribute('role', 'group');
    nested.setAttribute('aria-label', '条件成立时执行');
    blockListNodes(block.children, sc).forEach((c) => nested.appendChild(c));
    wrap.appendChild(nested);
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * 拖动排序
   * ------------------------------------------------------------------ */

  let drag = null;
  let dropTarget = null;
  let dropGap = null;

  function startDrag(e, block, list, node) {
    drag = { block, list, node, id: block.id };
    node.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', block.id);
    try {
      e.dataTransfer.setDragImage(node, 24, 22);
    } catch (_) {
      /* 某些平台不支持自定义拖影，忽略 */
    }
  }

  function clearDropMarks() {
    mainEl.querySelectorAll('.is-drop-before,.is-drop-after').forEach((n) => n.classList.remove('is-drop-before', 'is-drop-after'));
  }

  function onDragOver(e, block, list, node) {
    if (!drag || drag.list !== list || drag.id === block.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = node.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    dropGap = null;
    node.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    dropTarget = { block, list, after };
  }

  function onDrop(e, block, list) {
    dropGap = null;
    if (!drag || !dropTarget || drag.list !== list) return;
    e.preventDefault();
    const from = list.indexOf(drag.block);
    const targetIdx = list.indexOf(dropTarget.block);
    if (from < 0 || targetIdx < 0) return endDrag();

    // 记录重排前的位置，用于 FLIP 动画
    const before = new Map();
    mainEl.querySelectorAll('[data-block-id]').forEach((n) => {
      before.set(n.dataset.blockId, n.getBoundingClientRect().top);
    });

    list.splice(from, 1);
    let insertAt = list.indexOf(dropTarget.block);
    if (dropTarget.after) insertAt += 1;
    list.splice(insertAt, 0, drag.block);

    state.blockId = drag.block.id;
    touch();
    endDrag();
    renderMain();
    renderInspector();
    renderChapters();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    mainEl.querySelectorAll('[data-block-id]').forEach((n) => {
      const prev = before.get(n.dataset.blockId);
      if (prev == null) return;
      const dy = prev - n.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        n.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], {
          duration: 240,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    });
  }

  function endDrag() {
    if (drag && drag.node) drag.node.classList.remove('is-dragging');
    clearDropMarks();
    drag = null;
    dropTarget = null;
    dropGap = null;
  }

