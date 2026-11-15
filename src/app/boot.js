/* ==========================================================================
   hcb-ir-editor · 启动
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */

  function boot() {
    document.body.dataset.platform = (window.shell && window.shell.platform) || 'win32';
    buildTypeSheet();
    buildMenubar();
    renderChapters();
    renderMain();
    renderInspector();
    setProjectTitle();
    setSaveState();
    document.addEventListener('keydown', onKey);
    const exportBtn = document.getElementById('export-dsl');
    if (exportBtn) exportBtn.addEventListener('click', () => exportDsl());

    // 有上次打开的项目就接着打开；找不到就回到空状态
    const last = lastProject();
    if (last && window.shell && window.shell.readProject) {
      readProjectFrom(last, { quiet: true }).then((data) => {
        if (data) return;
        forgetProject();
        projectPath = null;
        projectTitle = '未命名项目';
        setProjectTitle();
        renderAll();
        setSaveState();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
