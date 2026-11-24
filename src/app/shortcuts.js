/* ==========================================================================
   hcb-ir-editor · 键盘快捷键窗口
   ========================================================================== */

'use strict';

let shortcutsModal = null;
let shortcutsKeyHandler = null;

const SHORTCUT_GROUPS = [
  {
    title: '块',
    rows: [
      { keys: [['Ctrl', 'C']], desc: '复制选中的块' },
      { keys: [['Ctrl', 'X']], desc: '剪切选中的块' },
      { keys: [['Ctrl', 'V']], desc: '粘贴到当前块下方' },
      { keys: [['Ctrl', 'Shift', 'K'], ['Delete']], desc: '删除选中的块' },
      { keys: [['Ctrl', 'Enter']], desc: '在下方新建同类块' },
      { keys: [['Ctrl', 'Shift', 'Enter']], desc: '在上方新建同类块' },
      { keys: [['Alt', '↑'], ['Alt', '↓']], desc: '选中块上移 / 下移' },
    ],
  },
  {
    title: '选择',
    rows: [
      { keys: [['Ctrl', 'A']], desc: '全选当前章节的块' },
      { keys: [['Esc']], desc: '清空选择' },
      { keys: [['↑'], ['↓']], desc: '切换上一个 / 下一个块' },
    ],
  },
  {
    title: '编辑',
    rows: [
      { keys: [['Ctrl', 'Z']], desc: '撤销' },
      { keys: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], desc: '重做' },
      { keys: [['Ctrl', 'S']], desc: '保存项目' },
      { keys: [['Ctrl', 'O']], desc: '打开项目' },
      { keys: [['Ctrl', 'B']], desc: '选中文字加/去着重（输入框内）' },
    ],
  },
  {
    title: '视图',
    rows: [
      { keys: [['Ctrl', '\\']], desc: '专注模式' },
      { keys: [['Ctrl', 'K']], desc: '打开这个快捷键窗口' },
    ],
  },
];

function closeShortcutsDialog() {
  if (!shortcutsModal) return;
  shortcutsModal.remove();
  shortcutsModal = null;
  if (shortcutsKeyHandler) {
    document.removeEventListener('keydown', shortcutsKeyHandler, true);
    shortcutsKeyHandler = null;
  }
}

function openShortcutsDialog() {
  closeShortcutsDialog();
  if (openSelect) closeSelect(true);
  if (openMenu) closeMenu();
  if (typeof closePalette === 'function') closePalette();

  const overlay = el('div', 'modal');
  const panel = el('div', 'modal__panel imp shortcuts');
  const scrim = el('div', 'modal__scrim');
  overlay.appendChild(scrim);
  overlay.appendChild(panel);

  const head = el('div', 'imp__head');
  head.innerHTML =
    '<b>键盘快捷键</b>' +
    '<button class="btn-ghost btn-ghost--icon imp__x" type="button" aria-label="关闭">' +
    icon('x', 'icon icon--14') +
    '</button>';
  panel.appendChild(head);

  const body = el('div', 'imp__body shortcuts__body');
  SHORTCUT_GROUPS.forEach((group) => {
    const section = el('div', 'shortcut-group');
    section.appendChild(el('div', 'shortcut-group__title', esc(group.title)));
    group.rows.forEach((row) => {
      const line = el('div', 'shortcut-row');
      line.appendChild(el('span', 'shortcut-row__desc', esc(row.desc)));
      const keys = el('span', 'shortcut-row__keys');
      keys.innerHTML = row.keys
        .map((combo) =>
          combo
            .map((k, i) => (i ? '<span class="shortcut-plus">+</span>' : '') + '<kbd>' + esc(k) + '</kbd>')
            .join('')
        )
        .join('<span class="shortcut-or">/</span>');
      line.appendChild(keys);
      section.appendChild(line);
    });
    body.appendChild(section);
  });
  panel.appendChild(body);

  const foot = el('div', 'imp__foot shortcuts__foot');
  foot.appendChild(el('span', 'shortcuts__note', '块快捷键在输入框外生效'));
  const close = el('button', 'btn-primary', '关闭');
  close.type = 'button';
  foot.appendChild(close);
  panel.appendChild(foot);

  head.querySelector('.imp__x').addEventListener('click', closeShortcutsDialog);
  scrim.addEventListener('click', closeShortcutsDialog);
  close.addEventListener('click', closeShortcutsDialog);

  shortcutsKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeShortcutsDialog();
    }
  };
  document.addEventListener('keydown', shortcutsKeyHandler, true);

  document.body.appendChild(overlay);
  shortcutsModal = overlay;
}
