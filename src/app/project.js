/* ==========================================================================
   hcb-ir-editor · 项目文件
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 项目文件
   * ------------------------------------------------------------------ */

  const PROJECT_FORMAT = 'hcb-ir/project';
  const PROJECT_VERSION = 2;
  const LAST_KEY = 'hcb.lastProject';

  let projectPath = null;
  let projectTitle = '未命名项目';
  let projectMtime = 0;
  let dirty = false;

  function projectName() {
    if (projectPath) return projectPath.split(/[\\/]/).pop().replace(/\.hcbproj$/i, '');
    return projectTitle;
  }

  function setProjectTitle(name) {
    if (name != null) projectTitle = name;
    const node = document.querySelector('.titlebar__project');
    if (node) node.textContent = projectName();
  }

  function rememberProject(file) {
    try {
      localStorage.setItem(LAST_KEY, file);
    } catch (_) {}
  }

  function forgetProject() {
    try {
      localStorage.removeItem(LAST_KEY);
    } catch (_) {}
  }

  function lastProject() {
    try {
      return localStorage.getItem(LAST_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setSaveState() {
    const el = document.querySelector('#save-state .save-state__text');
    const wrap = document.getElementById('save-state');
    if (el) el.textContent = dirty ? '未保存' : projectPath ? '已保存' : '未保存';
    if (wrap) wrap.classList.toggle('is-dirty', dirty);
  }

  function touch(key) {
    if (typeof invalidateStageCache === 'function') invalidateStageCache();
    dropDecls();
    if (!dirty) {
      dirty = true;
      setSaveState();
    }
    if (typeof normalizeSelection === 'function') normalizeSelection();
    if (window.HISTORY) window.HISTORY.commit(key);
  }

  function touchUI() {
    if (!dirty) {
      dirty = true;
      setSaveState();
    }
  }

  function markProjectDirtyOnly() {
    if (!dirty) {
      dirty = true;
      setSaveState();
    }
  }

  function projectSettingsChanged() {
    if (typeof invalidateStageCache === 'function') invalidateStageCache();
    markProjectDirtyOnly();
    if (typeof renderInspector === 'function') renderInspector();
    if (typeof renderPreview === 'function') renderPreview({ bulk: false });
  }

  function serializeProject() {
    const collapsed = {};
    Object.keys(state.collapsedScenes).forEach((id) => {
      if (state.collapsedScenes[id]) collapsed[id] = true;
    });
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      game: { root: window.RES ? window.RES.root() : '' },
      settings: window.PROJECT_SETTINGS ? window.PROJECT_SETTINGS.serialize() : null,
      story: { chapters: CHAPTERS },
      bindings: window.BINDINGS ? window.BINDINGS.serialize() : [],
      mapping: window.MAPPING ? window.MAPPING.serialize() : null,
      ui: {
        workspace: document.getElementById('workspace-resource').hidden ? 'write' : 'resource',
        chapterId: state.chapterId,
        collapsedScenes: collapsed,
      },
    };
  }

  function applyProject(data) {
    if (typeof invalidateStageCache === 'function') invalidateStageCache();
    if (!data || data.format !== PROJECT_FORMAT) throw new Error('不是 hcb-ir-editor 项目文件');
    if (Number(data.version) > PROJECT_VERSION) throw new Error('项目版本 ' + data.version + ' 比编辑器新');
    const chapters = data.story && data.story.chapters;
    if (!Array.isArray(chapters)) throw new Error('项目里没有章节数据');
    CHAPTERS = chapters.map((c) => ({
      ...c,
      scenes: Array.isArray(c.scenes) ? c.scenes : [],
    }));
    if (window.PROJECT_SETTINGS) window.PROJECT_SETTINGS.load(data.settings);
    const want = data.ui && data.ui.chapterId;
    state.chapterId = CHAPTERS.some((c) => c.id === want) ? want : CHAPTERS[0] ? CHAPTERS[0].id : null;
    state.collapsedScenes = {};
    const cs = (data.ui && data.ui.collapsedScenes) || {};
    Object.keys(cs).forEach((id) => {
      state.collapsedScenes[id] = !!cs[id];
    });
    state.blockId = null;
    state.selectedIds = [];
    state.anchorId = null;
    state.focusTypes = [];
    // 上一版把未知行叫 raw，现在统一成自定义指令
    const fixTypes = (list) =>
      (list || []).forEach((b) => {
        if (b.type === 'raw') b.type = 'custom';
        if (b.children) fixTypes(b.children);
      });
    CHAPTERS.forEach((c) => (c.scenes || []).forEach((s) => fixTypes(s.blocks)));
    let max = 900;
    const walk = (list) =>
      (list || []).forEach((b) => {
        const m = /^b-(\d+)$/.exec(b.id || '');
        if (m) max = Math.max(max, Number(m[1]));
        if (b.children) walk(b.children);
      });
    CHAPTERS.forEach((c) => (c.scenes || []).forEach((s) => walk(s.blocks)));
    seq = max;
    dropDecls();
    if (window.MAPPING) {
      try {
        window.MAPPING.load(data.mapping);
      } catch (_) {
        window.MAPPING.clear();
      }
      if (window.RES) window.RES.resetSprites();
    }
    if (window.BINDINGS) {
      window.BINDINGS.load(data.bindings || []);
      window.BINDINGS.refresh();
    }
    renderChapters();
    renderMain();
    renderInspector();
    const ws = 'write';
    const btn = document.querySelector('.workspace-switch__btn[data-workspace="' + ws + '"]');
    if (btn) btn.click();
    setSaveState();
    if (window.HISTORY) window.HISTORY.reset();
  }

  async function loadGameRoot(root) {
    if (!root || !window.shell || !window.shell.scanResources) return;
    const res = window.RES && window.RES.scanDirectory ? await window.RES.scanDirectory(root) : await window.shell.scanResources(root);
    if (!res) return;
    if (res.error === '已取消') return;
    if (res.archives && res.archives.length) {
      if (!window.RES || !window.RES.scanDirectory) window.RES.setScan(res);
      hideBanner();
      return;
    }
    showBanner('找不到资源目录：' + root, [
      {
        label: '重新选择',
        action: async () => {
          const dir = await window.shell.pickDirectory();
          if (!dir) return;
          const r = window.RES && window.RES.scanDirectory ? await window.RES.scanDirectory(dir) : await window.shell.scanResources(dir);
          if (r && r.archives && r.archives.length) {
            if (!window.RES || !window.RES.scanDirectory) window.RES.setScan(r);
            hideBanner();
          }
        },
      },
      { label: '忽略', action: hideBanner },
    ]);
  }

  async function writeProjectTo(file) {
    const res = await window.shell.writeProject({ path: file, text: JSON.stringify(serializeProject(), null, 2) });
    if (!res || res.error) {
      showBanner('保存失败：' + (res && res.error));
      return false;
    }
    projectPath = file;
    projectTitle = file.split(/[\\/]/).pop().replace(/\.hcbproj$/i, '');
    projectMtime = res.mtime || 0;
    dirty = false;
    rememberProject(file);
    setProjectTitle();
    setSaveState();
    renderChapters();
    if (!CHAPTERS.length) renderMain();
    return true;
  }

  async function readProjectFrom(file, opts) {
    opts = opts || {};
    if (!window.shell || !window.shell.readProject) return null;
    const res = await window.shell.readProject(file);
    if (!res || res.error) {
      if (!opts.quiet) showBanner('打开失败：' + (res && res.error));
      return null;
    }
    let data;
    try {
      data = JSON.parse(res.text);
    } catch (_) {
      if (!opts.quiet) showBanner('文件不是合法 JSON');
      return null;
    }
    try {
      applyProject(data);
    } catch (err) {
      if (!opts.quiet) showBanner(String((err && err.message) || err));
      return null;
    }
    projectPath = file;
    projectTitle = file.split(/[\\/]/).pop().replace(/\.hcbproj$/i, '');
    projectMtime = 0;
    dirty = false;
    rememberProject(file);
    setProjectTitle();
    setSaveState();
    renderChapters();
    if (!CHAPTERS.length) renderMain();
    await loadGameRoot((data.game && data.game.root) || '');
    return data;
  }

  async function openProject() {
    if (!window.shell || !window.shell.pickProjectToOpen) return;
    const file = await window.shell.pickProjectToOpen();
    if (file) await readProjectFrom(file);
  }

  async function saveProject(asNew) {
    if (!window.shell || !window.shell.writeProject) return;
    let file = projectPath;
    if (asNew || !file) {
      const suggested = projectName() === '未命名项目' ? '未命名项目.hcbproj' : projectName() + '.hcbproj';
      file = await window.shell.pickProjectToSave(suggested);
      if (!file) return;
    }
    await writeProjectTo(file);
  }

  function newProject() {
    if (typeof invalidateStageCache === 'function') invalidateStageCache();
    if (window.PROJECT_SETTINGS) window.PROJECT_SETTINGS.reset();
    CHAPTERS = [];
    state.chapterId = null;
    state.blockId = null;
    state.selectedIds = [];
    state.anchorId = null;
    state.focusTypes = [];
    state.filter = '';
    state.collapsedScenes = {};
    projectPath = null;
    projectTitle = '未命名项目';
    dirty = false;
    forgetProject();
    if (window.MAPPING) window.MAPPING.clear();
    if (window.RES) window.RES.resetSprites();
    if (window.BINDINGS) {
      window.BINDINGS.load([]);
      window.BINDINGS.refresh();
    }
    dropDecls();
    renderAll();
    setProjectTitle();
    setSaveState();
    if (window.HISTORY) window.HISTORY.reset();
  }

  /* 给自动化测试与后续导出用的小接口 */
  window.PROJECT = {
    serialize: serializeProject,
    apply: applyProject,
    openFrom: readProjectFrom,
    saveTo: writeProjectTo,
    newProject,
    path: () => projectPath,
    isDirty: () => dirty,
    markDirty: touch,
    settings: () => (window.PROJECT_SETTINGS ? window.PROJECT_SETTINGS.get() : null),
    settingsChanged: projectSettingsChanged,
    mappingChanged: () => {
      if (typeof invalidateStageCache === 'function') invalidateStageCache();
      dropDecls();
      if (window.RES) window.RES.resetSprites();
      if (window.BINDINGS) window.BINDINGS.refresh();
      renderAll();
    },
    chapters: () => CHAPTERS,
    name: projectName,
    title: setProjectTitle,
    last: lastProject,
  };

