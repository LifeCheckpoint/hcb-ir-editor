/* ==========================================================================
   hcb-ir-editor · 模拟预览浮窗
   16:9 浮窗，可拖动、缩放、最小化成圆形按钮；点击画面跳到下一个功能块。
   ========================================================================== */

'use strict';

let previewEl = null;
let previewStage = null;
let previewEmpty = null;
let previewBody = null;
let previewAudioBtn = null;
let previewNextBtn = null;
let previewMinBtn = null;
let previewResize = null;
let previewBubble = null;

let previewWidth = 480;
let previewLeft = 0;
let previewTop = 64;
let previewMin = false;
let previewRestore = null;
let previewAnimTimer = null;
let previewBlockId = null;

let previewDrag = null;
let previewResizing = null;
let previewBubbleDrag = null;
let previewBubbleMoved = false;

let bgmAudio = null;
let bgmKey = '';
let bgmPaused = false;
let bgmToken = 0;
const bgmUrls = new Map();

function previewClamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function previewMaxWidth() {
  return Math.max(320, Math.min(920, Math.floor((window.innerHeight - 110) * (16 / 9)), window.innerWidth - 24));
}

function applyPreviewGeometry() {
  if (!previewEl || previewMin) return;
  previewEl.style.width = previewWidth + 'px';
  previewEl.style.left = previewLeft + 'px';
  previewEl.style.top = previewTop + 'px';
  previewEl.style.height = '';
}

function animatePreviewLayout() {
  if (!previewEl) return;
  previewEl.classList.add('is-animating');
  void previewEl.offsetWidth;
  clearTimeout(previewAnimTimer);
  previewAnimTimer = setTimeout(() => previewEl.classList.remove('is-animating'), 220);
}

function setPreviewMinimized(min) {
  if (!previewEl || min === previewMin) return;
  if (min) {
    previewRestore = { right: previewLeft + previewWidth, top: previewTop, width: previewWidth };
    previewMin = true;
    previewEl.classList.add('is-min');
    animatePreviewLayout();
    const right = previewClamp(previewRestore.right, 56, Math.max(56, window.innerWidth - 8));
    previewLeft = previewClamp(right - 48, 8, Math.max(8, window.innerWidth - 56));
    previewTop = previewClamp(previewRestore.top, 8, Math.max(8, window.innerHeight - 56));
    previewEl.style.left = previewLeft + 'px';
    previewEl.style.top = previewTop + 'px';
    previewEl.style.width = '48px';
    previewEl.style.height = '48px';
  } else {
    previewMin = false;
    previewEl.classList.remove('is-min');
    animatePreviewLayout();
    if (previewRestore) {
      previewWidth = previewClamp(previewRestore.width, 320, previewMaxWidth());
      const right = previewClamp(previewRestore.right, previewWidth + 8, Math.max(previewWidth + 8, window.innerWidth - 8));
      previewLeft = previewClamp(right - previewWidth, 8, Math.max(8, window.innerWidth - previewWidth - 8));
      previewTop = previewClamp(previewRestore.top, 8, Math.max(8, window.innerHeight - 60));
    }
    applyPreviewGeometry();
  }
}

function nextPreviewBlock() {
  if (!previewBlockId) return;
  const all = [];
  (CHAPTERS || []).forEach((ch) =>
    (ch.scenes || []).forEach((sc) =>
      flatten(sc.blocks).forEach((b) => {
        if (!isFocusActive() || isFocusType(b.type)) all.push(b);
      })
    )
  );
  const at = all.findIndex((b) => b.id === previewBlockId);
  if (at < 0 || at + 1 >= all.length) return;
  const next = all[at + 1];
  const hit = listOfBlock(next.id);
  if (!hit) return;
  state.chapterId = hit.chapter.id;
  selectBlock(next.id);
}

function initPreview() {
  if (previewEl) return;
  previewEl = el('div', 'preview');
  previewEl.id = 'preview';
  previewEl.setAttribute('role', 'region');
  previewEl.setAttribute('aria-label', '模拟预览');

  const bar = el('div', 'preview__bar');
  bar.appendChild(el('span', 'preview__title', '模拟预览'));
  const actions = el('div', 'preview__actions');
  previewAudioBtn = el('button', 'preview__btn');
  previewAudioBtn.type = 'button';
  previewAudioBtn.disabled = true;
  previewAudioBtn.title = '没有可播放的 BGM';
  previewAudioBtn.setAttribute('aria-label', '暂停 BGM');
  previewAudioBtn.dataset.previewAudio = '';
  previewAudioBtn.innerHTML = icon('pause', 'icon icon--12');
  previewNextBtn = el('button', 'preview__btn');
  previewNextBtn.type = 'button';
  previewNextBtn.title = '下一个功能块';
  previewNextBtn.setAttribute('aria-label', '下一个功能块');
  previewNextBtn.dataset.previewNext = '';
  previewNextBtn.innerHTML = icon('chevron-right', 'icon icon--12');
  previewMinBtn = el('button', 'preview__btn');
  previewMinBtn.type = 'button';
  previewMinBtn.title = '缩小预览';
  previewMinBtn.setAttribute('aria-label', '缩小预览');
  previewMinBtn.dataset.previewMin = '';
  previewMinBtn.innerHTML = icon('chevron-down', 'icon icon--12');
  actions.appendChild(previewAudioBtn);
  actions.appendChild(previewNextBtn);
  actions.appendChild(previewMinBtn);
  bar.appendChild(actions);
  previewEl.appendChild(bar);

  previewBody = el('div', 'preview__body');
  previewBody.title = '点击跳到下一个功能块';
  previewBody.dataset.previewBody = '';
  previewStage = el('div', 'preview__stage');
  previewEmpty = el('div', 'preview__empty', '选择一个功能块');
  previewBody.appendChild(previewStage);
  previewBody.appendChild(previewEmpty);
  previewEl.appendChild(previewBody);

  previewResize = el('div', 'preview__resize');
  previewResize.title = '拖动调整大小';
  previewResize.dataset.previewResize = '';
  previewEl.appendChild(previewResize);

  previewBubble = el('button', 'preview__bubble');
  previewBubble.type = 'button';
  previewBubble.title = '展开模拟预览';
  previewBubble.setAttribute('aria-label', '展开模拟预览');
  previewBubble.dataset.previewBubble = '';
  previewBubble.innerHTML = icon('eye', 'icon icon--16');
  previewEl.appendChild(previewBubble);

  previewWidth = previewClamp(Math.round(window.innerWidth * 0.32), 360, 520);
  previewLeft = Math.max(8, window.innerWidth - previewWidth - 24);
  previewTop = 64;
  applyPreviewGeometry();
  document.body.appendChild(previewEl);

  previewMinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPreviewMinimized(true);
  });
  previewBubble.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    setPreviewMinimized(false);
  });
  previewBubble.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !previewMin) return;
    previewBubbleDrag = { x: e.clientX, y: e.clientY, left: previewLeft, top: previewTop, moved: false };
    previewBubbleMoved = false;
    previewBubble.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  previewBubble.addEventListener('pointermove', (e) => {
    if (!previewBubbleDrag) return;
    const dx = e.clientX - previewBubbleDrag.x;
    const dy = e.clientY - previewBubbleDrag.y;
    if (!previewBubbleDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    previewBubbleDrag.moved = true;
    previewLeft = previewClamp(previewBubbleDrag.left + dx, 8, Math.max(8, window.innerWidth - 56));
    previewTop = previewClamp(previewBubbleDrag.top + dy, 8, Math.max(8, window.innerHeight - 56));
    previewEl.style.left = previewLeft + 'px';
    previewEl.style.top = previewTop + 'px';
    if (previewRestore) {
      previewRestore.right = previewLeft + 48;
      previewRestore.top = previewTop;
    }
  });
  previewBubble.addEventListener('pointerup', () => {
    if (!previewBubbleDrag) return;
    const moved = previewBubbleDrag.moved;
    previewBubbleDrag = null;
    if (moved) {
      previewBubbleMoved = true;
      setTimeout(() => { previewBubbleMoved = false; }, 250);
    } else {
      setPreviewMinimized(false);
    }
  });
  previewBubble.addEventListener('click', () => {
    if (previewBubbleMoved) {
      previewBubbleMoved = false;
      return;
    }
    setPreviewMinimized(false);
  });
  previewBubble.addEventListener('pointercancel', () => {
    previewBubbleDrag = null;
  });
  previewAudioBtn.addEventListener('click', () => {
    if (!bgmAudio) return;
    bgmPaused = !bgmPaused;
    if (bgmPaused) bgmAudio.pause();
    else bgmAudio.play().catch(() => {});
    updateAudioButton(true);
  });

  previewBody.addEventListener('click', nextPreviewBlock);
  previewNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    nextPreviewBlock();
  });

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || previewMin) return;
    previewDrag = { x: e.clientX, y: e.clientY, left: previewLeft, top: previewTop };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging');
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!previewDrag) return;
    previewLeft = previewClamp(previewDrag.left + e.clientX - previewDrag.x, 8, Math.max(8, window.innerWidth - previewWidth - 8));
    previewTop = previewClamp(previewDrag.top + e.clientY - previewDrag.y, 8, Math.max(8, window.innerHeight - 48));
    previewEl.style.left = previewLeft + 'px';
    previewEl.style.top = previewTop + 'px';
  });
  const endDrag = () => {
    previewDrag = null;
    bar.classList.remove('is-dragging');
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  previewResize.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || previewMin) return;
    previewResizing = { x: e.clientX, width: previewWidth };
    previewResize.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  previewResize.addEventListener('pointermove', (e) => {
    if (!previewResizing) return;
    const max = Math.max(320, Math.min(920, Math.floor((window.innerHeight - 110) * (16 / 9)), window.innerWidth - 16));
    previewWidth = previewClamp(previewResizing.width + e.clientX - previewResizing.x, 320, max);
    previewLeft = previewClamp(previewLeft, 8, Math.max(8, window.innerWidth - previewWidth - 8));
    previewEl.style.width = previewWidth + 'px';
    previewEl.style.left = previewLeft + 'px';
  });
  const endResize = () => {
    previewResizing = null;
  };
  previewResize.addEventListener('pointerup', endResize);
  previewResize.addEventListener('pointercancel', endResize);

  window.addEventListener('resize', () => {
    if (!previewEl || previewMin) return;
    previewWidth = previewClamp(previewWidth, 320, previewMaxWidth());
    previewLeft = previewClamp(previewLeft, 8, Math.max(8, window.innerWidth - previewWidth - 8));
    previewTop = previewClamp(previewTop, 8, Math.max(8, window.innerHeight - 60));
    applyPreviewGeometry();
  });

  updateAudioButton(false);
}

function updateAudioButton(hasBgm) {
  if (!previewAudioBtn) return;
  previewAudioBtn.disabled = !hasBgm;
  previewAudioBtn.innerHTML = icon(bgmPaused ? 'play' : 'pause', 'icon icon--12');
  previewAudioBtn.title = !hasBgm ? '没有可播放的 BGM' : bgmPaused ? '继续 BGM' : '暂停 BGM';
  previewAudioBtn.setAttribute('aria-label', previewAudioBtn.title);
  previewAudioBtn.classList.toggle('is-on', !!hasBgm && !bgmPaused);
}

function stopBgm() {
  bgmToken += 1;
  if (bgmAudio) {
    try {
      bgmAudio.pause();
      bgmAudio.src = '';
    } catch (_) {
      /* ignored */
    }
    bgmAudio = null;
  }
  bgmKey = '';
}

function bgmEntry(no) {
  if (no == null || no === '') return null;
  if (!window.MAPPING || !window.MAPPING.has() || !window.RES || window.RES.mode() !== 'scan') return null;
  const file = window.MAPPING.audioFile('bgm', no);
  if (!file) return null;
  return window.RES.find(file);
}

function bgmUrl(entry) {
  const key = (entry.path || '') + ':' + entry.offset + ':' + entry.size;
  if (bgmUrls.has(key)) return bgmUrls.get(key);
  if (!window.shell || !window.shell.loadAudio) return Promise.resolve(null);
  const p = window.shell
    .loadAudio({ file: entry.path, off: entry.offset, size: entry.size })
    .then((res) => {
      if (!res || !res.bytes) return null;
      const mime = res.magic === 'RIFF' ? 'audio/wav' : res.magic === 'ID3' ? 'audio/mpeg' : 'audio/ogg';
      return URL.createObjectURL(new Blob([res.bytes], { type: mime }));
    })
    .catch(() => null);
  bgmUrls.set(key, p);
  return p;
}

function syncBgm(no) {
  const hit = bgmEntry(no);
  if (!hit) {
    stopBgm();
    updateAudioButton(false);
    return;
  }
  const entry = hit.entry;
  const key = (entry.path || '') + ':' + entry.offset + ':' + entry.size;
  if (key === bgmKey) {
    updateAudioButton(true);
    return;
  }
  stopBgm();
  bgmKey = key;
  const token = bgmToken;
  updateAudioButton(true);
  bgmUrl(entry).then((url) => {
    if (token !== bgmToken) return;
    if (!url) {
      bgmKey = '';
      updateAudioButton(false);
      return;
    }
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.55;
    bgmAudio = audio;
    if (!bgmPaused) {
      audio.play().catch(() => {
        if (audio === bgmAudio) {
          bgmPaused = true;
          updateAudioButton(true);
        }
      });
    }
    updateAudioButton(true);
  });
}

function renderPreview() {
  if (!previewEl) initPreview();
  const hit = currentBlock();
  if (!hit) {
    previewBlockId = null;
    previewStage.innerHTML = '';
    previewEmpty.hidden = false;
    stopBgm();
    updateAudioButton(false);
    return;
  }
  previewBlockId = hit.block.id;
  previewEmpty.hidden = true;
  previewStage.innerHTML = '';
  const card = stageCard(hit.scene, hit.block);
  previewStage.appendChild(card);
  if (typeof hydrateSpriteImages === 'function') hydrateSpriteImages(previewStage);
  if (typeof hydrateSpriteCanvases === 'function') hydrateSpriteCanvases(previewStage);
  const st = stageState(hit.scene, hit.block);
  syncBgm(st.bgm);
}

initPreview();
if (window.RES && window.RES.on) window.RES.on(() => renderPreview());
