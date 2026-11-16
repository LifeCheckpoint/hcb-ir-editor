/* ==========================================================================
   hcb-ir-editor · 聚焦模式
   只保留选中的块类型；连续的非聚焦块在主栏压成一条灰线。
   ========================================================================== */

'use strict';

let focusModal = null;
let focusKeyHandler = null;

function applyFocusTypes(types) {
  state.focusTypes = Array.from(new Set((types || []).filter((t) => !!TYPES[t])));
  normalizeSelection();
  renderMain();
  renderInspector();
  renderChapters();
}

function clearFocusTypes() {
  applyFocusTypes([]);
}

function closeFocusDialog() {
  if (!focusModal) return;
  focusModal.remove();
  focusModal = null;
  if (focusKeyHandler) {
    document.removeEventListener('keydown', focusKeyHandler, true);
    focusKeyHandler = null;
  }
}

function openFocusDialog() {
  closeFocusDialog();
  if (openSelect) closeSelect(true);
  if (openMenu) closeMenu();

  const selected = new Set(state.focusTypes || []);
  const overlay = el('div', 'modal');
  const panel = el('div', 'modal__panel imp focus');
  const scrim = el('div', 'modal__scrim');
  overlay.appendChild(scrim);
  overlay.appendChild(panel);

  const head = el('div', 'imp__head');
  head.innerHTML =
    '<b>聚焦模式</b>' +
    '<button class="btn-ghost btn-ghost--icon imp__x" type="button" aria-label="关闭">' +
    icon('x', 'icon icon--14') +
    '</button>';
  panel.appendChild(head);

  const body = el('div', 'imp__body focus__body');
  body.appendChild(el('p', 'focus__hint', '只保留选中的块类型，其余块压成一条灰线。'));
  const count = el('span', 'focus__count');

  const paintCount = () => {
    count.textContent = '已选 ' + selected.size + ' 类';
  };

  GROUP_ORDER.forEach((g) => {
    const keys = Object.keys(TYPES).filter((t) => TYPES[t].group === g && !TYPES[t].hidden);
    if (!keys.length) return;
    const group = el('div', 'focus__group');
    group.appendChild(el('div', 'focus__group-title', esc(GROUPS[g].label)));
    const grid = el('div', 'focus__types');
    keys.forEach((t) => {
      const btn = el('button', 'focus-type' + (selected.has(t) ? ' is-on' : ''));
      btn.type = 'button';
      btn.dataset.type = t;
      btn.setAttribute('aria-pressed', selected.has(t) ? 'true' : 'false');
      btn.innerHTML =
        '<span class="focus-type__cmd">' + esc(t) + '</span>' +
        '<span class="focus-type__label">' + esc(TYPES[t].label) + '</span>';
      btn.addEventListener('click', () => {
        if (selected.has(t)) {
          selected.delete(t);
          btn.classList.remove('is-on');
          btn.setAttribute('aria-pressed', 'false');
        } else {
          selected.add(t);
          btn.classList.add('is-on');
          btn.setAttribute('aria-pressed', 'true');
        }
        paintCount();
      });
      grid.appendChild(btn);
    });
    group.appendChild(grid);
    body.appendChild(group);
  });

  panel.appendChild(body);

  const foot = el('div', 'imp__foot focus__foot');
  foot.appendChild(count);
  const all = el('button', 'btn-ghost', '显示全部');
  all.type = 'button';
  const cancel = el('button', 'btn-ghost', '取消');
  cancel.type = 'button';
  const apply = el('button', 'btn-primary', '应用');
  apply.type = 'button';
  foot.appendChild(all);
  foot.appendChild(cancel);
  foot.appendChild(apply);
  panel.appendChild(foot);
  paintCount();

  head.querySelector('.imp__x').addEventListener('click', closeFocusDialog);
  scrim.addEventListener('click', closeFocusDialog);
  cancel.addEventListener('click', closeFocusDialog);
  all.addEventListener('click', () => {
    applyFocusTypes([]);
    closeFocusDialog();
  });
  apply.addEventListener('click', () => {
    applyFocusTypes(Array.from(selected));
    closeFocusDialog();
  });

  focusKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeFocusDialog();
    }
  };
  document.addEventListener('keydown', focusKeyHandler, true);

  document.body.appendChild(overlay);
  focusModal = overlay;
}
