/* ==========================================================================
   资源接线：把 DSL 里的引用解析成扫描到的文件
   解析链只有两层：
     1. 项目映射表（所有资源类型都在这里）
     2. 剧本里显式的 bgload / cgload 声明（只对自定义资源）
   不再按 BG%03d、三位补零、cha_list 顺序去猜。
   只解析，不改块参数；解析不到就返回原因，界面显示「断线」。
   ========================================================================== */

(function (root) {
  'use strict';

  const chapters = () => {
    const p = root.PROJECT;
    return p && typeof p.chapters === 'function' ? p.chapters() : [];
  };

  const eachBlock = (fn) => {
    chapters().forEach((ch) => (ch.scenes || []).forEach((sc) => (sc.blocks || []).forEach(fn)));
  };

  const map = () => root.MAPPING || null;
  const mapOn = () => !!(root.MAPPING && root.MAPPING.has());

  function bgDecl(id) {
    // 与写作区 declarations() 一致：同一编号多次声明时，后面的覆盖前面的
    let hit = null;
    eachBlock((b) => {
      if (b.type !== 'bgload') return;
      const d = b.data || {};
      if (String(d.id) === String(id)) hit = d;
    });
    return hit;
  }

  function cgDecl(name) {
    let hit = null;
    eachBlock((b) => {
      if (b.type !== 'cgload') return;
      const d = b.data || {};
      if (String(d.name || '') === String(name || '')) hit = d;
    });
    return hit;
  }

  /* 背景：映射表 → bgload → 没有。不再使用 BG%03d 约定。 */
  function bgInfo(id, diff) {
    if (id == null || id === '') return null;
    const m = map();
    if (m) {
      const row = m.bg(id);
      if (row) {
        const file = m.bgFile(id, diff);
        if (file) return { file, source: 'mapping', label: row.name || '', diff: diff || '' };
        const d = bgDecl(id);
        if (d && d.file) return { file: String(d.file), source: 'bgload', label: d.name || '' };
        return { file: '', source: 'mapping', label: row.name || '', diff: diff || '' };
      }
    }
    const d = bgDecl(id);
    if (d && d.file) return { file: String(d.file), source: 'bgload', label: d.name || '' };
    return null;
  }

  const bgFile = (id, diff) => {
    const info = bgInfo(id, diff);
    return info && info.file ? info.file : null;
  };

  /* graph_bg 里同一背景有 _000 / _000b / _010 等变体，取 _000 作底图 */
  function bgEntry(id, diff) {
    if (id == null || id === '') return null;
    if (!root.RES || root.RES.mode() !== 'scan') return null;
    const info = bgInfo(id, diff);
    if (!info || !info.file) return null;
    const list = root.RES.entries('graph_bg.bin');
    const exact = list.find((e) => e.name === info.file);
    if (exact) return exact;
    const hits = list.filter((e) => e.name.startsWith(info.file + '_') || e.name.startsWith(info.file + 'b'));
    return hits.find((e) => /_000$/.test(e.name)) || hits[0] || null;
  }

  function bgRef(id, diff) {
    if (id == null || id === '') return { ok: false, text: '还没选背景' };
    const info = bgInfo(id, diff);
    const entry = bgEntry(id, diff);
    if (entry) {
      return info.source === 'mapping'
        ? { ok: true, text: '映射表 背景 ' + id + ' → ' + entry.name + ' → graph_bg.bin' }
        : { ok: true, text: 'bgload ' + (info.label || '') + ' → ' + entry.name + ' → graph_bg.bin' };
    }
    if (!info) {
      return { ok: false, text: mapOn() ? '映射表没有 背景 ' + id : '项目没有映射表，背景 ' + id + ' 无法解析' };
    }
    if (info.source === 'mapping') {
      if (!info.file) return { ok: false, text: '映射表 背景 ' + id + ' 没有 file' };
      return { ok: false, text: '映射表 背景 ' + id + ' → ' + info.file + '；graph_bg.bin 里没有' };
    }
    return {
      ok: false,
      text: '映射表没有 背景 ' + id + '；bgload ' + (info.label || '') + ' → ' + info.file + '；graph_bg.bin 里没有',
    };
  }

  const bgBroken = (id, diff) => bgRef(id, diff).text;

  /* CG：映射表 → cgload → 没有。CG 名字本身就是归档条目名。 */
  function cgInfo(name) {
    if (!name) return null;
    const m = map();
    if (m) {
      const row = m.cg(name);
      if (row) return { file: row.file || name, source: 'mapping', label: row.label || '' };
    }
    const d = cgDecl(name);
    if (d) return { file: name, source: 'cgload', label: d.name || '' };
    return null;
  }

  const cgFile = (name) => {
    const info = cgInfo(name);
    return info && info.file ? info.file : null;
  };

  function cgEntry(name) {
    if (!name || !root.RES || root.RES.mode() !== 'scan') return null;
    const info = cgInfo(name);
    if (!info || !info.file) return null;
    const hit = root.RES.find(info.file);
    return hit ? hit.entry : null;
  }

  function cgRef(name) {
    if (!name) return { ok: false, text: '还没选 CG' };
    const info = cgInfo(name);
    if (!info) {
      return { ok: false, text: mapOn() ? '映射表没有 CG ' + name : '项目没有映射表，CG ' + name + ' 无法解析' };
    }
    const hit = root.RES && root.RES.mode() === 'scan' ? root.RES.find(info.file) : null;
    if (hit) {
      return info.source === 'mapping'
        ? { ok: true, text: '映射表 CG ' + name + ' → ' + info.file + ' → ' + hit.archive.file }
        : { ok: true, text: 'cgload ' + name + ' → ' + hit.archive.file };
    }
    if (info.source === 'mapping') {
      return { ok: false, text: '映射表 CG ' + name + ' → ' + info.file + '；归档里没有' };
    }
    return { ok: false, text: '映射表没有 CG ' + name + '；cgload → ' + info.file + '；归档里没有' };
  }

  /* BGM / 音效：只认映射表里的 file，不再补三位零或直接拿编号当条目名。 */
  function audioInfo(kind, no) {
    if (no == null || no === '') return null;
    const m = map();
    if (!m) return null;
    const row = m.audio(kind, no);
    if (!row) return null;
    return { file: row.file || String(no), source: 'mapping', label: row.name || '' };
  }

  const audioFile = (kind, no) => {
    const info = audioInfo(kind, no);
    return info && info.file ? info.file : null;
  };

  function audioEntry(kind, no) {
    if (!root.RES || root.RES.mode() !== 'scan' || no == null || no === '') return null;
    const info = audioInfo(kind, no);
    if (!info || !info.file) return null;
    const archive = kind === 'bgm' ? 'bgm.bin' : 'se.bin';
    return root.RES.entries(archive).find((e) => e.name === info.file) || null;
  }

  function audioRef(kind, no) {
    const label = kind === 'bgm' ? 'BGM' : '音效';
    const archive = kind === 'bgm' ? 'bgm.bin' : 'se.bin';
    if (no == null || no === '') return { ok: false, text: '还没填编号' };
    const info = audioInfo(kind, no);
    if (!info) {
      return { ok: false, text: mapOn() ? '映射表没有 ' + label + ' ' + no : '项目没有映射表，' + label + ' ' + no + ' 无法解析' };
    }
    const hit = root.RES && root.RES.mode() === 'scan' ? root.RES.entries(archive).find((e) => e.name === info.file) : null;
    if (hit) return { ok: true, text: '映射表 ' + label + ' ' + no + ' → ' + info.file + ' → ' + archive };
    return { ok: false, text: '映射表 ' + label + ' ' + no + ' → ' + info.file + '；' + archive + ' 里没有' };
  }

  /* 语音：映射表里的 [[voice]]，file 是 voice.bin 条目名。 */
  function voiceInfo(no) {
    if (no == null || no === '') return null;
    const m = map();
    if (!m) return null;
    const row = m.voice(no);
    if (!row) return null;
    return { file: row.file || String(no), source: 'mapping', label: row.name || '' };
  }

  const voiceFile = (no) => {
    const info = voiceInfo(no);
    return info && info.file ? info.file : null;
  };

  function voiceEntry(no) {
    if (!root.RES || root.RES.mode() !== 'scan' || no == null || no === '') return null;
    const info = voiceInfo(no);
    if (!info) return null;
    const hit = root.RES.find(info.file);
    return hit ? hit.entry : null;
  }

  function voiceRef(no) {
    if (no == null || no === '') return null;
    const info = voiceInfo(no);
    if (!info) return { ok: false, text: mapOn() ? '映射表没有 语音 ' + no : '项目没有映射表，语音 ' + no + ' 无法解析' };
    const hit = root.RES && root.RES.mode() === 'scan' ? root.RES.find(info.file) : null;
    if (hit) return { ok: true, text: '映射表 语音 ' + no + ' → ' + info.file + ' → ' + hit.archive.file };
    return { ok: false, text: '映射表 语音 ' + no + ' → ' + info.file + '；voice.bin 里没有' };
  }

  root.WIRING = {
    chapters,
    bgDecl,
    bgInfo,
    bgFile,
    bgEntry,
    bgBroken,
    bgRef,
    cgDecl,
    cgInfo,
    cgFile,
    cgEntry,
    cgRef,
    audioInfo,
    audioFile,
    audioEntry,
    audioRef,
    voiceInfo,
    voiceFile,
    voiceEntry,
    voiceRef,
  };
})(window);
