/* ==========================================================================
   hcb-ir-editor · 多选参数栏
   同类型块显示该类型的字段；值不一致时显示「多个值」，修改一次写回整批。
   ========================================================================== */

'use strict';

function multiValue(picked, key) {
  return picked[0].block.data ? picked[0].block.data[key] : undefined;
}

function multiSame(picked, key) {
  const first = JSON.stringify(multiValue(picked, key));
  return picked.every((x) => JSON.stringify(x.block.data ? x.block.data[key] : undefined) === first);
}

function multiAllSame(values) {
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first);
}

function commitMulti(picked, key, value, rerender) {
  const same = picked.every((x) => JSON.stringify(x.block.data ? x.block.data[key] : undefined) === JSON.stringify(value));
  if (same) return;
  const copy = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  if (window.HISTORY) window.HISTORY.batch(() => {
    picked.forEach(({ block }) => {
      if (!block.data) block.data = {};
      block.data[key] = copy;
      patchBlock(block);
    });
  });
  if (window.HISTORY) window.HISTORY.commit('multi:' + picked[0].block.type + ':' + key);
  if (rerender !== false) renderInspector();
}

function multiFieldNode(field, picked) {
  const stacked = field.type === 'switch' || field.type === 'options' || field.full;
  const wrap = el('div', 'field' + (stacked ? '' : ' field--row'));
  wrap.appendChild(el('label', 'field__label', esc(field.label || '') + (field.req ? '<span class="field__req">*</span>' : '')));
  const ctl = stacked ? wrap : el('div', 'field__ctl');
  const done = () => {
    if (!stacked) wrap.appendChild(ctl);
    return wrap;
  };
  const same = multiSame(picked, field.key);
  const first = multiValue(picked, field.key);
  const mixed = !same;
  const placeholder = mixed ? '多个值' : field.placeholder || '';
  const commit = (v, rerender) => commitMulti(picked, field.key, v, rerender);

  if (field.type === 'textarea') {
    const ta = el('textarea', 'control');
    ta.value = same && first != null ? first : '';
    ta.placeholder = placeholder;
    if (field.rows) ta.rows = field.rows;
    ta.addEventListener('input', () => commit(ta.value, false));
    ta.addEventListener('change', () => renderInspector());
    ctl.appendChild(ta);
  } else if (field.type === 'text') {
    const inp = el('input', 'control' + (field.mono ? ' control--mono' : ''));
    inp.type = 'text';
    inp.value = same && first != null ? first : '';
    inp.placeholder = placeholder;
    inp.addEventListener('input', () => commit(inp.value, false));
    inp.addEventListener('change', () => renderInspector());
    ctl.appendChild(inp);
  } else if (field.type === 'number') {
    const numeric = same && (first === '' || first == null || typeof first === 'number' || /^-?\d+(\.\d+)?$/.test(String(first)));
    const inp = el('input', 'control control--mono');
    inp.type = numeric ? 'number' : 'text';
    inp.value = same && first != null ? first : '';
    inp.placeholder = placeholder;
    if (numeric) {
      if (field.min != null) inp.min = field.min;
      if (field.max != null) inp.max = field.max;
      if (field.step != null) inp.step = field.step;
    }
    inp.addEventListener('input', () => commit(inp.value === '' ? '' : Number(inp.value), false));
    inp.addEventListener('change', () => renderInspector());
    if (field.unit) {
      const row = el('div', 'unit-row');
      row.appendChild(inp);
      row.appendChild(el('span', 'unit', esc(field.unit)));
      ctl.appendChild(row);
    } else {
      ctl.appendChild(inp);
    }
  } else if (field.type === 'vector') {
    const box = el('div', 'field__vector');
    (field.keys || []).forEach((key, i) => {
      const sameKey = multiSame(picked, key);
      const raw = sameKey ? multiValue(picked, key) : '';
      const numeric = raw === '' || raw == null || typeof raw === 'number' || /^-?\d+(\.\d+)?$/.test(String(raw));
      const inp = el('input', 'control control--mono');
      inp.type = numeric ? 'number' : 'text';
      inp.value = raw == null ? '' : raw;
      inp.placeholder = sameKey ? ((field.places || [])[i] || key) : '多个值';
      inp.title = (field.places || [])[i] || key;
      inp.addEventListener('input', () => commitMulti(picked, key, inp.value === '' ? '' : Number(inp.value), false));
      inp.addEventListener('change', () => renderInspector());
      box.appendChild(inp);
    });
    ctl.appendChild(box);
  } else if (field.type === 'select') {
    if (field.mapped && !hasMapping()) {
      const inp = el('input', 'control' + (field.numeric ? ' control--mono' : ''));
      inp.type = field.numeric ? 'number' : 'text';
      inp.value = same && first != null ? first : '';
      inp.placeholder = placeholder;
      inp.addEventListener('input', () => commit(field.numeric ? (inp.value === '' ? '' : Number(inp.value)) : inp.value, false));
      ctl.appendChild(inp);
      return done();
    }
    const options = (typeof field.options === 'function' ? field.options() : field.options || []).slice();
    if (!field.req) options.unshift({ value: '', label: '—' });
    if (mixed) options.unshift({ value: '__mixed__', label: '多个值' });
    const sel = makeSelect(options, mixed ? '__mixed__' : first == null ? '' : first, (v) => {
      if (v === '__mixed__') return;
      commit(v);
    });
    ctl.appendChild(sel);
  } else if (field.type === 'switch') {
    const options = [
      { value: '__mixed__', label: '多个值' },
      { value: 'false', label: '关' },
      { value: 'true', label: '开' },
    ];
    const sel = makeSelect(options, mixed ? '__mixed__' : first ? 'true' : 'false', (v) => {
      if (v === '__mixed__') return;
      commit(v === 'true');
    });
    ctl.appendChild(sel);
  } else if (field.type === 'segmented') {
    if (mixed) wrap.appendChild(el('span', 'spk__hint', '多个值'));
    const box = el('div', 'segmented');
    box.setAttribute('role', 'radiogroup');
    (field.options || []).forEach((raw) => {
      const opt = typeof raw === 'string' ? { value: raw, label: raw } : raw;
      const b = el('button', 'segmented__item' + (same && opt.value === first ? ' is-on' : ''));
      b.type = 'button';
      b.textContent = opt.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', same && opt.value === first ? 'true' : 'false');
      b.addEventListener('click', () => commit(opt.value));
      box.appendChild(b);
    });
    ctl.appendChild(box);
  } else if (field.type === 'sprite') {
    if (!hasMapping()) {
      const box = el('div', 'sprite-numbers');
      [
        ['cha', '角色'],
        ['pose', '姿势'],
        ['cloth', '服装'],
        ['face', '表情'],
      ].forEach(([key, label]) => {
        const item = el('label', 'sprite-numbers__item');
        item.appendChild(el('span', 'sprite-numbers__label', label));
        const sameKey = multiSame(picked, key);
        const inp = el('input', 'control control--mono');
        inp.type = 'number';
        inp.value = sameKey && multiValue(picked, key) != null ? multiValue(picked, key) : '';
        inp.placeholder = sameKey ? '' : '多个值';
        inp.addEventListener('input', () => commitMulti(picked, key, inp.value === '' ? '' : Number(inp.value), false));
        item.appendChild(inp);
        box.appendChild(item);
      });
      ctl.appendChild(box);
      return done();
    }
    const labels = picked.map(({ block }) => {
      const pick = spritePick(block);
      return pick ? pick.ch.name + ' ' + pick.cloth : '立绘 ' + (block.data ? block.data.cha : '');
    });
    const allSame = multiAllSame(labels);
    const btn = el('button', 'sprite-pick');
    btn.type = 'button';
    btn.innerHTML =
      '<span class="sprite-pick__empty">' + esc(allSame ? labels[0] : '多个值') + '</span>' +
      '<span class="sprite-pick__cue">选择</span>';
    btn.addEventListener('click', () => openSpritePicker(picked[0].block, picked.map((x) => x.block)));
    ctl.appendChild(btn);
  } else if (field.type === 'chaPick') {
    if (!hasMapping()) {
      const inp = el('input', 'control control--mono');
      inp.type = 'number';
      inp.value = same && first != null ? first : '';
      inp.placeholder = placeholder;
      inp.addEventListener('input', () => commit(inp.value === '' ? '' : Number(inp.value), false));
      ctl.appendChild(inp);
      return done();
    }
    const options = spriteSource().filter((c) => c.cha != null).map((c) => ({ value: c.cha, label: c.name }));
    if (mixed) options.unshift({ value: '__mixed__', label: '多个值' });
    const sel = makeSelect(options, mixed ? '__mixed__' : first == null ? '' : first, (v) => {
      if (v === '__mixed__') return;
      commit(Number(v));
    });
    ctl.appendChild(sel);
  } else if (field.type === 'options') {
    const list = same && Array.isArray(first) ? first : [];
    ctl.appendChild(
      el('div', 'field__note', mixed ? '多个值' : list.length ? list.map((o) => o.text || '—').join(' / ') : '—')
    );
  } else {
    ctl.appendChild(el('span', 'field__note', mixed ? '多个值' : String(first == null ? '' : first)));
  }

  return done();
}

function renderMultiInspector(picked) {
  const primary = picked.find((x) => x.block.id === state.blockId) || picked[0];
  const types = new Set(picked.map((x) => x.block.type));
  const sameType = types.size === 1;
  const def = sameType ? TYPES[primary.block.type] : null;

  const head = el('div', 'inspector-head');
  head.innerHTML =
    '<div class="inspector-head__row">' +
    '<span class="inspector-kind" data-type="' + (sameType ? esc(primary.block.type) : 'multi') + '">' +
    icon(sameType && def ? def.icon : 'square', 'icon icon--12') +
    esc(sameType && def ? primary.block.type : '多选') +
    '</span>' +
    '<span class="inspector-path">' + esc(primary.scene.no + ' ' + primary.scene.title) + '</span>' +
    '</div>' +
    '<h2 class="inspector-title">' +
    (sameType && def ? '已选 ' + picked.length + ' 个' + esc(def.label) : '已选 ' + picked.length + ' 个块') +
    '</h2>';
  inspector.appendChild(head);

  const body = el('div', 'inspector-body');

  if (!sameType) {
    body.appendChild(el('p', 'note-line', '选中了不同类型块'));
    inspector.appendChild(body);
    return;
  }

  const stageSet = el('div', 'fieldset');
  stageSet.appendChild(el('div', 'fieldset__legend', '舞台'));
  stageSet.appendChild(stageCard(primary.scene, primary.block));
  body.appendChild(stageSet);
  hydrateSpriteImages(stageSet);

  if (!def.fields.length) body.appendChild(el('p', 'note-line', '这个原语没有参数'));

  const groups = [];
  def.fields.forEach((f) => {
    if (f.show && !f.show(primary.block.data || {})) return;
    const name = f.group || '参数';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, fields: [] }));
    g.fields.push(f);
  });

  groups.forEach((g) => {
    const fs = el('div', 'fieldset');
    fs.appendChild(el('div', 'fieldset__legend', esc(g.name)));
    g.fields.forEach((f) => fs.appendChild(multiFieldNode(f, picked)));
    body.appendChild(fs);
  });

  inspector.appendChild(body);
}
