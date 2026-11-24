/* ==========================================================================
   hcb-ir-editor · 游戏目录读取进度
   主进程用 worker 扫描，这里只负责显示进度条和文案。
   ========================================================================== */

'use strict';

(function () {
  const box = document.getElementById('scan-progress');
  const text = box && box.querySelector('.scan-progress__text');
  const meta = box && box.querySelector('.scan-progress__meta');
  const fill = box && box.querySelector('.scan-progress__fill');
  let hideTimer = null;
  let lastScanId = 0;

  function clearHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function show(p) {
    if (!box) return;
    clearHide();
    box.hidden = false;
    box.classList.remove('is-error');
    box.setAttribute('aria-busy', 'true');
    text.textContent = p.text || '正在读取游戏资源…';
    box.title = text.textContent;
    const total = Number(p.total) || 0;
    const completed = Number(p.completed) || 0;
    meta.textContent = total ? completed + ' / ' + total : '';
    let percent = Number(p.percent);
    if (!Number.isFinite(percent)) percent = total ? (completed / total) * 100 : 0;
    percent = Math.max(0, Math.min(100, percent));
    fill.style.width = percent + '%';
  }

  function finish() {
    if (!box) return;
    clearHide();
    box.hidden = false;
    box.classList.remove('is-error');
    box.setAttribute('aria-busy', 'false');
    text.textContent = '游戏资源读取完成';
    box.title = '';
    meta.textContent = '';
    fill.style.width = '100%';
    hideTimer = setTimeout(() => {
      box.hidden = true;
    }, 700);
  }

  function fail(message) {
    if (!box) return;
    clearHide();
    box.hidden = false;
    box.classList.add('is-error');
    box.setAttribute('aria-busy', 'false');
    text.textContent = String(message || '资源读取失败');
    box.title = text.textContent;
    meta.textContent = '';
    fill.style.width = '0%';
    hideTimer = setTimeout(() => {
      box.hidden = true;
    }, 3500);
  }

  window.SCAN_UI = {
    start: () => show({ phase: 'listing', percent: 0, text: '正在读取游戏目录…' }),
    finish,
    fail,
  };

  if (window.shell && window.shell.onScanProgress) {
    window.shell.onScanProgress((p) => {
      if (!p || typeof p !== 'object') return;
      if (p.scanId && p.scanId < lastScanId) return;
      if (p.scanId) lastScanId = p.scanId;
      if (p.phase === 'done') {
        finish();
        return;
      }
      if (p.phase === 'error') {
        fail(p.text);
        return;
      }
      show(p);
    });
  }
})();
