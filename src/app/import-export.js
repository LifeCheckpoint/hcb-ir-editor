/* ==========================================================================
   hcb-ir-editor · DSL 导入 / 导出
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 浮层
   * ------------------------------------------------------------------ */

  let banner = null;

  function hideBanner() {
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  function showBanner(message, actions) {
    hideBanner();
    const box = el('div', 'banner');
    box.appendChild(el('span', 'banner__text', esc(message)));
    (actions || []).forEach((a) => {
      const b = el('button', 'banner__btn', esc(a.label));
      b.type = 'button';
      b.addEventListener('click', () => {
        Promise.resolve(a.action && a.action()).catch(() => {});
      });
      box.appendChild(b);
    });
    document.body.appendChild(box);
    banner = box;
  }

  /* ------------------------------------------------------------------ *
   * 导入 DSL
   * ------------------------------------------------------------------ */

  let dslModal = null;
  let dslKeyHandler = null;
  let dslState = null;

  function fmtSize(n) {
    if (!n) return '';
    return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }

  function bindingsFromSections(sections) {
    const list = [];
    const seen = new Set();
    (sections || []).forEach((sec) =>
      (sec.blocks || []).forEach((b) => {
        const d = b.data || {};
        if (b.type === 'bgload' && d.id !== '' && d.id != null) {
          const name = d.name || d.file || '背景 ' + d.id;
          if (!seen.has(name)) {
            seen.add(name);
            list.push({ name, call: '[bg,' + d.id + ']', note: '' });
          }
        } else if (b.type === 'cgload' && d.name) {
          if (!seen.has(d.name)) {
            seen.add(d.name);
            list.push({ name: d.name, call: '[cg,' + d.name + ']', note: '' });
          }
        }
      })
    );
    if (list.length && window.BINDINGS) {
      window.BINDINGS.add(list);
      window.BINDINGS.refresh();
    }
  }

  function loadedBlocks(list) {
    return (list || []).map((b) => {
      const out = { id: nid(), type: b.type, data: JSON.parse(JSON.stringify(b.data || {})) };
      if (b.extra && b.extra.length) out.extra = b.extra.slice();
      return out;
    });
  }

  /* 把解析结果接到项目里：新项目、某章、某小节 */
  function importParsed(parsed, opts) {
    opts = opts || {};
    const sections = (parsed && parsed.sections) || [];
    if (!sections.length || !parsed.stats.blocks) return null;

    const titleOf = (sec, i) => {
      if (opts.split === false && opts.name) return opts.name;
      return sec.label ? sec.title : sec.title || '小节 ' + (i + 1);
    };

    if (opts.target === 'new') {
      const title = opts.name || '导入的脚本';
      const chapter = {
        id: 'ch-' + ++chapterSeq,
        route: '导入',
        no: '01',
        title,
        status: 'wip',
        scenes: sections.map((sec, i) => ({
          id: 's-' + ++chapterSeq,
          no: 'S' + String(i + 1).padStart(2, '0'),
          title: titleOf(sec, i),
          where: '',
          blocks: loadedBlocks(sec.blocks),
        })),
      };
      CHAPTERS = [chapter];
      state.chapterId = chapter.id;
      state.blockId = chapter.scenes[0] && chapter.scenes[0].blocks[0] ? chapter.scenes[0].blocks[0].id : null;
      state.collapsedScenes = {};
      state.filter = '';
      projectPath = null;
      projectTitle = title;
      dirty = true;
      forgetProject();
      // 导入脚本不清映射表：映射是资源层，先导表再导剧本也应保留
      if (window.RES) window.RES.resetSprites();
      if (window.BINDINGS) {
        window.BINDINGS.load([]);
        window.BINDINGS.refresh();
      }
      bindingsFromSections(sections);
      dropDecls();
      renderAll();
      setProjectTitle();
      setSaveState();
      if (mainEl) mainEl.scrollTop = 0;
      return chapter;
    }

    const ch = CHAPTERS.find((c) => c.id === opts.chapterId);
    if (!ch) return null;

    if (opts.target === 'scene') {
      const sc = (ch.scenes || []).find((s) => s.id === opts.sceneId);
      if (!sc) return null;
      const blocks = sections.reduce((out, sec) => out.concat(loadedBlocks(sec.blocks)), []);
      sc.blocks = (sc.blocks || []).concat(blocks);
      state.chapterId = ch.id;
      state.blockId = blocks[0] ? blocks[0].id : null;
      bindingsFromSections(sections);
      touch();
      renderAll();
      revealSelection();
      return sc;
    }

    const startNo = (ch.scenes || []).length;
    const scenes = sections.map((sec, i) => ({
      id: 's-' + ++chapterSeq,
      no: 'S' + String(startNo + i + 1).padStart(2, '0'),
      title: titleOf(sec, i),
      where: '',
      blocks: loadedBlocks(sec.blocks),
    }));
    ch.scenes = (ch.scenes || []).concat(scenes);
    state.chapterId = ch.id;
    state.blockId = scenes[0] && scenes[0].blocks[0] ? scenes[0].blocks[0].id : null;
    bindingsFromSections(sections);
    touch();
    renderAll();
    revealSelection();
    return scenes[0] || ch;
  }

  function revealSelection() {
    requestAnimationFrame(() => {
      const node = document.querySelector('.block.is-selected');
      if (node) node.scrollIntoView({ block: 'center' });
      else if (mainEl) mainEl.scrollTop = 0;
    });
  }

  function closeDslDialog() {
    if (!dslModal) return;
    if (openSelect) closeSelect(true);
    if (openMenu) closeMenu();
    dslModal.remove();
    dslModal = null;
    dslState = null;
    if (dslKeyHandler) document.removeEventListener('keydown', dslKeyHandler, true);
    dslKeyHandler = null;
  }

  async function openDslDialog(opts) {
    opts = opts || {};
    closeDslDialog();
    if (!window.HCB_DSL) {
      showBanner('DSL 解析器没有加载');
      return;
    }

    const firstChapter = currentChapter();
    dslState = {
      path: '',
      name: '',
      size: 0,
      bytes: null,
      encoding: 'auto',
      decoded: null,
      parsed: null,
      error: '',
      target: 'new',
      chapterId: firstChapter ? firstChapter.id : null,
      sceneId: firstChapter && firstChapter.scenes[0] ? firstChapter.scenes[0].id : null,
      split: true,
    };

    const overlay = el('div', 'modal');
    const panel = el('div', 'modal__panel imp');
    overlay.appendChild(el('div', 'modal__scrim'));
    overlay.appendChild(panel);
    panel.innerHTML =
      '<div class="imp__head"><b>导入 DSL</b>' +
      '<button class="btn-ghost btn-ghost--icon imp__x" type="button" aria-label="关闭">' +
      icon('x', 'icon icon--14') +
      '</button></div>' +
      '<div class="imp__body">' +
      '<div class="imp__file"><button class="btn-ghost imp__pick" type="button">选择文件…</button>' +
      '<div class="imp__filemeta"><b class="imp__name">还没有选择文件</b>' +
      '<span class="imp__size"></span></div></div>' +
      '<div class="imp__field"><span class="imp__label">编码</span><div class="imp__ctl imp__enc"></div></div>' +
      '<div class="imp__stats" hidden></div>' +
      '<div class="imp__field"><span class="imp__label">导入到</span><div class="segmented imp__target"></div></div>' +
      '<div class="imp__field imp__chapter-row" hidden><span class="imp__label">章节</span><div class="imp__ctl imp__chapter"></div></div>' +
      '<div class="imp__field imp__scene-row" hidden><span class="imp__label">小节</span><div class="imp__ctl imp__scene"></div></div>' +
      '<div class="imp__split-row"><div class="imp__ctl"></div></div>' +
      '<div class="imp__notice" hidden>当前项目没保存，导入会替换</div>' +
      '</div>' +
      '<div class="imp__foot"><span class="imp__err"></span>' +
      '<button class="btn-ghost imp__cancel" type="button">取消</button>' +
      '<button class="btn-primary imp__ok" type="button" disabled>导入</button></div>';

    const q = (sel) => panel.querySelector(sel);
    const statsEl = q('.imp__stats');
    const targetEl = q('.imp__target');
    const chapterRow = q('.imp__chapter-row');
    const chapterCtl = q('.imp__chapter');
    const sceneRow = q('.imp__scene-row');
    const sceneCtl = q('.imp__scene');
    const splitRow = q('.imp__split-row');
    const splitCtl = splitRow.querySelector('.imp__ctl');
    const noticeEl = q('.imp__notice');
    const errEl = q('.imp__err');
    const okBtn = q('.imp__ok');

    const st = dslState;

    q('.imp__enc').appendChild(
      makeSelect(window.HCB_DSL.ENCODINGS, st.encoding, (v) => {
        st.encoding = v;
        refresh();
      })
    );

    const refresh = () => {
      if (!dslState) return;
      st.error = '';

      if (st.bytes) {
        const dec = window.HCB_DSL.decode(st.bytes, st.encoding);
        if (dec.error) {
          st.decoded = null;
          st.parsed = null;
          st.error = dec.error;
        } else {
          st.decoded = dec;
          st.parsed = window.HCB_DSL.parse(dec.text, { split: st.target === 'scene' ? false : st.split });
        }
      } else {
        st.decoded = null;
        st.parsed = null;
      }

      q('.imp__name').textContent = st.name || '还没有选择文件';
      q('.imp__size').textContent = st.size ? fmtSize(st.size) : '';

      const parsed = st.parsed;
      if (parsed) {
        const s = parsed.stats;
        const parts = ['<span><b>' + s.lines + '</b> 行</span>', '<span><b>' + s.blocks + '</b> 块</span>'];
        if (s.labels) parts.push('<span><b>' + s.labels + '</b> 个标签</span>');
        if (s.sections > 1) parts.push('<span><b>' + s.sections + '</b> 个小节</span>');
        statsEl.innerHTML = parts.join('');
        statsEl.hidden = false;
      } else {
        statsEl.hidden = true;
      }

      // 导入目标
      targetEl.innerHTML = '';
      [
        ['new', '新文件'],
        ['chapter', '章节'],
        ['scene', '小节'],
      ].forEach(([value, label]) => {
        const b = el('button', 'segmented__item' + (st.target === value ? ' is-on' : ''), esc(label));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', st.target === value ? 'true' : 'false');
        b.addEventListener('click', () => {
          st.target = value;
          refresh();
        });
        targetEl.appendChild(b);
      });

      chapterRow.hidden = st.target === 'new';
      sceneRow.hidden = st.target !== 'scene';
      splitRow.hidden = st.target === 'scene';
      noticeEl.hidden = !(st.target === 'new' && dirty && (CHAPTERS.length || projectPath));

      // 章节 / 小节下拉
      chapterCtl.innerHTML = '';
      sceneCtl.innerHTML = '';
      if (st.target !== 'new') {
        if (!CHAPTERS.length) {
          chapterCtl.appendChild(el('span', 'field__note', '当前项目还没有章节'));
        } else {
          if (!CHAPTERS.some((c) => c.id === st.chapterId)) st.chapterId = CHAPTERS[0].id;
          const sel = makeSelect(
            CHAPTERS.map((c) => ({ value: c.id, label: c.title })),
            st.chapterId,
            (v) => {
              st.chapterId = v;
              const ch = CHAPTERS.find((c) => c.id === v);
              st.sceneId = ch && ch.scenes[0] ? ch.scenes[0].id : null;
              refresh();
            }
          );
          chapterCtl.appendChild(sel);
        }
      }
      if (st.target === 'scene') {
        const ch = CHAPTERS.find((c) => c.id === st.chapterId);
        const scenes = (ch && ch.scenes) || [];
        if (!scenes.length) {
          sceneCtl.appendChild(el('span', 'field__note', '这一章还没有小节'));
        } else {
          if (!scenes.some((s) => s.id === st.sceneId)) st.sceneId = scenes[0].id;
          const sel = makeSelect(
            scenes.map((s) => ({ value: s.id, label: s.no + ' ' + s.title })),
            st.sceneId,
            (v) => {
              st.sceneId = v;
              refresh();
            }
          );
          sceneCtl.appendChild(sel);
        }
      }

      // 拆分开关
      splitCtl.innerHTML = '';
      const swRow = el('div', 'switch-row imp__split');
      swRow.innerHTML = '<div class="switch-row__text"><div class="switch-row__name">按 :: 标签拆成小节</div></div>';
      const sw = el('button', 'switch' + (st.split ? ' is-on' : ''));
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', st.split ? 'true' : 'false');
      sw.setAttribute('aria-label', '按标签拆成小节');
      sw.addEventListener('click', () => {
        st.split = !st.split;
        refresh();
      });
      swRow.appendChild(sw);
      splitCtl.appendChild(swRow);

      // 可用性
      let ok = !!(parsed && parsed.stats.blocks) && !st.error;
      if (ok && st.target !== 'new') {
        const ch = CHAPTERS.find((c) => c.id === st.chapterId);
        if (!ch) {
          ok = false;
          st.error = '先选一个章节';
        } else if (st.target === 'scene' && !(ch.scenes || []).some((s) => s.id === st.sceneId)) {
          ok = false;
          st.error = '先选一个小节';
        }
      }
      errEl.textContent = st.error || '';
      okBtn.disabled = !ok;
    };

    const loadFile = async (file) => {
      if (!window.shell || !window.shell.readDsl) {
        st.error = '没有读取文件的通道';
        refresh();
        return;
      }
      const res = await window.shell.readDsl(file);
      if (!res || res.error) {
        st.error = '读取失败：' + (res && res.error);
        refresh();
        return;
      }
      st.path = res.path || file;
      st.name = res.name || String(file).split(/[\\/]/).pop();
      st.size = res.size || 0;
      st.bytes = window.HCB_DSL.base64ToBytes(res.bytes);
      st.error = '';
      refresh();
    };

    q('.imp__pick').addEventListener('click', async () => {
      const file = await window.shell.pickDsl();
      if (file) await loadFile(file);
    });
    q('.imp__x').addEventListener('click', closeDslDialog);
    q('.imp__cancel').addEventListener('click', closeDslDialog);
    overlay.querySelector('.modal__scrim').addEventListener('click', closeDslDialog);

    okBtn.addEventListener('click', () => {
      if (okBtn.disabled || !st.parsed) return;
      const result = importParsed(st.parsed, {
        target: st.target,
        chapterId: st.chapterId,
        sceneId: st.sceneId,
        split: st.split,
        name: st.name.replace(/\.[^.]+$/, ''),
      });
      if (!result) {
        st.error = '没有导入任何内容';
        errEl.textContent = st.error;
        return;
      }
      closeDslDialog();
    });

    dslKeyHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (openSelect || openMenu) return;
      e.stopPropagation();
      closeDslDialog();
    };
    document.addEventListener('keydown', dslKeyHandler, true);

    document.body.appendChild(overlay);
    dslModal = overlay;
    refresh();

    if (opts.path) await loadFile(opts.path);
  }

  /* 把整篇剧本按作者顺序摊平成 DSL 行；章节/场景只影响空行分隔 */
  function dslText() {
    const out = [];
    CHAPTERS.forEach((ch) => {
      (ch.scenes || []).forEach((sc) => {
        if (out.length) out.push('');
        flatten(sc.blocks).forEach((b) => {
          const lines = blockCode(b);
          if (!lines) return;
          lines.forEach((line) => {
            if (line !== '') out.push(line);
          });
        });
      });
    });
    const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return body ? body + '\n' : '';
  }

  async function saveDslTo(file) {
    const text = dslText();
    if (!text.trim()) return { error: 'empty' };
    if (!window.shell || !window.shell.writeDsl) return { error: '没有导出通道' };
    const res = await window.shell.writeDsl({ path: file, text });
    return res && !res.error ? { ok: true, text } : { error: (res && res.error) || '写入失败' };
  }

  async function exportDsl() {
    if (!window.shell || !window.shell.pickDslToSave) return;
    if (!dslText().trim()) {
      showBanner('没有可导出的内容');
      return;
    }
    const base = projectName() === '未命名项目' ? 'script' : projectName();
    const file = await window.shell.pickDslToSave(base + '.txt');
    if (!file) return;
    const result = await saveDslTo(file);
    if (result.error && result.error !== 'empty') showBanner('导出失败：' + result.error);
  }

  /* 自动化测试与导入功能用的小接口 */
  window.DSL = {
    open: openDslDialog,
    close: closeDslDialog,
    state: () => dslState,
    importText(text, opts) {
      if (!window.HCB_DSL) return null;
      opts = opts || { target: 'new', name: '导入' };
      const parsed = window.HCB_DSL.parse(text, { split: opts.split !== false });
      return importParsed(parsed, opts);
    },
    exportText: dslText,
    exportFile: saveDslTo,
    importFile: async (file, opts) => {
      if (!window.shell || !window.shell.readDsl) return null;
      const res = await window.shell.readDsl(file);
      if (!res || res.error) return null;
      const dec = window.HCB_DSL.decode(window.HCB_DSL.base64ToBytes(res.bytes), (opts && opts.encoding) || 'auto');
      if (dec.error) return null;
      const parsed = window.HCB_DSL.parse(dec.text, { split: !opts || opts.split !== false });
      return importParsed(parsed, opts || { target: 'new', name: res.name.replace(/\.[^.]+$/, '') });
    },
  };

