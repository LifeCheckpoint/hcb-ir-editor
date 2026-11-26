/* ==========================================================================
   hcb-ir-editor · 项目设置
   这些值属于项目文件，不属于编辑器偏好；旧项目没有 settings 时按默认值补。
   ========================================================================== */

'use strict';

const PROJECT_SETTINGS_DEFAULT = {
  stage: {
    width: 1600,
    height: 900,
    bottom: 0,
    anchors: { l: 465, m: 800, r: 1135 },
  },
  depth: {
    sprite: 1000,
    background: 1000,
    cg: 1000,
  },
  image: {
    zoom: 100,
  },
  sprite: {
    height: 76,
    maxWidth: 36,
    focal: 1000,
    anchorY: 21,
    pivotX: 0,
    pivotY: 0,
  },
};

let projectSettingsState = normalizeProjectSettings(null);
let projectSettingsModal = null;
let projectSettingsKeyHandler = null;

function cloneProjectSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function settingsInt(value, min, max, fallback) {
  if (value === '' || value == null) return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function settingsNum(value, min, max, fallback) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10;
}

function normalizeProjectSettings(raw) {
  const D = PROJECT_SETTINGS_DEFAULT;
  const src = raw && typeof raw === 'object' ? raw : {};
  const stageSrc = src.stage && typeof src.stage === 'object' ? src.stage : {};
  const width = settingsInt(stageSrc.width, 320, 7680, D.stage.width);
  const height = settingsInt(stageSrc.height, 320, 7680, D.stage.height);
  const anchorsSrc = stageSrc.anchors && typeof stageSrc.anchors === 'object' ? stageSrc.anchors : {};
  // 上一版把游戏窗口尺寸 1280x720 误当成了虚拟舞台；实机 base 的虚拟画面是 1600x900。
  // 只迁移“旧默认值”项目，用户手改过其它尺寸/缩放时保持原样。
  const legacyPreview =
    width === 1280 &&
    height === 720 &&
    ((src.image && Number(src.image.zoom) === 125) ||
      (spriteSrc.anchorY != null && Number(spriteSrc.anchorY) === 47.6));
  const stageWidth = legacyPreview ? D.stage.width : width;
  const stageHeight = legacyPreview ? D.stage.height : height;
  const depthSrc = src.depth && typeof src.depth === 'object' ? src.depth : {};
  const spriteSrc = src.sprite && typeof src.sprite === 'object' ? src.sprite : {};
  return {
    stage: {
      width: stageWidth,
      height: stageHeight,
      bottom: settingsInt(stageSrc.bottom, 0, stageHeight, D.stage.bottom),
      anchors: legacyPreview
        ? { ...D.stage.anchors }
        : {
            l: settingsInt(anchorsSrc.l, 0, stageWidth, D.stage.anchors.l),
            m: settingsInt(anchorsSrc.m, 0, stageWidth, D.stage.anchors.m),
            r: settingsInt(anchorsSrc.r, 0, stageWidth, D.stage.anchors.r),
          },
    },
    depth: {
      sprite: settingsInt(depthSrc.sprite, 100, 10000, D.depth.sprite),
      background: settingsInt(depthSrc.background, 100, 10000, D.depth.background),
      cg: settingsInt(depthSrc.cg, 100, 10000, D.depth.cg),
    },
    image: {
      zoom: legacyPreview ? D.image.zoom : settingsNum(src.image && src.image.zoom, 50, 200, D.image.zoom),
    },
    sprite: {
      height: settingsNum(spriteSrc.height, 10, 200, D.sprite.height),
      maxWidth: settingsNum(spriteSrc.maxWidth, 5, 100, D.sprite.maxWidth),
      focal: settingsNum(spriteSrc.focal, 100, 10000, D.sprite.focal),
      anchorY: legacyPreview ? D.sprite.anchorY : settingsNum(spriteSrc.anchorY, 0, 100, D.sprite.anchorY),
      pivotX: legacyPreview ? D.sprite.pivotX : settingsNum(spriteSrc.pivotX, 0, 100, D.sprite.pivotX),
      pivotY: legacyPreview ? D.sprite.pivotY : settingsNum(spriteSrc.pivotY, 0, 100, D.sprite.pivotY),
    },
  };
}

function getProjectSettings() {
  return projectSettingsState;
}

function loadProjectSettings(raw) {
  projectSettingsState = normalizeProjectSettings(raw);
  return projectSettingsState;
}

function serializeProjectSettings() {
  return cloneProjectSettings(projectSettingsState);
}

function resetProjectSettings() {
  projectSettingsState = normalizeProjectSettings(null);
  return projectSettingsState;
}

function setProjectSettings(raw, opts) {
  projectSettingsState = normalizeProjectSettings(raw);
  if (!opts || !opts.silent) {
    if (window.PROJECT && typeof window.PROJECT.settingsChanged === 'function') {
      window.PROJECT.settingsChanged();
    } else {
      if (typeof invalidateStageCache === 'function') invalidateStageCache();
      if (typeof renderInspector === 'function') renderInspector();
      if (typeof renderPreview === 'function') renderPreview({ bulk: false });
    }
  }
  return projectSettingsState;
}

function closeProjectSettingsDialog() {
  if (!projectSettingsModal) return;
  if (projectSettingsKeyHandler) {
    document.removeEventListener('keydown', projectSettingsKeyHandler, true);
    projectSettingsKeyHandler = null;
  }
  projectSettingsModal.remove();
  projectSettingsModal = null;
}

function openProjectSettingsDialog() {
  closeProjectSettingsDialog();
  if (typeof closePalette === 'function') closePalette();

  const settings = getProjectSettings();
  const overlay = el('div', 'modal');
  const panel = el('div', 'modal__panel imp project-settings');
  const scrim = el('div', 'modal__scrim');
  overlay.appendChild(scrim);
  overlay.appendChild(panel);

  const head = el('div', 'imp__head');
  head.innerHTML =
    '<b>项目设置</b>' +
    '<button class="btn-ghost btn-ghost--icon imp__x" type="button" aria-label="关闭">' +
    icon('x', 'icon icon--14') +
    '</button>';
  panel.appendChild(head);

  const body = el('div', 'imp__body project-settings__body');
  panel.appendChild(body);

  const inputs = {};
  const field = (key, value, opts) => {
    opts = opts || {};
    const wrap = el('div', 'project-settings__control');
    const input = el('input', 'control project-settings__input');
    input.type = 'number';
    input.step = opts.step == null ? '1' : String(opts.step);
    input.min = String(opts.min == null ? '' : opts.min);
    input.max = String(opts.max == null ? '' : opts.max);
    input.value = value;
    input.dataset.setting = key;
    input.addEventListener('input', clearSettingsError);
    wrap.appendChild(input);
    if (opts.unit) wrap.appendChild(el('span', 'unit', opts.unit));
    inputs[key] = input;
    return wrap;
  };
  const row = (label, controls) => {
    const line = el('div', 'project-settings__row');
    line.appendChild(el('span', 'project-settings__label', esc(label)));
    const ctl = el('div', 'project-settings__controls');
    (Array.isArray(controls) ? controls : [controls]).forEach((node) => ctl.appendChild(node));
    line.appendChild(ctl);
    return line;
  };
  const group = (title) => {
    const section = el('section', 'project-settings__group');
    section.appendChild(el('div', 'project-settings__title', esc(title)));
    body.appendChild(section);
    return section;
  };
  const anchorField = (label, key, value) => {
    const wrap = el('label', 'project-settings__anchor');
    wrap.appendChild(el('span', 'project-settings__anchor-label', esc(label)));
    wrap.appendChild(field(key, value, { min: 0, max: settings.stage.width, unit: 'px' }));
    return wrap;
  };

  const stageGroup = group('舞台');
  const sizeRow = el('div', 'project-settings__pair');
  sizeRow.appendChild(field('stage.width', settings.stage.width, { min: 320, max: 7680, unit: 'px' }));
  sizeRow.appendChild(el('span', 'project-settings__times', '×'));
  sizeRow.appendChild(field('stage.height', settings.stage.height, { min: 320, max: 7680, unit: 'px' }));
  stageGroup.appendChild(row('虚拟分辨率', sizeRow));

  const anchorRow = el('div', 'project-settings__anchors');
  anchorRow.appendChild(anchorField('左', 'stage.l', settings.stage.anchors.l));
  anchorRow.appendChild(anchorField('中', 'stage.m', settings.stage.anchors.m));
  anchorRow.appendChild(anchorField('右', 'stage.r', settings.stage.anchors.r));
  stageGroup.appendChild(row('站位锚点', anchorRow));

  stageGroup.appendChild(
    row('底部基线', field('stage.bottom', settings.stage.bottom, { min: 0, max: settings.stage.height, unit: 'px' }))
  );

  const depthGroup = group('深度');
  depthGroup.appendChild(row('立绘默认 z', field('depth.sprite', settings.depth.sprite, { min: 100, max: 10000 })));
  depthGroup.appendChild(row('背景 z', field('depth.background', settings.depth.background, { min: 100, max: 10000 })));
  depthGroup.appendChild(row('CG z', field('depth.cg', settings.depth.cg, { min: 100, max: 10000 })));
  depthGroup.appendChild(row('背景缩放', field('image.zoom', settings.image.zoom, { min: 50, max: 200, step: 0.1, unit: '%' })));

  const spriteGroup = group('立绘显示');
  spriteGroup.appendChild(
    row('兜底高度', field('sprite.height', settings.sprite.height, { min: 10, max: 200, step: 0.1, unit: '%' }))
  );
  spriteGroup.appendChild(
    row('兜底最大宽度', field('sprite.maxWidth', settings.sprite.maxWidth, { min: 5, max: 100, step: 0.1, unit: '%' }))
  );
  spriteGroup.appendChild(
    row('焦距', field('sprite.focal', settings.sprite.focal, { min: 100, max: 10000, unit: 'px' }))
  );
  spriteGroup.appendChild(
    row('纵向锚点', field('sprite.anchorY', settings.sprite.anchorY, { min: 0, max: 100, step: 0.1, unit: '%' }))
  );
  const pivotRow = el('div', 'project-settings__pair');
  pivotRow.appendChild(field('sprite.pivotX', settings.sprite.pivotX, { min: 0, max: 100, step: 0.1, unit: '%' }));
  pivotRow.appendChild(el('span', 'project-settings__times', '/'));
  pivotRow.appendChild(field('sprite.pivotY', settings.sprite.pivotY, { min: 0, max: 100, step: 0.1, unit: '%' }));
  spriteGroup.appendChild(row('图内锚点', pivotRow));

  const error = el('div', 'project-settings__error');
  error.hidden = true;
  body.appendChild(error);

  const foot = el('div', 'imp__foot project-settings__foot');
  const reset = el('button', 'btn-ghost project-settings__reset', '恢复默认');
  reset.type = 'button';
  const cancel = el('button', 'btn-ghost', '取消');
  cancel.type = 'button';
  const apply = el('button', 'btn-primary', '应用');
  apply.type = 'button';
  foot.appendChild(reset);
  foot.appendChild(cancel);
  foot.appendChild(apply);
  panel.appendChild(foot);

  function clearSettingsError() {
    error.hidden = true;
    error.textContent = '';
    panel.querySelectorAll('.is-invalid').forEach((n) => n.classList.remove('is-invalid'));
  }

  function readNumber(key, label, min, max, integer) {
    const input = inputs[key];
    const raw = String(input.value == null ? '' : input.value).trim();
    const value = Number(raw);
    const ok =
      raw !== '' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value));
    if (!ok) {
      input.classList.add('is-invalid');
      error.hidden = false;
      error.textContent = error.textContent || label + ' 不是有效数值';
    }
    return ok ? value : null;
  }

  function fill(settingsValue) {
    clearSettingsError();
    inputs['stage.width'].value = settingsValue.stage.width;
    inputs['stage.height'].value = settingsValue.stage.height;
    inputs['stage.bottom'].value = settingsValue.stage.bottom;
    inputs['stage.l'].value = settingsValue.stage.anchors.l;
    inputs['stage.m'].value = settingsValue.stage.anchors.m;
    inputs['stage.r'].value = settingsValue.stage.anchors.r;
    inputs['depth.sprite'].value = settingsValue.depth.sprite;
    inputs['depth.background'].value = settingsValue.depth.background;
    inputs['depth.cg'].value = settingsValue.depth.cg;
    inputs['image.zoom'].value = settingsValue.image.zoom;
    inputs['sprite.height'].value = settingsValue.sprite.height;
    inputs['sprite.maxWidth'].value = settingsValue.sprite.maxWidth;
    inputs['sprite.focal'].value = settingsValue.sprite.focal;
    inputs['sprite.anchorY'].value = settingsValue.sprite.anchorY;
    inputs['sprite.pivotX'].value = settingsValue.sprite.pivotX;
    inputs['sprite.pivotY'].value = settingsValue.sprite.pivotY;
  }

  function applySettings() {
    clearSettingsError();
    const width = readNumber('stage.width', '宽度', 320, 7680, true);
    const height = readNumber('stage.height', '高度', 320, 7680, true);
    if (width == null || height == null) return;
    const bottom = readNumber('stage.bottom', '底部基线', 0, height, true);
    const left = readNumber('stage.l', '左锚点', 0, width, true);
    const middle = readNumber('stage.m', '中锚点', 0, width, true);
    const right = readNumber('stage.r', '右锚点', 0, width, true);
    const spriteZ = readNumber('depth.sprite', '立绘 z', 100, 10000, true);
    const backgroundZ = readNumber('depth.background', '背景 z', 100, 10000, true);
    const cgZ = readNumber('depth.cg', 'CG z', 100, 10000, true);
    const imageZoom = readNumber('image.zoom', '背景缩放', 50, 200, false);
    const spriteHeight = readNumber('sprite.height', '立绘高度', 10, 200, false);
    const spriteMaxWidth = readNumber('sprite.maxWidth', '立绘最大宽度', 5, 100, false);
    const spriteFocal = readNumber('sprite.focal', '焦距', 100, 10000, false);
    const spriteAnchorY = readNumber('sprite.anchorY', '纵向锚点', 0, 100, false);
    const spritePivotX = readNumber('sprite.pivotX', '图内锚点 X', 0, 100, false);
    const spritePivotY = readNumber('sprite.pivotY', '图内锚点 Y', 0, 100, false);
    if (
      bottom == null ||
      left == null ||
      middle == null ||
      right == null ||
      spriteZ == null ||
      backgroundZ == null ||
      cgZ == null ||
      imageZoom == null ||
      spriteHeight == null ||
      spriteMaxWidth == null ||
      spriteFocal == null ||
      spriteAnchorY == null ||
      spritePivotX == null ||
      spritePivotY == null
    ) {
      return;
    }
    const next = normalizeProjectSettings({
      stage: { width, height, bottom, anchors: { l: left, m: middle, r: right } },
      depth: { sprite: spriteZ, background: backgroundZ, cg: cgZ },
      image: { zoom: imageZoom },
      sprite: {
        height: spriteHeight,
        maxWidth: spriteMaxWidth,
        focal: spriteFocal,
        anchorY: spriteAnchorY,
        pivotX: spritePivotX,
        pivotY: spritePivotY,
      },
    });
    if (JSON.stringify(next) !== JSON.stringify(getProjectSettings())) setProjectSettings(next);
    closeProjectSettingsDialog();
  }

  head.querySelector('.imp__x').addEventListener('click', closeProjectSettingsDialog);
  scrim.addEventListener('click', closeProjectSettingsDialog);
  cancel.addEventListener('click', closeProjectSettingsDialog);
  apply.addEventListener('click', applySettings);
  reset.addEventListener('click', () => fill(normalizeProjectSettings(null)));

  projectSettingsKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeProjectSettingsDialog();
    } else if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('input')) {
      e.preventDefault();
      applySettings();
    }
  };
  document.addEventListener('keydown', projectSettingsKeyHandler, true);

  document.body.appendChild(overlay);
  projectSettingsModal = overlay;
  requestAnimationFrame(() => inputs['stage.width'].focus());
}

/* 菜单里的快捷键。对话框打开时由上面的 key handler 处理 Esc/Enter。 */
document.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey && e.altKey && (e.key === ',' || e.code === 'Comma')) {
      e.preventDefault();
      openProjectSettingsDialog();
    }
  },
  true
);

window.PROJECT_SETTINGS = {
  defaults: () => cloneProjectSettings(PROJECT_SETTINGS_DEFAULT),
  normalize: normalizeProjectSettings,
  get: getProjectSettings,
  load: loadProjectSettings,
  reset: resetProjectSettings,
  serialize: serializeProjectSettings,
  set: setProjectSettings,
  open: openProjectSettingsDialog,
  close: closeProjectSettingsDialog,
};
