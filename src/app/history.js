/* ==========================================================================
   hcb-ir-editor · 撤销 / 重做
   快照只覆盖剧本章节和选中状态；UI 折叠、滚动、资源区不进入历史。
   ========================================================================== */

'use strict';

const HISTORY = (window.HISTORY = (() => {
  const LIMIT = 100;
  const undoStack = [];
  const redoStack = [];
  let current = null;
  let restoring = false;
  let batching = false;
  let lastKey = '';
  let lastTime = 0;

  function snapshot() {
    return {
      chapters: JSON.parse(JSON.stringify(CHAPTERS || [])),
      chapterId: state.chapterId,
      blockId: state.blockId,
      selectedIds: (state.selectedIds || []).slice(),
      anchorId: state.anchorId,
    };
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    current = snapshot();
    lastKey = '';
    lastTime = 0;
  }

  function syncSelection() {
    if (restoring || batching || !current) return;
    current.chapterId = state.chapterId;
    current.blockId = state.blockId;
    current.selectedIds = (state.selectedIds || []).slice();
    current.anchorId = state.anchorId;
  }

  function commit(key) {
    if (restoring || batching || !current) return;
    const next = snapshot();
    const now = Date.now();
    const coalesce = key && key === lastKey && now - lastTime < 900 && undoStack.length;
    if (!coalesce) {
      undoStack.push(current);
      if (undoStack.length > LIMIT) undoStack.shift();
    }
    current = next;
    redoStack.length = 0;
    lastKey = key || '';
    lastTime = now;
  }

  function restore(snap) {
    restoring = true;
    CHAPTERS = JSON.parse(JSON.stringify(snap.chapters || []));
    state.chapterId = CHAPTERS.some((c) => c.id === snap.chapterId) ? snap.chapterId : CHAPTERS[0] ? CHAPTERS[0].id : null;
    const ids = (snap.selectedIds || []).filter((id) => !!listOfBlock(id));
    state.selectedIds = ids;
    state.blockId = ids.includes(snap.blockId) ? snap.blockId : ids[0] || null;
    state.anchorId = ids.includes(snap.anchorId) ? snap.anchorId : ids[0] || null;
    dropDecls();
    renderAll();
    touch();
    restoring = false;
  }

  function undo() {
    if (!undoStack.length) return false;
    const prev = undoStack.pop();
    redoStack.push(current);
    current = prev;
    restore(prev);
    lastKey = '';
    lastTime = 0;
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    const next = redoStack.pop();
    undoStack.push(current);
    current = next;
    restore(next);
    lastKey = '';
    lastTime = 0;
    return true;
  }

  function batch(fn) {
    batching = true;
    try {
      fn();
    } finally {
      batching = false;
    }
  }

  return {
    reset,
    syncSelection,
    commit,
    undo,
    redo,
    batch,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
})());
