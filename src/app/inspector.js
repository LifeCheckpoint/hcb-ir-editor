/* ==========================================================================
   hcb-ir-editor · 右栏 / 字段 / 立绘选择器
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 右栏
   * ------------------------------------------------------------------ */

  const inspector = document.getElementById('inspector');

  function renderInspector() {
    normalizeSelection();
    if (typeof renderPreview === 'function') renderPreview();
    closeSelect(true);
    closeMenu();
    inspector.innerHTML = '';
    const picked = selectedBlocks();
    if (picked.length > 1) {
      renderMultiInspector(picked);
      hydrateSpriteImages(inspector);
      return;
    }
    const hit = currentBlock();

    if (!hit) {
      inspector.appendChild(el('div', 'empty', '<div class="empty__glyph">' + icon('message-square-text') + '</div>选一个功能块，这里显示它的参数'));
      return;
    }

    const { block, scene } = hit;
    const v = viewOf(block);
    const def = v.def;

    const head = el('div', 'inspector-head');
    head.innerHTML =
      '<div class="inspector-head__row">' +
      '<span class="inspector-kind" data-type="' + block.type + '">' + icon(def.icon, 'icon icon--12') + esc(block.type) + '</span>' +
      '<span class="inspector-path">' + esc(scene.no + ' ' + scene.title) + '</span>' +
      '</div>' +
      '<h2 class="inspector-title">' + esc(v.speaker ? v.speaker + '：' + v.text : v.text) + '</h2>' +
      (v.code ? '<pre class="inspector-code">' + esc(v.code.join('\n')) + '</pre>' : '');
    inspector.appendChild(head);

    const body = el('div', 'inspector-body');

    const wire = wireSet(block);
    if (wire) body.appendChild(wire);

    if (!def.fields.length) body.appendChild(el('p', 'note-line', '这个原语没有参数，改不了什么'));

    const groups = [];
    def.fields.forEach((f) => {
      if (f.show && !f.show(block.data || {})) return;
      const name = f.group || '参数';
      let g = groups.find((x) => x.name === name);
      if (!g) groups.push((g = { name, fields: [] }));
      g.fields.push(f);
    });

    groups.forEach((g) => {
      const fs = el('div', 'fieldset');
      fs.appendChild(el('div', 'fieldset__legend', esc(g.name)));
      g.fields.forEach((f) => fs.appendChild(fieldNode(f, block)));
      body.appendChild(fs);
    });

    inspector.appendChild(body);

    const foot = el('div', 'inspector-foot');
    const dup = el('button', 'btn-ghost', icon('copy', 'icon icon--14') + '<span>复制</span>');
    dup.type = 'button';
    dup.addEventListener('click', () => {
      const hitList = listOfBlock(block.id);
      if (!hitList) return;
      const copy = JSON.parse(JSON.stringify(block));
      copy.id = nid();
      if (copy.children) copy.children = reid(copy.children);
      hitList.list.splice(hitList.list.indexOf(block) + 1, 0, copy);
      state.blockId = copy.id;
      state.selectedIds = [copy.id];
      state.anchorId = copy.id;
      touch();
      renderMain();
      renderInspector();
      renderChapters();
    });

    const del = el('button', 'btn-ghost', icon('trash-2', 'icon icon--14') + '<span>删除</span>');
    del.type = 'button';
    del.addEventListener('click', () => {
      const hitList = listOfBlock(block.id);
      if (!hitList) return;
      const i = hitList.list.indexOf(block);
      hitList.list.splice(i, 1);
      const ch = currentChapter();
      const next = hitList.list[i] || hitList.list[i - 1] || (ch && ch.scenes[0] ? flatten(ch.scenes[0].blocks)[0] : null);
      state.blockId = next ? next.id : null;
      state.selectedIds = next ? [next.id] : [];
      state.anchorId = next ? next.id : null;
      touch();
      renderMain();
      renderInspector();
      renderChapters();
    });

    foot.appendChild(dup);
    foot.appendChild(del);
    inspector.appendChild(foot);
    hydrateSpriteImages(inspector);
  }

  function fieldNode(field, block) {
    const stacked = field.type === 'switch' || field.type === 'options' || field.full;
    const wrap = el('div', 'field' + (stacked ? '' : ' field--row'));

    if (field.type !== 'switch') {
      wrap.appendChild(el('label', 'field__label', esc(field.label || '') + (field.req ? '<span class="field__req">*</span>' : '')));
    }

    const ctl = stacked ? wrap : el('div', 'field__ctl');
    const value = block.data ? block.data[field.key] : undefined;
    const commit = (v) => {
      if (!block.data) block.data = {};
      block.data[field.key] = v;
      patchBlock(block);
      if (field.rerender) renderInspector();
    };

    if (field.type === 'textarea') {
      const ta = el('textarea', 'control');
      ta.value = value == null ? '' : value;
      if (field.placeholder) ta.placeholder = field.placeholder;
      if (field.rows) ta.rows = field.rows;
      ta.addEventListener('input', () => commit(ta.value));
      bindEmphasisShortcut(ta);
      ctl.appendChild(ta);
    } else if (field.type === 'text') {
      const inp = el('input', 'control' + (field.mono ? ' control--mono' : ''));
      inp.type = 'text';
      inp.value = value == null ? '' : value;
      if (field.placeholder) inp.placeholder = field.placeholder;
      inp.addEventListener('input', () => commit(inp.value));
      bindEmphasisShortcut(inp);
      if (field.list) {
        const listId = 'dl-' + field.key + '-' + block.id;
        inp.setAttribute('list', listId);
        const dl = document.createElement('datalist');
        dl.id = listId;
        const source = field.list === 'cg' ? cgNames() : field.list === 'labels' ? allLabels() : [];
        source.forEach((name) => {
          const o = document.createElement('option');
          o.value = name;
          dl.appendChild(o);
        });
        ctl.appendChild(dl);
      }
      ctl.appendChild(inp);
    } else if (field.type === 'number') {
      // 导入的脚本里有 nil 这类非数字，用文本框原样显示，不硬塞进 number 控件
      const numeric = value === '' || value == null || typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value));
      const inp = el('input', 'control control--mono');
      if (numeric) {
        inp.type = 'number';
        inp.value = value == null ? '' : value;
        if (field.min != null) inp.min = field.min;
        if (field.max != null) inp.max = field.max;
        if (field.step != null) inp.step = field.step;
        inp.addEventListener('input', () => commit(inp.value === '' ? '' : Number(inp.value)));
      } else {
        inp.type = 'text';
        inp.value = String(value);
        inp.addEventListener('input', () => commit(inp.value));
      }
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
        const raw = block.data && block.data[key] != null ? block.data[key] : '';
        const numeric = raw === '' || typeof raw === 'number' || /^-?\d+(\.\d+)?$/.test(String(raw));
        const inp = el('input', 'control control--mono');
        inp.type = numeric ? 'number' : 'text';
        inp.value = raw;
        if (numeric) {
          if (field.min != null) inp.min = field.min;
          if (field.max != null) inp.max = field.max;
        }
        const place = (field.places || [])[i] || key;
        inp.placeholder = place;
        inp.title = place;
        inp.setAttribute('aria-label', (field.label || '') + ' ' + place);
        inp.addEventListener('input', () => {
          if (!block.data) block.data = {};
          block.data[key] = raw === '' || numeric ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
          patchBlock(block);
        });
        box.appendChild(inp);
      });
      ctl.appendChild(box);
    } else if (field.type === 'select') {
      if (field.mapped && !hasMapping()) {
        const inp = el('input', 'control' + (field.numeric ? ' control--mono' : ''));
        inp.type = field.numeric ? 'number' : 'text';
        inp.value = value == null ? '' : value;
        inp.addEventListener('input', () =>
          commit(field.numeric ? (inp.value === '' ? '' : Number(inp.value)) : inp.value)
        );
        ctl.appendChild(inp);
        return wrap;
      }
      const options = (typeof field.options === 'function' ? field.options() : field.options || []).slice();
      if (!field.req) options.unshift({ value: '', label: '—' });
      // 导入的脚本可能带表里没有的编号或名字，原样留在下拉里
      if (value !== '' && value != null && !options.some((o) => String(o.value) === String(value))) {
        options.unshift({ value: String(value), label: String(value) });
      }
      const sel = makeSelect(options, value == null ? '' : value, commit);
      ctl.appendChild(sel);
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
          const inp = el('input', 'control control--mono');
          inp.type = 'number';
          const raw = block.data ? block.data[key] : '';
          inp.value = raw == null ? '' : raw;
          inp.addEventListener('input', () => {
            if (!block.data) block.data = {};
            block.data[key] = inp.value === '' ? '' : Number(inp.value);
            patchBlock(block);
          });
          item.appendChild(inp);
          box.appendChild(item);
        });
        ctl.appendChild(box);
        return wrap;
      }
      const hit = spritePick(block);
      const body = hit && hit.body;
      if (!spriteSource().length) {
        ctl.appendChild(el('span', 'field__note', '先扫描游戏目录'));
        return wrap;
      }
      const btn = el('button', 'sprite-pick');
      btn.type = 'button';
      const label = hit ? esc(hit.ch.name + ' ' + hit.cloth) : '';
      const size = body ? body.w + '×' + body.h : '缺图';
      btn.innerHTML = hit
        ? (body && body.thumb
            ? '<img class="sprite-pick__thumb" src="' + esc(body.thumb) + '" alt="">'
            : '<img class="sprite-pick__thumb"' + (body && body.entry ? ' data-res="' + esc(JSON.stringify(body.entry)) + '"' : '') + ' alt="">') +
          '<span class="sprite-pick__text"><b>' + label + '</b><em>' + size + '</em></span>' +
          '<span class="sprite-pick__cue">更换</span>'
        : '<span class="sprite-pick__empty">选择立绘</span><span class="sprite-pick__cue">选择</span>';
      btn.addEventListener('click', () => openSpritePicker(block));
      ctl.appendChild(btn);
    } else if (field.type === 'chaPick') {
      if (!hasMapping()) {
        const inp = el('input', 'control control--mono');
        inp.type = 'number';
        inp.value = value == null ? '' : value;
        inp.addEventListener('input', () => commit(inp.value === '' ? '' : Number(inp.value)));
        ctl.appendChild(inp);
        return wrap;
      }
      const box = el('div', 'cha-pick');
      const img = el('img', 'cha-pick__thumb');
      img.alt = '';
      const paintImg = () => {
        const ch = spriteCharByCha(block.data[field.key]);
        const first = ch ? ch.bodies[(ch.poseNos[0] == null ? 1 : ch.poseNos[0]) + '|' + (ch.clothNos[0] == null ? 0 : ch.clothNos[0])] : null;
        if (first && first.thumb) {
          img.src = first.thumb;
          img.hidden = false;
        } else if (first && first.entry) {
          img.removeAttribute('src');
          img.dataset.res = JSON.stringify(first.entry);
          img.hidden = false;
          hydrateSpriteImages(box);
        } else {
          img.hidden = true;
        }
      };
      paintImg();
      const options = spriteSource().filter((c) => c.cha != null).map((c) => ({ value: c.cha, label: c.name }));
      const sel = options.length
        ? makeSelect(options, block.data[field.key], (v) => {
            if (!block.data) block.data = {};
            block.data[field.key] = Number(v);
            paintImg();
            patchBlock(block);
          })
        : el('span', 'field__note', '先扫描游戏目录');
      box.appendChild(img);
      box.appendChild(sel);
      ctl.appendChild(box);
    } else if (field.type === 'segmented') {
      const box = el('div', 'segmented');
      box.setAttribute('role', 'radiogroup');
      (field.options || []).forEach((raw) => {
        const opt = typeof raw === 'string' ? { value: raw, label: raw } : raw;
        const b = el('button', 'segmented__item' + (opt.value === value ? ' is-on' : ''));
        b.type = 'button';
        b.textContent = opt.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', opt.value === value ? 'true' : 'false');
        b.addEventListener('click', () => {
          commit(opt.value);
          Array.prototype.forEach.call(box.children, (c) => {
            const on = c === b;
            c.classList.toggle('is-on', on);
            c.setAttribute('aria-checked', on ? 'true' : 'false');
          });
        });
        box.appendChild(b);
      });
      ctl.appendChild(box);
    } else if (field.type === 'switch') {
      const row = el('div', 'switch-row');
      row.appendChild(
        el('div', 'switch-row__text', '<div class="switch-row__name">' + esc(field.label) + '</div>' + (field.desc ? '<div class="switch-row__desc">' + esc(field.desc) + '</div>' : ''))
      );
      const sw = el('button', 'switch' + (value ? ' is-on' : ''));
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', value ? 'true' : 'false');
      sw.setAttribute('aria-label', field.label || '开关');
      sw.addEventListener('click', () => {
        const next = !block.data[field.key];
        commit(next);
        sw.classList.toggle('is-on', next);
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
      });
      row.appendChild(sw);
      ctl.appendChild(row);
    } else if (field.type === 'slider') {
      const row = el('div', 'slider-row');
      const range = el('input', 'slider');
      range.type = 'range';
      range.min = field.min != null ? field.min : 0;
      range.max = field.max != null ? field.max : 100;
      range.step = field.step != null ? field.step : 1;
      range.value = value == null ? range.min : value;
      range.setAttribute('aria-label', field.label || '数值');
      const unit = field.unit || '';
      const out = el('span', 'slider-row__value', esc(range.value + unit));
      range.addEventListener('input', () => {
        out.textContent = range.value + unit;
        commit(Number(range.value));
      });
      row.appendChild(range);
      row.appendChild(out);
      ctl.appendChild(row);
    } else if (field.type === 'options') {
      const list = value || [];
      const dl = document.createElement('datalist');
      dl.id = 'dl-labels-' + block.id;
      allLabels().forEach((name) => {
        const o = document.createElement('option');
        o.value = name;
        dl.appendChild(o);
      });
      wrap.appendChild(dl);
      list.forEach((item, i) => {
        const row = el('div', 'opt-row');
        const txt = el('input', 'control');
        txt.type = 'text';
        txt.placeholder = '选项文本';
        txt.value = item.text || '';
        txt.addEventListener('input', () => {
          item.text = txt.value;
          patchBlock(block);
        });

        const tgt = el('input', 'control control--mono');
        tgt.type = 'text';
        tgt.placeholder = '标签';
        tgt.value = bareName(item.target);
        tgt.setAttribute('list', 'dl-labels-' + block.id);
        tgt.setAttribute('aria-label', '第 ' + (i + 1) + ' 项的跳转标签');
        tgt.addEventListener('input', () => {
          item.target = tgt.value;
          patchBlock(block);
        });

        const rm = el('button', 'btn-ghost btn-ghost--icon');
        rm.type = 'button';
        rm.setAttribute('aria-label', '删除选项');
        rm.innerHTML = icon('trash-2', 'icon icon--14');
        rm.addEventListener('click', () => {
          list.splice(i, 1);
          commit(list);
          renderInspector();
        });

        row.appendChild(txt);
        row.appendChild(tgt);
        row.appendChild(rm);
        wrap.appendChild(row);
      });

      const add = el('button', 'btn-ghost', icon('plus', 'icon icon--14') + '<span>添加选项</span>');
      add.type = 'button';
      add.addEventListener('click', () => {
        list.push({ text: '', target: '' });
        commit(list);
        renderInspector();
      });
      wrap.appendChild(add);
    }

    if (!stacked) wrap.appendChild(ctl);

    if (field.note) {
      const txt = field.note(block.data || {});
      if (txt) (stacked ? wrap : ctl).appendChild(el('span', 'field__note', esc(txt)));
    }
    return wrap;
  }

  /* Ctrl+B：把选中的文字包成着重注解，再按一次去掉 */
  function bindEmphasisShortcut(control) {
    control.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (String(e.key).toLowerCase() !== 'b') return;
      if (control.selectionStart == null || control.selectionEnd == null || control.selectionStart === control.selectionEnd) return;
      e.preventDefault();
      e.stopPropagation();
      toggleEmphasis(control);
    });
  }

  function toggleEmphasis(control) {
    const start = control.selectionStart;
    const end = control.selectionEnd;
    if (start == null || end == null || start === end) return;
    const selected = control.value.slice(start, end);
    const tokens = selected.match(/\[·\|[^\]\r\n]\]/gu);
    let next;
    if (tokens && tokens.join('') === selected) {
      next = tokens.map((t) => t.slice(3, -1)).join('');
    } else {
      next = Array.from(selected)
        .map((ch) => (/[\s~]/.test(ch) ? ch : '[·|' + ch + ']'))
        .join('');
    }
    if (next === selected) return;
    control.setRangeText(next, start, end, 'end');
    control.selectionStart = start;
    control.selectionEnd = start + next.length;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 只重建被改动的那一块，避免输入时整页重绘 */
  function patchBlock(block) {
    const old =
      mainEl.querySelector('[data-block-wrap="' + block.id + '"]') ||
      mainEl.querySelector('[data-block-id="' + block.id + '"]');
    const hit = listOfBlock(block.id);
    if (!old || !hit) return;
    old.replaceWith(blockNode(block, hit.scene, hit.list));
    touch('patch:' + block.id);
    if (typeof renderPreview === 'function') renderPreview();
    // 多选时右栏是批量标题/字段，不能被单块的标题覆盖
    if (selectedBlocks().length > 1) return;
    const v = viewOf(block);
    const title = inspector.querySelector('.inspector-title');
    if (title) title.textContent = v.speaker ? v.speaker + '：' + v.text : v.text;
    const body = inspector.querySelector('.inspector-body');
    const oldWire = inspector.querySelector('.wire-set');
    const nextWire = wireSet(block);
    if (oldWire) oldWire.remove();
    if (nextWire && body) body.insertBefore(nextWire, body.firstChild);
    const code = inspector.querySelector('.inspector-code');
    if (code) code.textContent = v.code ? v.code.join('\n') : '';
    if (!code && v.code) {
      const fresh = el('pre', 'inspector-code', esc(v.code.join('\n')));
      const head = inspector.querySelector('.inspector-head');
      if (head) head.appendChild(fresh);
    }
  }

  /* ------------------------------------------------------------------ *
   * 立绘选择器：读 graph_bs 的缩略图与表情表
   * ------------------------------------------------------------------ */

  let spriteModal = null;

  function closeSpritePicker() {
    if (!spriteModal) return;
    spriteModal.remove();
    spriteModal = null;
    document.removeEventListener('keydown', onSpriteKey, true);
  }

  function onSpriteKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeSpritePicker();
    }
  }

  function spriteImgTag(cloth, cls) {
    const cl = cls ? ' class="' + cls + '"' : '';
    if (cloth.thumb) return '<img' + cl + ' src="' + esc(cloth.thumb) + '" alt="">';
    if (cloth.entry) return '<img' + cl + ' data-res="' + esc(JSON.stringify(cloth.entry)) + '" alt="">';
    return '<img' + cl + ' alt="">';
  }

  function hydrateSpriteImages(root) {
    if (!window.RES || window.RES.mode() !== 'scan') return;
    root.querySelectorAll('img[data-res]').forEach(async (img) => {
      const entry = JSON.parse(img.dataset.res);
      const url = await window.RES.thumb(entry, 160);
      if (url) img.src = url;
    });
    root.querySelectorAll('img[data-bg],img[data-cg]').forEach(async (img) => {
      const raw = img.dataset.bg || img.dataset.cg;
      if (!raw) return;
      const entry = JSON.parse(raw);
      const url = await window.RES.thumb(entry, 960);
      if (url && img.isConnected) img.src = url;
    });
  }

  async function hydrateSpriteSheet(root, sheet) {
    if (!sheet || !sheet.entry || !window.RES || window.RES.mode() !== 'scan') return;
    const box = root.querySelector('.spk__faces');
    if (!box) return;
    const data = await window.RES.sheet(sheet.entry, 420);
    if (!data || !box.isConnected) return;
    const DW = 46;
    const scale = DW / data.tw;
    const dh = data.th * scale;
    box.querySelectorAll('.spk-face').forEach((b, i) => {
      if (b.disabled) return;
      const col = i % data.cols;
      const row = Math.floor(i / data.cols);
      b.style.backgroundImage = 'url(' + data.dataUrl + ')';
      b.style.backgroundSize = (data.tw * data.cols * scale).toFixed(1) + 'px ' + (data.th * data.rows * scale).toFixed(1) + 'px';
      b.style.backgroundPosition = '-' + col * DW + 'px -' + (row * dh).toFixed(1) + 'px';
    });
  }

  function openSpritePicker(block, targets) {
    closeSpritePicker();
    const chars = spriteSource().filter((c) => c.cha != null && c.poses.length && c.cloths.length);
    if (!chars.length) return;

    let ch = spriteCharByCha(block.data.cha) || chars[0];
    let pi = ch.poseNos.indexOf(Number(block.data.pose));
    if (pi < 0) pi = 0;
    let ci = ch.clothNos.indexOf(Number(block.data.cloth));
    if (ci < 0) ci = 0;
    let face = Math.max(1, Number(block.data.face) || 1);
    let faceTouched = false;
    let sideSeq = 0;

    const keyOf = () => (ch.poseNos[pi] == null ? 1 : ch.poseNos[pi]) + '|' + (ch.clothNos[ci] == null ? 0 : ch.clothNos[ci]);
    const bodyOf = () => ch.bodies[keyOf()] || null;
    const sheetOf = () => ch.sheets[keyOf()] || null;

    const overlay = el('div', 'modal');
    const scrim = el('div', 'modal__scrim');
    const panel = el('div', 'modal__panel spk');
    overlay.appendChild(scrim);
    overlay.appendChild(panel);

    panel.innerHTML =
      '<div class="spk__head"><b>选择立绘</b>' +
      '<button class="btn-ghost btn-ghost--icon spk__x" type="button" aria-label="关闭">' +
      icon('x', 'icon icon--14') +
      '</button></div>' +
      '<div class="spk__body"><div class="spk__chars"></div><div class="spk__mid"></div><div class="spk__faces-wrap"></div><div class="spk__side"></div></div>' +
      '<div class="spk__foot">' +
      '<button class="btn-ghost spk__cancel" type="button">取消</button>' +
      '<button class="btn-primary spk__ok" type="button">使用</button></div>';

    const charsEl = panel.querySelector('.spk__chars');
    const midEl = panel.querySelector('.spk__mid');
    const facesEl = panel.querySelector('.spk__faces-wrap');
    const sideEl = panel.querySelector('.spk__side');

    const firstBody = (c) => c.bodies[(c.poseNos[0] == null ? 1 : c.poseNos[0]) + '|' + (c.clothNos[0] == null ? 0 : c.clothNos[0])] || null;

    const paintChars = () => {
      charsEl.innerHTML = chars
        .map(
          (c, i) =>
            '<button class="spk-char' + (c === ch ? ' is-on' : '') + '" type="button" data-char="' + i + '">' +
            spriteImgTag(firstBody(c) || {}, '') +
            '<span class="spk-char__name">' + esc(c.name) + '</span></button>'
        )
        .join('');
    };

    const paintMid = () => {
      const poses =
        ch.poses.length > 1
          ? '<div class="spk__label">姿势</div><div class="spk__poses">' +
            ch.poses
              .map(
                (p, i) =>
                  '<button class="spk-pose' + (i === pi ? ' is-on' : '') + '" type="button" data-pose="' + i + '">' + esc(p) + '</button>'
              )
              .join('') +
            '</div>'
          : '';
      const cloths = ch.cloths
        .map((name, i) => {
          const body = ch.bodies[(ch.poseNos[pi] == null ? 1 : ch.poseNos[pi]) + '|' + (ch.clothNos[i] == null ? 0 : ch.clothNos[i])];
          return (
            '<button class="spk-cloth' + (i === ci ? ' is-on' : '') + (body ? '' : ' is-missing') + '" type="button" data-cloth="' + i + '"' +
            (body ? '' : ' disabled') + '>' +
            spriteImgTag(body || {}, '') +
            '<span class="spk-cloth__name">' + esc(name) + '</span>' +
            '<span class="spk-cloth__size">' + (body ? body.w + '×' + body.h : '缺图') + '</span></button>'
          );
        })
        .join('');
      midEl.innerHTML = poses + '<div class="spk__label">衣装</div><div class="spk__cloths">' + cloths + '</div>';
    };

    const paintFaces = () => {
      const s = sheetOf();
      if (!s) {
        facesEl.innerHTML = '<div class="spk__label">表情表</div><p class="note-line">这一组没有表情表</p>';
        return;
      }
      const DW = 46;
      const scale = DW / s.tw;
      const dh = s.th * scale;
      const cells = [];
      for (let i = 0; i < s.cols * s.rows; i++) {
        const col = i % s.cols;
        const row = Math.floor(i / s.cols);
        const on = i + 1 === face;
        const empty = i >= s.cells;
        const bgStyle = s.file
          ? 'background-image:url(' + s.file + ');background-size:' +
            (s.tw * s.cols * scale).toFixed(1) + 'px ' + (s.th * s.rows * scale).toFixed(1) + 'px;background-position:-' +
            col * DW + 'px -' + (row * dh).toFixed(1) + 'px'
          : '';
        cells.push(
          '<button class="spk-face' + (on ? ' is-on' : '') + (empty ? ' is-empty' : '') + '" type="button" data-face="' + (i + 1) + '"' +
            (empty ? ' disabled' : '') +
            ' style="width:' + DW + 'px;height:' + dh.toFixed(1) + 'px;' + bgStyle + '"></button>'
        );
      }
      const note = face > s.cells ? '<span class="spk__hint">原值 ' + face + ' 未映射</span>' : '';
      facesEl.innerHTML = '<div class="spk__label">表情表 <em>' + s.cells + ' 格</em>' + note + '</div>' + '<div class="spk__faces">' + cells.join('') + '</div>';
    };

    const loadImage = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });

    const paintSide = () => {
      const body = bodyOf();
      const sheet = sheetOf();
      const file = body && (body.file || (body.entry && body.entry.path ? body.entry.path.split(/[\\/]/).pop() : ''));
      const seq = ++sideSeq;
      sideEl.innerHTML =
        '<div class="spk__label">预览</div>' +
        '<div class="spk__shot">' + (body ? '<canvas class="spk__canvas" aria-label="立绘预览"></canvas>' : '<span class="spk__empty">缺图</span>') + '</div>' +
        '<div class="spk__meta"><b>' + esc(ch.name) + ' ' + esc(ch.cloths[ci]) + '</b>' +
        '<span>' + (body ? body.w + '×' + body.h + ' 全身' : '这个组合没有立绘') + '</span>' +
        '<span class="spk__file">' + esc(file || '') + '</span></div>';
      if (!body || !window.RES) return;
      const canvas = sideEl.querySelector('.spk__canvas');
      if (!canvas) return;
      const bodyUrl = window.RES.thumb(body.entry, body.w);
      const sheetUrl = sheet ? window.RES.sheet(sheet.entry, sheet.cellW * (sheet.cols || 6)) : Promise.resolve(null);
      Promise.all([bodyUrl, sheetUrl])
        .then(async ([bodyData, sheetData]) => {
          if (seq !== sideSeq || !canvas.isConnected || !bodyData) return;
          const bodyImg = await loadImage(bodyData);
          const sheetImg = sheetData ? await loadImage(sheetData.dataUrl) : null;
          if (seq !== sideSeq || !canvas.isConnected) return;
          const bw = body.w || bodyImg.naturalWidth;
          const bh = body.h || bodyImg.naturalHeight;
          const scale = Math.min(150 / bw, 210 / bh, 1);
          canvas.width = Math.max(1, Math.round(bw * scale));
          canvas.height = Math.max(1, Math.round(bh * scale));
          canvas.style.width = canvas.width + 'px';
          canvas.style.height = canvas.height + 'px';
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bodyImg, 0, 0, canvas.width, canvas.height);
          if (sheetImg && sheetData) {
            const cols = sheetData.cols || 6;
            const cellCount = sheetData.cells || 1;
            const idx = Math.max(0, Math.min(cellCount - 1, face - 1));
            const sx = (idx % cols) * sheetData.cellW;
            const sy = Math.floor(idx / cols) * sheetData.cellH;
            const fx = (sheet.faceX || 0) * scale;
            const fy = (sheet.faceY || 0) * scale;
            ctx.drawImage(
              sheetImg,
              sx,
              sy,
              sheetData.cellW,
              sheetData.cellH,
              fx,
              fy,
              sheetData.cellW * scale,
              sheetData.cellH * scale
            );
          }
        })
        .catch(() => {});
    };

    const paintAll = () => {
      paintChars();
      paintMid();
      paintFaces();
      paintSide();
      hydrateSpriteImages(panel);
      hydrateSpriteSheet(panel, sheetOf());
    };

    panel.addEventListener('click', (e) => {
      const cb = e.target.closest('[data-char]');
      if (cb) {
        ch = chars[Number(cb.dataset.char)];
        pi = 0;
        ci = 0;
        face = 1;
        faceTouched = true;
        paintAll();
        return;
      }
      const pb = e.target.closest('[data-pose]');
      if (pb) {
        pi = Number(pb.dataset.pose);
        paintAll();
        return;
      }
      const cl = e.target.closest('[data-cloth]');
      if (cl) {
        ci = Number(cl.dataset.cloth);
        paintAll();
        return;
      }
      const fc = e.target.closest('[data-face]');
      if (fc) {
        face = Number(fc.dataset.face);
        faceTouched = true;
        paintFaces();
        paintSide();
        hydrateSpriteSheet(panel, sheetOf());
      }
    });

    panel.querySelector('.spk__x').addEventListener('click', closeSpritePicker);
    panel.querySelector('.spk__cancel').addEventListener('click', closeSpritePicker);
    scrim.addEventListener('click', closeSpritePicker);
    panel.querySelector('.spk__ok').addEventListener('click', () => {
      const list = targets && targets.length ? targets : [block];
      const apply = () => {
        list.forEach((b) => {
          if (!b.data) b.data = {};
          b.data.cha = ch.cha;
          b.data.pose = ch.poseNos[pi];
          b.data.cloth = ch.clothNos[ci];
          if (faceTouched) b.data.face = face;
          patchBlock(b);
        });
      };
      if (window.HISTORY) window.HISTORY.batch(apply);
      else apply();
      if (window.HISTORY) window.HISTORY.commit('sprite');
      closeSpritePicker();
      renderInspector();
    });

    paintAll();
    document.body.appendChild(overlay);
    hydrateSpriteImages(panel);
    hydrateSpriteSheet(panel, sheetOf());
    spriteModal = overlay;
    document.addEventListener('keydown', onSpriteKey, true);
  }

