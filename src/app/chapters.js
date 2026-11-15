/* ==========================================================================
   hcb-ir-editor · 章节栏
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 左栏：章节
   * ------------------------------------------------------------------ */

  const chapterRail = document.getElementById('chapter-rail');

  function renderChapters() {
    chapterRail.innerHTML = '';

    const head = el('div', 'rail-head');
    head.appendChild(
      el(
        'div',
        'project-row',
        '<span class="project-row__icon">' + icon('book-open', 'icon icon--14') + '</span>' +
          '<span class="project-row__text">' +
          '<span class="project-row__title">' + esc(projectName()) + '</span>' +
          '<span class="project-row__sub">' + (CHAPTERS.length ? '共 ' + CHAPTERS.length + ' 章' : '空项目') + '</span>' +
          '</span>'
      )
    );

    if (CHAPTERS.length) {
      const search = el('label', 'search', icon('search', 'icon icon--14'));
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = '搜索';
      input.value = state.filter;
      input.setAttribute('aria-label', '搜索章节或场景');
      input.addEventListener('input', () => {
        state.filter = input.value.trim();
        renderChapters();
        const again = chapterRail.querySelector('.search input');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
      search.appendChild(input);
      head.appendChild(search);
    }
    chapterRail.appendChild(head);

    const body = el('div', 'rail-body');
    const q = state.filter.toLowerCase();
    const routes = [];
    CHAPTERS.forEach((ch) => {
      const visible =
        !q ||
        ch.title.toLowerCase().includes(q) ||
        (ch.scenes || []).some((s) => (s.title || '').toLowerCase().includes(q) || (s.where || '').toLowerCase().includes(q));
      if (!visible) return;
      let g = routes.find((r) => r.name === ch.route);
      if (!g) routes.push((g = { name: ch.route, chapters: [] }));
      g.chapters.push(ch);
    });

    const label = el('div', 'rail-label', '<span>章节</span>');
    const addBtn = el('button', 'rail-label__action');
    addBtn.type = 'button';
    addBtn.title = '新建章节';
    addBtn.setAttribute('aria-label', '新建章节');
    addBtn.innerHTML = icon('plus', 'icon icon--14');
    addBtn.addEventListener('click', addChapter);
    label.appendChild(addBtn);
    body.appendChild(label);

    if (!routes.length) body.appendChild(el('div', 'empty', CHAPTERS.length ? '没有匹配的章节' : '还没有章节'));

    routes.forEach((group) => {
      const wrap = el('div', 'chapter-group');
      wrap.appendChild(el('div', 'chapter-group__title', esc(group.name)));
      group.chapters.forEach((ch) => wrap.appendChild(chapterRow(ch)));
      body.appendChild(wrap);
    });
    chapterRail.appendChild(body);

    if (!CHAPTERS.length) return;
    const foot = el('div', 'rail-foot');
    const total = CHAPTERS.reduce((n, c) => n + countBlocks(c), 0);
    const scenes = CHAPTERS.reduce((n, c) => n + (c.scenes || []).length, 0);
    foot.appendChild(el('div', 'rail-foot__row', '<span>全稿</span><b>' + total + ' 块</b>'));
    foot.appendChild(el('div', 'rail-foot__row', '<span>场景</span><b>' + scenes + '</b>'));
    chapterRail.appendChild(foot);
  }

  function chapterRow(ch) {
    const active = ch.id === state.chapterId;
    const row = el('div', 'chapter' + (active ? ' is-active' : ''));
    row.dataset.chapterId = ch.id;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.setAttribute('aria-current', active ? 'true' : 'false');
    row.innerHTML =
      '<span class="chapter__no">' + esc(ch.no) + '</span>' +
      '<span class="chapter__title">' + esc(ch.title) + '</span>' +
      '<span class="status-dot status-dot--' + ch.status + '"></span>';

    row.addEventListener('click', () => {
      if (state.renaming === ch.id) return;
      state.chapterId = ch.id;
      state.renaming = null;
      const first = ch.scenes[0] && flatten(ch.scenes[0].blocks)[0];
      state.blockId = first ? first.id : null;
      renderChapters();
      renderMain();
      renderInspector();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openChapterMenu(e.clientX, e.clientY, ch);
    });

    if (state.renaming === ch.id) {
      const title = row.querySelector('.chapter__title');
      const input = el('input', 'chapter__rename');
      input.type = 'text';
      input.value = ch.title;
      input.setAttribute('aria-label', '章节标题');
      title.replaceWith(input);
      let done = false;
      const commit = (save) => {
        if (done) return;
        done = true;
        state.renaming = null;
        if (save) {
          const v = input.value.trim();
          if (v) ch.title = v;
        }
        // 只替换回标题本身，避免重建整栏打断紧随其后的点击
        input.replaceWith(el('span', 'chapter__title', esc(ch.title)));
        if (ch.id === state.chapterId) renderMain();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          commit(false);
        }
      });
      input.addEventListener('blur', () => commit(true));
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    }

    if (!active) return row;

    const holder = document.createDocumentFragment();
    holder.appendChild(row);

    const tree = el('div', 'scene-tree');
    const hit = state.blockId ? sceneOfBlock(state.blockId) : null;
    const activeScene = hit && hit.chapter.id === ch.id ? hit.scene.id : null;
    (ch.scenes || []).forEach((sc) => {
      const item = el('div', 'scene-item' + (sc.id === activeScene ? ' is-current' : ''));
      item.innerHTML =
        '<span class="scene-item__name">' + esc(sc.no + ' ' + sc.title) + '</span>' +
        '<span class="scene-item__count">' + flatten(sc.blocks).length + '</span>';
      item.addEventListener('click', () => {
        if (state.renamingScene === sc.id) return;
        const first = flatten(sc.blocks)[0];
        if (first) selectBlock(first.id);
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openSceneMenu(e.clientX, e.clientY, ch, sc);
      });

      if (state.renamingScene === sc.id) {
        const nameEl = item.querySelector('.scene-item__name');
        const input = el('input', 'scene__rename');
        input.type = 'text';
        input.value = sc.title;
        input.setAttribute('aria-label', '场景标题');
        nameEl.replaceWith(input);
        let done = false;
        const commit = (save) => {
          if (done) return;
          done = true;
          state.renamingScene = null;
          if (save) {
            const v = input.value.trim();
            if (v) sc.title = v;
          }
          input.replaceWith(el('span', 'scene-item__name', esc(sc.no + ' ' + sc.title)));
          if (ch.id === state.chapterId) renderMain();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            commit(false);
          }
        });
        input.addEventListener('blur', () => commit(true));
        setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
      }

      tree.appendChild(item);
    });

    const addSceneRow = el('button', 'scene-add', icon('plus', 'icon icon--12') + '<span>新建场景</span>');
    addSceneRow.type = 'button';
    addSceneRow.addEventListener('click', () => addScene(ch));
    tree.appendChild(addSceneRow);

    holder.appendChild(tree);
    return holder;
  }

  function openChapterMenu(x, y, ch) {
    showMenu(x, y, [
      { label: '重命名', icon: 'pencil', action: () => {
          state.chapterId = ch.id;
          state.renaming = ch.id;
          renderChapters();
        } },
      { label: '复制一份', icon: 'files', action: () => duplicateChapter(ch) },
      { sep: true },
      { label: '上方插入章节', icon: 'plus', action: () => insertChapter('before', ch) },
      { label: '下方插入章节', icon: 'plus', action: () => insertChapter('after', ch) },
      { sep: true },
      {
        label: '删除章节',
        icon: 'trash-2',
        danger: true,
        disabled: CHAPTERS.length <= 1,
        action: () => deleteChapter(ch),
      },
    ]);
  }

  function newScene(index) {
    return {
      id: 's-' + ++chapterSeq,
      no: 'S' + String(index).padStart(2, '0'),
      title: '新场景',
      where: '',
      blocks: [],
    };
  }

  function insertChapter(where, ref) {
    const ch = {
      id: 'ch-' + ++chapterSeq,
      route: ref ? ref.route : '共通线',
      no: String(CHAPTERS.length + 1).padStart(2, '0'),
      title: '新章节',
      status: 'todo',
      scenes: [newScene(1)],
    };
    const at = ref ? CHAPTERS.indexOf(ref) + (where === 'after' ? 1 : 0) : CHAPTERS.length;
    CHAPTERS.splice(at, 0, ch);
    touch();
    state.chapterId = ch.id;
    state.blockId = null;
    renderAll();
    const row = chapterRail.querySelector('[data-chapter-id="' + ch.id + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function addChapter() {
    insertChapter('after', currentChapter());
  }

  function renderAll() {
    renderChapters();
    renderMain();
    renderInspector();
  }

  function addScene(ch) {
    const sc = newScene((ch.scenes || []).length + 1);
    ch.scenes.push(sc);
    touch();
    state.chapterId = ch.id;
    state.blockId = null;
    renderAll();
  }

  function duplicateScene(ch, sc) {
    const copy = JSON.parse(JSON.stringify(sc));
    copy.id = 's-' + ++chapterSeq;
    copy.title = sc.title + ' 副本';
    copy.blocks = reid(copy.blocks);
    ch.scenes.splice(ch.scenes.indexOf(sc) + 1, 0, copy);
    touch();
    state.chapterId = ch.id;
    state.blockId = copy.blocks[0] ? copy.blocks[0].id : null;
    renderAll();
  }

  function deleteScene(ch, sc) {
    if (ch.scenes.length <= 1) return;
    const at = ch.scenes.indexOf(sc);
    ch.scenes.splice(at, 1);
    touch();
    const next = ch.scenes[Math.min(at, ch.scenes.length - 1)];
    state.chapterId = ch.id;
    state.blockId = next && next.blocks[0] ? flatten(next.blocks)[0].id : null;
    renderAll();
  }

  function openSceneMenu(x, y, ch, sc) {
    showMenu(x, y, [
      { label: '重命名', icon: 'pencil', action: () => {
          state.chapterId = ch.id;
          state.renamingScene = sc.id;
          renderChapters();
        } },
      { label: '复制场景', icon: 'files', action: () => duplicateScene(ch, sc) },
      { sep: true },
      { label: '新建场景', icon: 'plus', action: () => addScene(ch) },
      {
        label: '删除场景',
        icon: 'trash-2',
        danger: true,
        disabled: ch.scenes.length <= 1,
        action: () => deleteScene(ch, sc),
      },
    ]);
  }

  function openBlockMenu(x, y, block, sc, list) {
    const at = list.indexOf(block);
    showMenu(x, y, [
      { label: '复制', icon: 'copy', action: () => duplicateBlock(block, list) },
      { label: '在上方插入', icon: 'plus', action: () => openPaletteAt(x, y, sc, list, at) },
      { label: '在下方插入', icon: 'plus', action: () => openPaletteAt(x, y, sc, list, at + 1) },
      { sep: true },
      { label: '删除', icon: 'trash-2', danger: true, action: () => deleteBlock(block, list) },
    ]);
  }

  function openPaletteAt(x, y, sc, list, index) {
    const anchor = {
      getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }),
    };
    openPalette(anchor, sc, list, index);
  }

  function duplicateBlock(block, list) {
    const copy = JSON.parse(JSON.stringify(block));
    copy.id = nid();
    if (copy.children) copy.children = reid(copy.children);
    list.splice(list.indexOf(block) + 1, 0, copy);
    touch();
    state.blockId = copy.id;
    renderAll();
  }

  function deleteBlock(block, list) {
    const i = list.indexOf(block);
    if (i < 0) return;
    list.splice(i, 1);
    touch();
    const ch = currentChapter();
    const next = list[i] || list[i - 1] || (ch && ch.scenes[0] ? flatten(ch.scenes[0].blocks)[0] : null);
    state.blockId = next ? next.id : null;
    renderAll();
  }

  function duplicateChapter(ch) {
    const copy = JSON.parse(JSON.stringify(ch));
    copy.id = 'ch-' + ++chapterSeq;
    copy.title = ch.title + ' 副本';
    (copy.scenes || []).forEach((sc) => {
      sc.id = 's-' + ++chapterSeq;
      sc.blocks = reid(sc.blocks || []);
    });
    CHAPTERS.splice(CHAPTERS.indexOf(ch) + 1, 0, copy);
    touch();
    state.chapterId = copy.id;
    state.blockId = copy.scenes[0] && flatten(copy.scenes[0].blocks)[0] ? flatten(copy.scenes[0].blocks)[0].id : null;
    renderChapters();
    renderMain();
    renderInspector();
  }

  function reid(list) {
    return list.map((b) => {
      b.id = nid();
      if (b.children) b.children = reid(b.children);
      return b;
    });
  }

  function deleteChapter(ch) {
    if (CHAPTERS.length <= 1) return;
    const at = CHAPTERS.indexOf(ch);
    CHAPTERS.splice(at, 1);
    touch();
    const next = CHAPTERS[Math.min(at, CHAPTERS.length - 1)];
    state.chapterId = next.id;
    const first = next.scenes[0] && flatten(next.scenes[0].blocks)[0];
    state.blockId = first ? first.id : null;
    renderChapters();
    renderMain();
    renderInspector();
  }

