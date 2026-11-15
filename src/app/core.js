/* ==========================================================================
   hcb-ir-editor · 渲染层
   图标来自 Lucide（src/icons.js）。块为实心色，右侧一枚同色系水印图标。
   ========================================================================== */

'use strict';

  /* ------------------------------------------------------------------ *
   * 图标
   * ------------------------------------------------------------------ */

  function icon(name, cls) {
    const body = (window.LUCIDE && window.LUCIDE[name]) || '';
    return (
      '<svg class="' + (cls || 'icon') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------------ *
   * 世界
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * 领域表：背景编号、角色名、CG 名来自 Simple .hcb Editor 的表
   * ------------------------------------------------------------------ */

  /* 没有项目映射表时，资源参数一律退回数字/文本输入，不再用按 cha_list 推断的名字 */
  const hasMapping = () => !!(window.MAPPING && window.MAPPING.has());

  /* 剧本里的 bgload / chaload / cgload 会带名字，和领域表合起来用 */
  let declCache = null;

  function declarations() {
    if (declCache) return declCache;
    const bg = new Map();
    const cha = new Set();
    const cg = new Set();
    CHAPTERS.forEach((ch) =>
      (ch.scenes || []).forEach((sc) =>
        flatten(sc.blocks).forEach((b) => {
          const d = b.data || {};
          if (b.type === 'bgload' && d.id !== '' && d.id != null) {
            bg.set(String(d.id), { id: String(d.id), name: d.name || d.file || '编号 ' + d.id });
          } else if (b.type === 'chaload' && d.name) {
            cha.add(d.name);
          } else if (b.type === 'cgload' && d.name) {
            cg.add(d.name);
          }
        })
      )
    );
    declCache = { bg, cha, cg };
    return declCache;
  }

  const dropDecls = () => {
    declCache = null;
  };

  const bgById = (id) => {
    const key = String(id);
    const mapped = window.MAPPING ? window.MAPPING.bg(key) : null;
    if (mapped && mapped.name) return { id: key, name: mapped.name };
    const hit = declarations().bg.get(key);
    if (hit) return hit;
    return undefined;
  };

  const bgOptions = () => {
    const out = [];
    const seen = new Set();
    const add = (id, name) => {
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ value: key, label: key + '　' + (name || '背景 ' + key), swatch: bgTint(name || '') });
    };
    if (window.MAPPING) window.MAPPING.bgs().forEach((b) => add(b.no, b.name));
    [...declarations().bg.values()].forEach((b) => add(b.id, b.name || b.file));
    return out.sort((a, b) => Number(a.value) - Number(b.value));
  };

  const chaOptions = () => {
    const out = [];
    const seen = new Set();
    const add = (name) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({ value: name, label: name });
    };
    if (window.MAPPING) {
      window.MAPPING.characters().forEach((c) => {
        add(c.name);
        c.aliases.forEach(add);
      });
    }
    declarations().cha.forEach(add);
    return out;
  };

  /* CG 名来自扫描到的 graph_vis、剧本里的 cgload，以及领域表 */
  const cgNames = () => {
    const out = [];
    const seen = new Set();
    const add = (name) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    };
    if (window.MAPPING) window.MAPPING.cgs().forEach((c) => add(c.name));
    declarations().cg.forEach(add);
    return out;
  };

  /* 名称是人的，:: 是 DSL 的：界面只显示名字，拼成调用时才补前缀 */
  const bareName = (v) => String(v == null ? '' : v).trim().replace(/^::\s*/, '');
  const asTarget = (v) => '::' + (bareName(v) || '?');

  /* 原语分组，颜色取 Flat UI */
  const GROUPS = {
    flow: { label: '流程', color: '#34495E' },
    text: { label: '台词', color: '#3498DB' },
    visual: { label: '画面', color: '#2ECC71' },
    sprite: { label: '立绘', color: '#E67E22' },
    audio: { label: '声音', color: '#16A085' },
    staging: { label: '演出', color: '#9B59B6' },
    vars: { label: '变量', color: '#D35400' },
    note: { label: '备注', color: '#BDC3C7' },
    custom: { label: '扩展', color: '#7F8C8D' },
  };

  const GROUP_ORDER = ['flow', 'text', 'visual', 'sprite', 'audio', 'staging', 'vars', 'note', 'custom'];

  /* ------------------------------------------------------------------ *
   * 剧本
   * ------------------------------------------------------------------ */

  let seq = 900;
  let chapterSeq = 0;
  const nid = () => 'b-' + ++seq;

  /* 项目内容只来自文件：不内置示例剧本 */
  let CHAPTERS = [];

  /* ------------------------------------------------------------------ *
   * 原语 · 与 Simple .hcb Editor 的 [命令,参数…] 一一对应
   * ------------------------------------------------------------------ */

  /* 参数按 DSL 顺序拼；空参数写成 ?，末尾的 ? 省掉 */
  function args(parts) {
    const out = parts.map((p) => {
      if (p === undefined || p === null) return '?';
      // DSL 是行式的：参数里的换行压成空格，别把一行拆成两行
      const s = String(p).replace(/\s*\r?\n\s*/g, ' ').trim();
      return s === '' ? '?' : s;
    });
    while (out.length && out[out.length - 1] === '?') out.pop();
    return out;
  }

  const dsl = (cmd, ...parts) => '[' + [cmd].concat(args(parts)).join(',') + ']';

  const MSG_LABEL = { normal: '普通', middle: '居中', boxin: '显示对话框', boxout: '隐藏对话框', effect_box: '滤镜显示', effect_boxout: '滤镜隐藏' };
  const POS_LABEL = { l: '左', m: '中', r: '右' };
  const FADE_LABEL = { 1: '向右', 2: '向左', 3: '向下', 4: '向上' };


