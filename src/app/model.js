/* ==========================================================================
   hcb-ir-editor · 块视图 / 舞台 / 接线
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* 块在界面上的读法：一句话 + DSL 原文 */
  function blockCode(block) {
    const def = TYPES[block.type];
    if (!def || !def.code) return null;
    const lines = def.code(block.data || {}, block);
    if (!lines) return null;
    if (!block.extra || !block.extra.length) return lines;
    // 导入时认不出的尾部参数，原样留在行尾
    const out = lines.slice();
    out[0] = out[0].replace(/\]\s*$/, ',' + block.extra.join(',') + ']');
    return out;
  }

  function viewOf(block) {
    const def = TYPES[block.type] || { label: block.type, group: 'flow', icon: 'sticky-note', text: () => '', fields: [] };
    const d = block.data || {};
    const speaker = def.speaker ? def.speaker(d, block) : '';
    return {
      def,
      label: block.type === 'dia' ? (speaker ? '对话' : '旁白') : def.label,
      text: def.text ? def.text(d, block) : '',
      meta: def.meta ? def.meta(d, block) : '',
      speaker,
      empty: def.empty ? def.empty(d, block) : false,
      warn: def.warn ? def.warn(d, block) : false,
      mono: !!def.mono,
      code: blockCode(block),
    };
  }

  /* 只有紧挨着 dia 的上一块是 cha 时，这一句才算对话；再往后是旁白 */
  function speakerBefore(block) {
    const hit = listOfBlock(block.id);
    if (!hit) return '';
    const i = hit.list.indexOf(block) - 1;
    const prev = i >= 0 ? hit.list[i] : null;
    if (prev && prev.type === 'cha') return prev.data.show || prev.data.name || '';
    return '';
  }

  /* 全文里的标签，给跳转的下拉提示用 */
  function allLabels() {
    const out = [];
    CHAPTERS.forEach((ch) =>
      ch.scenes.forEach((sc) =>
        flatten(sc.blocks).forEach((b) => {
          if (b.type === 'label' && b.data && b.data.name) out.push(bareName(b.data.name));
        })
      )
    );
    return out;
  }

  /* 立绘编号对应 cha_list 里的第几个角色（按表序推断，未验证） */
  const spriteCha = (id) => {
    if (!hasMapping()) return null;
    const n = Number(id);
    const mapped = window.MAPPING.character(n);
    return mapped ? { name: mapped.name } : null;
  };

  /* 立绘表由资源库统一构建，选择器直接用 */
  const spriteSource = () => (window.RES ? window.RES.spriteChars() : []);

  const spriteCharByCha = (cha) => (hasMapping() ? spriteSource().find((c) => Number(c.cha) === Number(cha)) : null);
  const mapCg = (name) => (window.MAPPING ? window.MAPPING.cg(name) : null);
  const mapAudio = (kind, no) => (window.MAPPING ? window.MAPPING.audio(kind, no) : null);
  const mapVoice = (no) => (window.MAPPING ? window.MAPPING.voice(no) : null);

  function spritePick(block) {
    if (!hasMapping()) return null;
    const d = block.data || {};
    const ch = spriteCharByCha(d.cha);
    if (!ch) return null;
    // 映射表里的 pose / cloth 数字可能不是数组下标，按编号找
    let pi = ch.poseNos.indexOf(Number(d.pose));
    if (pi < 0) pi = 0;
    let ci = ch.clothNos.indexOf(Number(d.cloth));
    if (ci < 0) ci = 0;
    const poseNo = ch.poseNos[pi] == null ? 1 : ch.poseNos[pi];
    const clothNo = ch.clothNos[ci] == null ? 0 : ch.clothNos[ci];
    const pose = ch.poses[pi];
    const cloth = ch.cloths[ci];
    const key = poseNo + '|' + clothNo;
    const lv = d.l == null || d.l === '' ? '-1' : String(d.l);
    const body = (ch.bodyVariants && ch.bodyVariants[key] && ch.bodyVariants[key][lv]) || ch.bodies[key] || null;
    const sheet = (ch.sheetVariants && ch.sheetVariants[key] && ch.sheetVariants[key][lv]) || ch.sheets[key] || null;
    return { ch, pose, cloth, poseNo, clothNo, key, lv, body, sheet, pi, ci };
  }

  /* 站在这一块时，画面里有什么：从本章开头按顺序把原语跑一遍
     背景、立绘、BGM 都跨场景留着，和脚本里一样 */
  const stageStateCache = new Map();

  function invalidateStageCache() {
    stageStateCache.clear();
  }

  function copyStageState(st) {
    const sprites = {};
    Object.keys(st.sprites || {}).forEach((key) => {
      sprites[key] = Object.assign({}, st.sprites[key]);
    });
    return Object.assign({}, st, { sprites, camera: Object.assign({}, st.camera) });
  }

  function stageState(scene, block, opts) {
    if (stageStateCache.has(block.id)) return stageStateCache.get(block.id);
    const bulk = !opts || opts.bulk !== false;
    const st = { bg: null, cg: null, msg: 'normal', sprites: {}, bgm: null, se: null, text: '', speaker: '', screen: null, camera: { x: 0, y: 0, z: 0 } };
    let speakerRun = '';
    const run = (b) => {
      const d = b.data || {};
      if (b.type === 'bg') {
        st.bg = d.id;
        st.bgDiff = d.diff;
        st.screen = null;
      } else if (b.type === 'cg') {
        st.cg = d.name;
        st.screen = null;
      } else if (b.type === 'bs') {
        if (d.l === '-10') {
          speakerRun = '';
          return;
        }
        const pick = spritePick(b);
        st.sprites[d.cha] = {
          cha: d.cha,
          pos: d.pos || 'm',
          l: d.l,
          x: d.x,
          y: d.y,
          z: d.z,
          face: d.face,
          pose: d.pose,
          lyr: d.lyr,
          thumb: pick && pick.body ? pick.body.thumb : null,
          entry: pick && pick.body ? pick.body.entry : null,
          w: pick && pick.body ? pick.body.w : null,
          h: pick && pick.body ? pick.body.h : null,
          sheet: pick && pick.sheet ? pick.sheet : null,
        };
        st.screen = null;
      } else if (b.type === 'bs_move') {
        const sp = st.sprites[d.cha];
        if (sp) {
          sp.x = (Number(sp.x) || 0) + (Number(d.dx) || 0);
          sp.y = (Number(sp.y) || 0) + (Number(d.dy) || 0);
          if (d.z !== '' && d.z != null) sp.z = d.z;
        }
      } else if (b.type === 'bs_fade' || b.type === 'bsfade') {
        if (b.type === 'bsfade') st.sprites = {};
        else delete st.sprites[d.cha];
      } else if (b.type === 'msg') {
        st.msg = d.mode;
      } else if (b.type === 'cha') {
        speakerRun = d.show || d.name || '';
      } else if (b.type === 'dia') {
        st.speaker = speakerRun;
        st.text = d.text || '';
        speakerRun = '';
      } else if (b.type === 'bgm') {
        st.bgm = d.no;
      } else if (b.type === 'bgmstop') {
        st.bgm = null;
      } else if (b.type === 'se') {
        st.se = d.mode === 'end' ? null : d.no;
      } else if (b.type === 'v3d') {
        ['x', 'y', 'z'].forEach((k) => {
          if (d[k] !== '' && d[k] != null) st.camera[k] = Number(d[k]) || 0;
        });
      } else if (b.type === 'white' || b.type === 'black' || b.type === 'eyecatch' || b.type === 'movie') {
        st.screen = b.type;
      }
      if (b.type !== 'cha' && b.type !== 'dia') speakerRun = '';
    };

    const hit = sceneOfBlock(block.id);
    const chapter = hit ? hit.chapter : null;
    if (!chapter) {
      let target = null;
      flatten(scene.blocks).forEach((b) => {
        run(b);
        if (bulk) stageStateCache.set(b.id, copyStageState(st));
        else if (b.id === block.id) target = copyStageState(st);
      });
      if (!bulk) {
        target = target || copyStageState(st);
        stageStateCache.set(block.id, target);
        return target;
      }
      return stageStateCache.get(block.id) || st;
    }
    for (const sc of chapter.scenes) {
      speakerRun = '';
      for (const b of flatten(sc.blocks)) {
        run(b);
        if (bulk) {
          const snapshot = copyStageState(st);
          stageStateCache.set(b.id, snapshot);
          if (b.id === block.id) return snapshot;
        } else if (b.id === block.id) {
          const snapshot = copyStageState(st);
          stageStateCache.set(b.id, snapshot);
          return snapshot;
        }
      }
    }
    const fallback = copyStageState(st);
    stageStateCache.set(block.id, fallback);
    return fallback;
  }

  /* 背景名里带的情境决定底色，夜深色配亮字 */
  function bgTint(name) {
    const rules = [
      [/夜/, '#2C3E50'],
      [/教室|学園|廊下|校舎|校門/, '#F3E7D3'],
      [/桜/, '#F6DDE3'],
      [/空/, '#DCE9F5'],
      [/海/, '#CFE3F2'],
      [/店|部屋|工房/, '#EDE1D0'],
      [/神社|石段|駅/, '#E7E0D6'],
      [/列車|車両|扇形庫/, '#E0E4E8'],
      [/町|広場|公園|坂|通学路|路地/, '#E4EBD9'],
    ];
    for (const [re, fill] of rules) if (re.test(name || '')) return fill;
    return '#EFEDE8';
  }


  /* 台词里的 ~ 换行，每个 [注解|正文] 单独成一个 ruby 小字 */
  function stageTextHtml(text) {
    const raw = String(text == null ? '' : text);
    let out = '';
    let pos = 0;
    const re = /\[([^\]\r\n]*)\|([^\]\r\n]*)\]|~/g;
    let m;
    while ((m = re.exec(raw))) {
      const between = raw.slice(pos, m.index);
      if (between) out += esc(between).replace(/\n/g, '<br>');
      if (m[0] === '~') {
        out += '<br>';
      } else if (m[1] || m[2]) {
        if (m[1] && m[2]) out += '<ruby class="stage-ruby">' + esc(m[2]) + '<rt>' + esc(m[1]) + '</rt></ruby>';
        else out += esc(m[2] || m[1]);
      } else {
        out += esc(m[0]);
      }
      pos = re.lastIndex;
    }
    const tail = raw.slice(pos);
    if (tail) out += esc(tail).replace(/\n/g, '<br>');
    return out;
  }

  function stageHasOuterQuotes(text) {
    const raw = String(text == null ? '' : text).trim();
    if (raw.length < 2) return false;
    return (raw[0] === '「' && raw[raw.length - 1] === '」') || (raw[0] === '『' && raw[raw.length - 1] === '』');
  }

  function stageCard(scene, block, stage) {
    const st = stage || stageState(scene, block);
    const bg = bgById(st.bg);
    const fill = bgTint(bg ? bg.name : '');
    const dark = fill === '#2C3E50';
    const bgEntry = st.bg != null && window.WIRING ? window.WIRING.bgEntry(st.bg, st.bgDiff) : null;
    const cgEntry = st.cg && window.WIRING ? window.WIRING.cgEntry(st.cg) : null;
    const conf = window.PROJECT_SETTINGS
      ? window.PROJECT_SETTINGS.get()
      : { stage: { width: 1280, height: 720, bottom: 0, anchors: { l: 320, m: 640, r: 960 } }, depth: { sprite: 1000, background: 1000, cg: 1000 }, sprite: { height: 76, maxWidth: 36 } };
    const SW = conf.stage.width;
    const SH = conf.stage.height;
    const posFrac = {
      l: conf.stage.anchors.l / SW,
      m: conf.stage.anchors.m / SW,
      r: conf.stage.anchors.r / SW,
    };
    const bottomFrac = conf.stage.bottom / SH;
    const clampZ = (value, fallback) => {
      if (value === '' || value == null) return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(100, Math.min(10000, n)) : fallback;
    };
    const sprites = Object.keys(st.sprites)
      .map((k) => st.sprites[k])
      .sort((a, b) => {
        const az = clampZ(a.z, conf.depth.sprite);
        const bz = clampZ(b.z, conf.depth.sprite);
        if (az !== bz) return az - bz;
        return (Number(a.lyr) || 0) - (Number(b.lyr) || 0);
      });
    const cam = st.camera || { x: 0, y: 0, z: 0 };
    const camFor = (z) => {
      const depth = z - (Number(cam.z) || 0);
      const scale = 1000 / (Math.abs(depth) < 1e-3 ? 1 : depth);
      return { scale, tx: -(Number(cam.x) || 0) * scale, ty: -(Number(cam.y) || 0) * scale };
    };
    const camStyle = (z) => {
      const c = camFor(z);
      return 'transform:translate(' + (c.tx / SW * 100).toFixed(3) + '%,' + (c.ty / SH * 100).toFixed(3) + '%) scale(' + c.scale.toFixed(5) + ');transform-origin:50% 50%';
    };
    const hideBox = st.msg === 'boxout' || st.msg === 'effect_boxout';

    const card = el('div', 'stage' + (dark ? ' is-dark' : ''));
    card.style.aspectRatio = SW + ' / ' + SH;
    const parts = [];
    parts.push('<div class="stage__frame">');
    parts.push('<div class="stage__bg" style="background:' + fill + '"></div>');
    if (bgEntry) parts.push('<img class="stage__bg-img" data-bg="' + esc(JSON.stringify(bgEntry)) + '" style="' + camStyle(clampZ(conf.depth.background, 1000)) + '" alt="">');

    sprites.forEach((s) => {
      const base = posFrac[s.pos] == null ? 0.5 : posFrac[s.pos];
      const dx = Number(s.x);
      const dy = Number(s.y);
      const baseX = (base + (Number.isFinite(dx) ? dx / SW : 0)) * SW;
      const baseY = SH * (1 - (bottomFrac - (Number.isFinite(dy) ? dy / SH : 0)));
      const z = clampZ(s.z, conf.depth.sprite);
      const c = camFor(z);
      const screenX = SW / 2 + c.scale * (baseX - SW / 2 - (Number(cam.x) || 0));
      const screenY = SH / 2 + c.scale * (baseY - SH / 2 - (Number(cam.y) || 0));
      const left = screenX / SW * 100;
      const bottom = (1 - screenY / SH) * 100;
      const posStyle = 'left:' + left.toFixed(3) + '%;bottom:' + bottom.toFixed(3) + '%;height:' + (conf.sprite.height * c.scale).toFixed(3) + '%;max-width:' + (conf.sprite.maxWidth * c.scale).toFixed(3) + '%;transform:translateX(-50%)';
      if (s.entry) {
        const spec = {
          body: s.entry,
          w: s.w,
          h: s.h,
          face: s.face,
          sheet: s.sheet
            ? {
                entry: s.sheet.entry,
                cellW: s.sheet.cellW,
                cellH: s.sheet.cellH,
                cells: s.sheet.cells,
                cols: s.sheet.cols,
                faceX: s.sheet.faceX,
                faceY: s.sheet.faceY,
              }
            : null,
        };
        parts.push('<canvas class="stage__sprite-img stage__sprite-canvas" data-sprite="' + esc(JSON.stringify(spec)) + '" style="' + posStyle + '" aria-hidden="true"></canvas>');
        return;
      }
      if (s.thumb) {
        parts.push('<img class="stage__sprite-img" src="' + esc(s.thumb) + '" style="' + posStyle + '" alt="">');
      }
    });

    if (st.cg && cgEntry) {
      parts.push('<img class="stage__cg-img" data-cg="' + esc(JSON.stringify(cgEntry)) + '" style="' + camStyle(clampZ(conf.depth.cg, 1000)) + '" alt="">');
    }

    if (st.screen) {
      parts.push('<div class="stage__screen stage__screen--' + st.screen + '"></div>');
    }


    if (!hideBox && (st.text || st.speaker)) {
      let textHtml = stageTextHtml(st.text);
      if (st.speaker && st.text && !stageHasOuterQuotes(st.text)) textHtml = '「' + textHtml + '」';
      parts.push(
        '<div class="stage__box' + (st.msg === 'middle' ? ' is-middle' : '') + '">' +
          (st.speaker ? '<span class="stage__speaker">' + esc(st.speaker) + '</span>' : '') +
          '<span class="stage__text">' + textHtml + '</span>' +
          '</div>'
      );
    }
    parts.push('</div>');
    card.innerHTML = parts.join('');
    return card;
  }

  /* 这个块引用的资源在扫描结果里接上了没有；只读，不改参数 */
  function refOfBlock(block) {
    const d = block.data || {};
    if (block.type === 'bg') {
      if (d.id == null || d.id === '') return { ok: false, text: '还没选背景' };
      return window.WIRING ? window.WIRING.bgRef(d.id, d.diff) : { ok: false, text: '没有接线路由' };
    }
    if (block.type === 'cg') {
      if (!d.name) return { ok: false, text: '还没选 CG' };
      return window.WIRING ? window.WIRING.cgRef(d.name) : { ok: false, text: '没有接线路由' };
    }
    if (block.type === 'bs') {
      const m = window.MAPPING;
      if (!m || !m.has()) return { ok: false, text: '项目没有映射表，立绘编号无法解析' };
      const row = m.sprite(d.cha, d.pose, d.cloth);
      if (!row) return { ok: false, text: '映射表没有 立绘 ' + d.cha + '/' + d.pose + '/' + d.cloth };
      if (!row.body) return { ok: false, text: '映射表 立绘 ' + d.cha + '/' + d.pose + '/' + d.cloth + ' 没有 body' };
      const hit = window.RES ? window.RES.find(row.body) : null;
      return hit
        ? { ok: true, text: '映射表 立绘 ' + d.cha + '/' + d.pose + '/' + d.cloth + ' → ' + row.body + ' → ' + hit.archive.file }
        : { ok: false, text: '映射表 立绘 ' + d.cha + '/' + d.pose + '/' + d.cloth + ' → ' + row.body + '；归档里没有' };
    }
    if (block.type === 'cha') {
      const has = d.voice !== '' && d.voice != null;
      if (!has || !mapVoice(d.voice)) return null;
      return window.WIRING ? window.WIRING.voiceRef(d.voice) : null;
    }
    if (block.type === 'se' || block.type === 'bgm') {
      if (d.no == null || d.no === '') return { ok: false, text: '还没填编号' };
      return window.WIRING ? window.WIRING.audioRef(block.type, d.no) : { ok: false, text: '没有接线路由' };
    }
    return null;
  }

  function wireSet(block) {
    const ref = refOfBlock(block);
    if (!ref) return null;
    const fs = el('div', 'fieldset wire-set');
    fs.appendChild(el('div', 'fieldset__legend', '接线'));
    fs.appendChild(
      el('div', 'wire' + (ref.ok ? '' : ' is-broken'), '<span class="wire__dot"></span><span class="wire__text">' + esc(ref.text) + '</span>')
    );
    return fs;
  }

  function allScenes() {
    const out = [];
    CHAPTERS.forEach((ch) => (ch.scenes || []).forEach((sc) => out.push({ id: sc.id, no: sc.no, title: sc.title, chapter: ch })));
    return out;
  }

  function sceneShortOf(id) {
    const s = allScenes().find((x) => x.id === id);
    return s ? s.no + ' ' + s.title : '';
  }

  function flatten(blocks, out) {
    out = out || [];
    (blocks || []).forEach((b) => {
      out.push(b);
      if (b.children) flatten(b.children, out);
    });
    return out;
  }

  function sceneOfBlock(blockId) {
    for (const ch of CHAPTERS) {
      for (const sc of ch.scenes || []) {
        if (flatten(sc.blocks).some((b) => b.id === blockId)) return { chapter: ch, scene: sc };
      }
    }
    return null;
  }

  function listOfBlock(blockId) {
    for (const ch of CHAPTERS) {
      for (const sc of ch.scenes || []) {
        const found = searchList(sc.blocks || [], blockId);
        if (found) return { list: found, scene: sc, chapter: ch };
      }
    }
    return null;
  }

  function searchList(list, id) {
    for (const b of list) {
      if (b.id === id) return list;
      if (b.children) {
        const hit = searchList(b.children, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  function countBlocks(ch) {
    return (ch.scenes || []).reduce((n, sc) => n + flatten(sc.blocks).length, 0);
  }

  function charCount(ch) {
    let n = 0;
    (ch.scenes || []).forEach((sc) =>
      flatten(sc.blocks).forEach((b) => {
        if (b.data && typeof b.data.text === 'string') n += b.data.text.length;
        if (b.data && Array.isArray(b.data.options)) b.data.options.forEach((o) => (n += (o.text || '').length));
      })
    );
    return n;
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

