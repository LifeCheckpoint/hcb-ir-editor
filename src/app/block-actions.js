/* ==========================================================================
   hcb-ir-editor · 块级键盘操作
   复制 / 剪切 / 粘贴 / 删除 / 上下新建 / 上下移动
   ========================================================================== */

'use strict';

let blockClipboard = [];

function hasSelectedBlocks() {
  return selectedBlocks().length > 0;
}

function hasBlockClipboard() {
  return blockClipboard.length > 0;
}

function clipboardTargets() {
  const selected = selectedBlocks();
  if (!selected.length) return [];
  const order = new Map();
  const parents = new Map();
  const walk = (list, parent) => {
    (list || []).forEach((b) => {
      order.set(b.id, order.size);
      parents.set(b.id, parent);
      walk(b.children, b);
    });
  };
  (CHAPTERS || []).forEach((ch) => (ch.scenes || []).forEach((sc) => walk(sc.blocks, null)));

  const ids = new Set(selected.map((x) => x.block.id));
  return selected
    .filter((x) => {
      let p = parents.get(x.block.id);
      while (p) {
        if (ids.has(p.id)) return false;
        p = parents.get(p.id);
      }
      return true;
    })
    .sort((a, b) => (order.get(a.block.id) || 0) - (order.get(b.block.id) || 0));
}

function copySelectedBlocks() {
  const picked = clipboardTargets();
  if (!picked.length) return false;
  blockClipboard = picked.map((x) => JSON.parse(JSON.stringify(x.block)));
  return true;
}

function cutSelectedBlocks() {
  const targets = selectedBlocks();
  if (!targets.length) return false;
  copySelectedBlocks();
  deleteBlocks(targets);
  return true;
}

function pasteBlocks() {
  if (!blockClipboard.length) return false;
  const hit = listOfBlock(state.blockId);
  if (!hit) return false;
  const current = hit.list.find((b) => b.id === state.blockId);
  if (!current) return false;
  const at = hit.list.indexOf(current) + 1;
  const clones = blockClipboard.map((src) => {
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = nid();
    if (copy.children) copy.children = reid(copy.children);
    return copy;
  });
  hit.list.splice(at, 0, ...clones);
  state.chapterId = hit.chapter.id;
  state.blockId = clones[0].id;
  state.selectedIds = clones.map((c) => c.id);
  state.anchorId = clones[0].id;
  touch();
  renderAll();
  const node = mainEl.querySelector('[data-block-id="' + state.blockId + '"]');
  if (node) node.scrollIntoView({ block: 'nearest' });
  return true;
}

function deleteSelectedBlocks() {
  const targets = selectedBlocks();
  if (!targets.length) return false;
  deleteBlocks(targets);
  return true;
}

function newSameBlock(where) {
  const hit = listOfBlock(state.blockId);
  if (!hit) return false;
  const block = hit.list.find((b) => b.id === state.blockId);
  if (!block) return false;
  const at = hit.list.indexOf(block);
  const index = where === 'above' ? at : at + 1;
  const fresh = makeBlock(block.type, { sc: hit.scene, list: hit.list, index });
  if (where === 'above') fresh.data = JSON.parse(JSON.stringify(block.data || {}));
  hit.list.splice(index, 0, fresh);
  state.chapterId = hit.chapter.id;
  state.blockId = fresh.id;
  state.selectedIds = [fresh.id];
  state.anchorId = fresh.id;
  touch();
  renderAll();
  const node = mainEl.querySelector('[data-block-id="' + fresh.id + '"]');
  if (node) node.scrollIntoView({ block: 'nearest' });
  return true;
}

function moveSelectedBlock(direction) {
  const targets = selectedBlocks();
  if (!targets.length) return false;
  const list = targets[0].list;
  if (!targets.every((x) => x.list === list)) return false;
  const indexes = targets.map((x) => list.indexOf(x.block)).sort((a, b) => a - b);
  if (indexes.some((i) => i < 0)) return false;
  for (let i = 1; i < indexes.length; i += 1) {
    if (indexes[i] !== indexes[i - 1] + 1) return false;
  }
  const min = indexes[0];
  const max = indexes[indexes.length - 1];
  if (direction < 0) {
    if (min === 0) return false;
    const previous = list[min - 1];
    list.splice(min - 1, 1);
    list.splice(max, 0, previous);
  } else {
    if (max === list.length - 1) return false;
    const next = list[max + 1];
    list.splice(max + 1, 1);
    list.splice(min, 0, next);
  }
  touch();
  renderAll();
  const node = mainEl.querySelector('[data-block-id="' + state.blockId + '"]');
  if (node) node.scrollIntoView({ block: 'nearest' });
  return true;
}

/* ------------------------------------------------------------------ *
 * 注释 / 取消注释
 * 注释块把 DSL 原文放在 note.text 里；取消注释时先按 DSL 解析，
 * 解析不出来就提示，不改动任何块。
 * ------------------------------------------------------------------ */

function commentLinesOf(block) {
  const lines = [];
  const walk = (b) => {
    const code = blockCode(b);
    if (code && code.length) lines.push(...code);
    (b.children || []).forEach(walk);
  };
  walk(block);
  return lines;
}

function makeCommentBlock(block) {
  const lines = commentLinesOf(block);
  if (!lines.length) return null;
  const source = JSON.parse(JSON.stringify(block));
  source.id = block.id;
  const note = {
    id: block.id,
    type: 'note',
    data: { text: lines.join('\n') },
    commentSource: source,
  };
  return note;
}

function makeParsedBlock(parsed) {
  const block = {
    id: nid(),
    type: parsed.type,
    data: JSON.parse(JSON.stringify(parsed.data || {})),
  };
  if (parsed.extra && parsed.extra.length) block.extra = parsed.extra.slice();
  if (parsed.children && parsed.children.length) {
    block.children = parsed.children.map(makeParsedBlock);
  }
  return block;
}

function parseCommentText(text) {
  if (!window.HCB_DSL) return null;
  const clean = String(text || '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');
  const parsed = window.HCB_DSL.parse(clean, { split: false });
  const blocks = [];
  (parsed.sections || []).forEach((section) => {
    (section.blocks || []).forEach((block) => blocks.push(block));
  });
  if (!blocks.length || blocks.some((block) => block.type === 'note' || block.type === 'custom')) {
    return null;
  }
  return blocks.map(makeParsedBlock);
}

function restoreCommentBlock(block) {
  const source = block.commentSource;
  if (source) {
    const sourceText = commentLinesOf(source).join('\n').trim();
    if (sourceText === String(block.data && block.data.text || '').trim()) {
      const restored = JSON.parse(JSON.stringify(source));
      restored.id = block.id;
      delete restored.commentSource;
      return [restored];
    }
  }
  return parseCommentText(block.data && block.data.text);
}

function toggleBlockComments(targets) {
  const picked = (targets && targets.length ? targets : clipboardTargets()).slice();
  if (!picked.length) return false;

  const plans = [];
  for (const target of picked) {
    const block = target.block;
    if (!block || !target.list || target.list.indexOf(block) < 0) continue;
    if (block.type === 'note') {
      const restored = restoreCommentBlock(block);
      if (!restored) {
        if (typeof showBanner === 'function') {
          showBanner('未能识别注释中的指令', [], 'error');
        }
        return false;
      }
      plans.push({ target, replacement: restored });
    } else {
      const note = makeCommentBlock(block);
      if (!note) {
        if (typeof showBanner === 'function') {
          showBanner('这个块没有可注释的 DSL', [], 'error');
        }
        return false;
      }
      plans.push({ target, replacement: [note] });
    }
  }
  if (!plans.length) return false;

  const byList = new Map();
  plans.forEach((plan) => {
    if (!byList.has(plan.target.list)) byList.set(plan.target.list, []);
    byList.get(plan.target.list).push(plan);
  });
  byList.forEach((items, list) => {
    items
      .sort((a, b) => list.indexOf(b.target.block) - list.indexOf(a.target.block))
      .forEach((plan) => {
        const at = list.indexOf(plan.target.block);
        if (at >= 0) list.splice(at, 1, ...plan.replacement);
      });
  });

  const first = plans[0].target;
  const ids = [];
  plans.forEach((plan) => plan.replacement.forEach((block) => ids.push(block.id)));
  state.chapterId = first.chapter.id;
  state.blockId = ids[0] || null;
  state.selectedIds = ids;
  state.anchorId = ids[0] || null;
  touch();
  renderAll();
  const node = mainEl.querySelector('[data-block-id="' + state.blockId + '"]');
  if (node) node.scrollIntoView({ block: 'nearest' });
  return true;
}

function toggleSelectedComments() {
  return toggleBlockComments(clipboardTargets());
}

