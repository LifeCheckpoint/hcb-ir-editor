/* ==========================================================================
   hcb-ir-editor · 原语定义 / 色板
   从 renderer.js 拆出；classic script，与同目录其它文件共享全局词法作用域。
   ========================================================================== */

'use strict';

  const TYPES = {
    /* 流程 */
    start: {
      label: '开始',
      group: 'flow',
      icon: 'play',
      text: () => '脚本从这里进',
      meta: () => '',
      code: () => ['[start]'],
      fields: [],
    },
    end: {
      label: '结束',
      group: 'flow',
      icon: 'square',
      text: () => '到 end 就收尾',
      meta: () => '',
      code: () => ['[end]'],
      fields: [],
    },
    label: {
      label: '标签',
      group: 'flow',
      icon: 'tag',
      mono: true,
      hideCode: true,
      text: (d) => bareName(d.name) || '未命名标签',
      meta: () => '',
      code: (d) => [asTarget(d.name)],
      fields: [{ key: 'name', label: '名称', type: 'text', mono: true, req: true, placeholder: 'loop' }],
    },
    jump: {
      label: '跳转',
      group: 'flow',
      icon: 'arrow-right-to-line',
      mono: true,
      text: (d) => bareName(d.target) || '未选目标',
      warn: (d) => !bareName(d.target),
      code: (d) => [dsl('jump', asTarget(d.target))],
      fields: [{ key: 'target', label: '目标标签', type: 'text', mono: true, list: 'labels', req: true, placeholder: 'loop' }],
    },
    sel: {
      label: '选项',
      group: 'flow',
      icon: 'list-checks',
      text: (d) => d.prompt || '未填提示语',
      meta: (d) => (d.options || []).length + ' 个选项',
      warn: (d) => !d.prompt || (d.options || []).some((o) => !o.target),
      code: (d) => {
        const out = [dsl('sel', 'start', d.prompt)];
        (d.options || []).forEach((o) => out.push(dsl('sel', 'op', o.text, asTarget(o.target))));
        out.push('[sel,end]');
        return out;
      },
      fields: [
        { key: 'prompt', label: '提示语', type: 'text' },
        { key: 'options', label: '选项', type: 'options' },
      ],
    },
    ssel: {
      label: '章节选择',
      group: 'flow',
      icon: 'layout-grid',
      text: () => '章节选择画面',
      code: () => ['[ssel]'],
      fields: [],
    },
    achieve: {
      label: '实绩',
      group: 'flow',
      icon: 'trophy',
      text: (d) => (d.no === '' || d.no == null ? '初始化实绩台' : '实绩 ' + d.no),
      code: (d) => [dsl('achieve', d.no)],
      fields: [{ key: 'no', label: '编号', type: 'number', min: 0, placeholder: '空 = 初始化' }],
    },
    chaload: {
      label: '登记角色名',
      group: 'flow',
      icon: 'files',
      text: (d) => d.name || '未选角色',
      meta: (d) => (d.aliases ? '含别名' : ''),
      warn: (d) => !d.name,
      code: (d) => [dsl('chaload', d.name, d.aliases)],
      fields: [
        { key: 'name', label: '角色', type: 'select', options: chaOptions, req: true, mapped: true },
        { key: 'aliases', label: '别名', type: 'text', mono: true, placeholder: '名字:编号，逗号分隔' },
      ],
    },

    /* 台词 */
    cha: {
      label: '角色 / 语音',
      group: 'text',
      icon: 'user-round',
      text: (d) => d.name || '未选角色',
      meta: (d) => {
        const has = d.voice !== '' && d.voice != null;
        const v = has && window.MAPPING ? window.MAPPING.voice(d.voice) : null;
        return [d.show ? '显示为 ' + d.show : '', has ? '语音 ' + (v && v.name ? v.name : d.voice) : ''].filter(Boolean).join('　');
      },
      warn: (d) => !d.name,
      code: (d) => [dsl('cha', d.show ? d.name + '/' + d.show : d.name, d.voice)],
      fields: [
        { key: 'name', label: '角色', type: 'select', options: chaOptions, req: true, mapped: true },
        { key: 'show', label: '显示名', type: 'text', placeholder: '？？？' },
        { key: 'voice', label: '语音编号', type: 'number', min: 0 },
      ],
    },
    dia: {
      label: '对话',
      group: 'text',
      icon: 'message-square-text',
      hideCode: true,
      speaker: (d, b) => speakerBefore(b),
      text: (d) => d.text || '空台词',
      empty: (d) => !d.text,
      warn: (d) => /[,，]/.test(d.text || '') && /,/.test(d.text || ''),
      code: (d) => [dsl('dia', d.text, d.size)],
      fields: [
        { key: 'text', label: '台词', type: 'textarea', req: true, full: true, rows: 3 },
        { key: 'size', label: '字号', type: 'number', min: 0, placeholder: '空 = 默认' },
      ],
    },
    msg: {
      label: '对话框',
      group: 'text',
      icon: 'panel-bottom',
      text: (d) => MSG_LABEL[d.mode] || '未选模式',
      code: (d) => [dsl('msg', d.mode)],
      fields: [
        {
          key: 'mode',
          label: '模式',
          type: 'select',
          req: true,
          options: () => [
            { value: 'normal', label: 'normal 普通' },
            { value: 'middle', label: 'middle 居中' },
            { value: 'boxin', label: 'boxin 显示对话框' },
            { value: 'boxout', label: 'boxout 隐藏对话框' },
            { value: 'effect_box', label: 'effect_box 滤镜显示' },
            { value: 'effect_boxout', label: 'effect_boxout 滤镜隐藏' },
          ],
        },
      ],
    },

    /* 画面 */
    bg: {
      label: '背景',
      group: 'visual',
      icon: 'mountain',
      text: (d) => {
        if (d.id == null || d.id === '') return '未选背景';
        if (!hasMapping()) return '背景 ' + d.id;
        return bgById(d.id) ? bgById(d.id).name : '背景 ' + d.id;
      },
      empty: (d) => d.id == null || d.id === '',
      warn: (d) => d.id == null || d.id === '',
      meta: (d) => (d.diff ? '差分 ' + d.diff : ''),
      code: (d) => [dsl('bg', d.id, d.diff)],
      fields: [
        { key: 'id', label: '背景编号', type: 'select', options: bgOptions, req: true, full: true, mapped: true, numeric: true },
        { key: 'diff', label: '差分', type: 'text', mono: true, placeholder: '空 = 原图' },
      ],
    },
    bgload: {
      label: '导入背景',
      group: 'visual',
      icon: 'image-plus',
      text: (d) => d.file || '未填文件名',
      warn: (d) => !d.file || d.id === '',
      code: (d) => [dsl('bgload', d.id, d.file, d.name)],
      fields: [
        { key: 'id', label: '新编号', type: 'number', min: 1, req: true },
        { key: 'file', label: '文件名', type: 'text', mono: true, placeholder: 'BG900_000' },
        { key: 'name', label: '显示名', type: 'text' },
      ],
    },
    cgload: {
      label: '预载 CG',
      group: 'visual',
      icon: 'download',
      text: (d) => d.name || '未选 CG',
      meta: () => '必须在 start 之前',
      warn: (d) => !d.name,
      code: (d) => [dsl('cgload', d.name)],
      fields: [{ key: 'name', label: 'CG', type: 'text', mono: true, list: 'cg', req: true, placeholder: 'KURO_e011a1' }],
    },
    cg: {
      label: '显示 CG',
      group: 'visual',
      icon: 'image',
      text: (d) => (mapCg(d.name) && mapCg(d.name).label) || d.name || '未选 CG',
      warn: (d) => !d.name,
      meta: (d) => (d.keep ? '沿用当前设定' : '×' + (Number(d.zoom || 0) / 2000).toFixed(2)),
      code: (d) =>
        d.keep ? [dsl('cg', d.name, d.time)] : [dsl('cg', d.name, d.x, d.y, d.zoom, d.time)],
      fields: [
        { key: 'name', label: 'CG', type: 'text', mono: true, list: 'cg', req: true, placeholder: 'KURO_e011a1', full: true },
        { key: 'keep', label: '沿用当前设定', type: 'switch', rerender: true, desc: '不动画面，只换热时长' },
        { key: 'x', type: 'vector', label: '位置', keys: ['x', 'y'], places: ['x', 'y'], show: (d) => !d.keep },
        { key: 'zoom', label: '缩放', type: 'number', step: 100, show: (d) => !d.keep, placeholder: '2000 = 1×' },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms' },
      ],
    },
    white: {
      label: '白屏',
      group: 'visual',
      icon: 'sun',
      text: () => '画面调白',
      code: () => ['[white]'],
      fields: [],
    },
    black: {
      label: '黑屏',
      group: 'visual',
      icon: 'moon',
      text: () => '画面转黑',
      code: () => ['[black]'],
      fields: [],
    },
    eyecatch: {
      label: '过场',
      group: 'visual',
      icon: 'clapperboard',
      text: (d) => (d.no === '' || d.no == null ? '默认槽位' : '槽位 ' + d.no),
      code: (d) => [dsl('eyecatch', d.no)],
      fields: [
        {
          key: 'no',
          label: '槽位',
          type: 'select',
          options: () => [
            { value: '', label: '默认' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '4' },
            { value: '5', label: '5' },
            { value: '6', label: '6' },
          ],
        },
      ],
    },
    movie: {
      label: '影片',
      group: 'visual',
      icon: 'film',
      text: () => '播放影片',
      code: () => ['[movie]'],
      fields: [],
    },
    effect: {
      label: '转场特效',
      group: 'visual',
      icon: 'wand-sparkles',
      text: (d) => '编号 ' + (d.no === '' ? '?' : d.no),
      meta: (d) => (d.time ? d.time + 'ms' : ''),
      code: (d) => [dsl('effect', d.no, d.time)],
      fields: [
        { key: 'no', label: '编号', type: 'number', min: 0 },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms' },
      ],
    },

    /* 立绘 */
    bs: {
      label: '立绘',
      group: 'sprite',
      icon: 'person-standing',
      text: (d, b) => {
        const pick = hasMapping() && b ? spritePick(b) : null;
        if (pick) return pick.ch.name + ' ' + pick.cloth + (pick.body ? '' : '（缺图）') + ' 表情 ' + d.face;
        const who = spriteCha(d.cha);
        return (who ? who.name : '立绘 ' + d.cha) + ' 姿势 ' + d.pose + ' 服装 ' + d.cloth + ' 表情 ' + d.face;
      },
      meta: (d) => [POS_LABEL[d.pos] || '', d.z === '' || d.z == null ? '' : 'z' + d.z].filter(Boolean).join(' '),
      code: (d) => [dsl('bs', d.cha, d.pose, d.cloth, d.face, d.l, d.pos, d.z, d.x, d.y, d.lyr)],
      fields: [
        { key: 'sprite', label: '立绘', type: 'sprite', full: true },
        {
          key: 'l',
          label: '底图分辨率',
          type: 'select',
          group: '底图',
          options: () => [
            { value: '-1', label: '默认' },
            { value: '0', label: 'L' },
            { value: '1', label: 'U' },
            { value: '2', label: 'S' },
            { value: '-10', label: '小头像' },
          ],
        },
        {
          key: 'pos',
          label: '站位',
          type: 'segmented',
          group: '站位',
          options: [
            { value: '', label: '无' },
            { value: 'l', label: '左' },
            { value: 'm', label: '中' },
            { value: 'r', label: '右' },
          ],
        },
        { key: 'x', type: 'vector', label: '位置', keys: ['x', 'y', 'z'], places: ['x', 'y', 'z'], group: '位置' },
        { key: 'lyr', label: '图层', type: 'number', min: 0, max: 9, group: '位置' },
      ],
    },
    bsfade: {
      label: '清除立绘',
      group: 'sprite',
      icon: 'eraser',
      text: () => '全场立绘淡出',
      code: () => ['[bsfade]'],
      fields: [],
    },
    bs_fade: {
      label: '立绘退场',
      group: 'sprite',
      icon: 'log-out',
      text: (d) => (spriteCha(d.cha) ? spriteCha(d.cha).name : '立绘 ' + d.cha),
      meta: (d) => FADE_LABEL[d.mode] || '',
      code: (d) => [dsl('bs_fade', d.cha, d.mode)],
      fields: [
        { key: 'cha', label: '角色', type: 'chaPick' },
        {
          key: 'mode',
          label: '退场方向',
          type: 'select',
          options: () => [
            { value: '1', label: '向右' },
            { value: '2', label: '向左' },
            { value: '3', label: '向下' },
            { value: '4', label: '向上' },
          ],
        },
      ],
    },
    bs_move: {
      label: '立绘移动',
      group: 'sprite',
      icon: 'move',
      text: (d) => (spriteCha(d.cha) ? spriteCha(d.cha).name : '立绘 ' + d.cha),
      meta: (d) => 'Δx ' + d.dx + ' Δy ' + d.dy,
      code: (d) =>
        d.z === '' || d.z == null
          ? [dsl('bs_move', d.cha, d.dx, d.dy, d.time)]
          : [dsl('bs_move', d.cha, d.dx, d.dy, d.z, d.time)],
      fields: [
        { key: 'cha', label: '角色', type: 'chaPick' },
        { key: 'dx', type: 'vector', label: '位移', keys: ['dx', 'dy'], places: ['dx', 'dy'] },
        { key: 'z', label: 'z', type: 'number', placeholder: '空 = 不改' },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms' },
      ],
    },
    bs_color: {
      label: '立绘着色',
      group: 'sprite',
      icon: 'palette',
      text: (d) => (spriteCha(d.cha) ? spriteCha(d.cha).name : '立绘 ' + d.cha),
      meta: (d) => d.r + ' ' + d.g + ' ' + d.b,
      code: (d) => [dsl('bs_color', d.cha, d.r, d.g, d.b)],
      fields: [
        { key: 'cha', label: '角色', type: 'chaPick' },
        { key: 'r', type: 'vector', label: 'RGB', keys: ['r', 'g', 'b'], places: ['R', 'G', 'B'], min: 0, max: 255 },
      ],
    },
    bs_ani: {
      label: '立绘小动作',
      group: 'sprite',
      icon: 'activity',
      text: (d) => (spriteCha(d.cha) ? spriteCha(d.cha).name : '立绘 ' + d.cha),
      meta: (d) => '动作 ' + d.no,
      code: (d) => [dsl('bs_ani', d.cha, d.no)],
      fields: [
        { key: 'cha', label: '角色', type: 'chaPick' },
        { key: 'no', label: '动作编号', type: 'number', min: 0 },
      ],
    },

    /* 声音 */
    bgm: {
      label: 'BGM',
      group: 'audio',
      icon: 'music',
      text: (d) => '曲目 ' + (d.no === '' ? '?' : d.no),
      meta: (d) => {
        const m = mapAudio('bgm', d.no);
        return m && m.name ? m.name : '';
      },
      warn: (d) => d.no === '',
      code: (d) => [dsl('bgm', d.no)],
      fields: [{ key: 'no', label: '曲目编号', type: 'number', min: 1, req: true, placeholder: '1–70' }],
    },
    bgmstop: {
      label: '停止 BGM',
      group: 'audio',
      icon: 'volume-x',
      text: (d) => (d.time === '' || d.time == null ? '立即停止' : '淡出 ' + d.time + 'ms'),
      code: (d) => [dsl('bgmstop', d.time)],
      fields: [{ key: 'time', label: '淡出时长', type: 'number', min: 0, step: 100, unit: 'ms', placeholder: '空 = 立即' }],
    },
    se: {
      label: '音效',
      group: 'audio',
      icon: 'volume-2',
      text: (d) => '音效 ' + (d.no === '' ? '?' : d.no),
      meta: (d) => {
        const m = mapAudio('se', d.no);
        const mode = d.mode === 'loop' ? '循环' : d.mode === 'end' ? '停止' : '单次';
        return [m && m.name ? m.name : '', mode].filter(Boolean).join('  ');
      },
      warn: (d) => d.no === '',
      code: (d) => {
        if (!d.mode) return [dsl('se', d.no)];
        const time = d.time === '' ? 0 : d.time;
        if (d.mode === 'end') return [dsl('se', d.no, 'end', time)];
        return [d.vol === '' ? dsl('se', d.no, 'loop', time) : dsl('se', d.no, 'loop', d.vol, time)];
      },
      fields: [
        { key: 'no', label: '音效编号', type: 'number', min: 1, req: true },
        {
          key: 'mode',
          label: '模式',
          type: 'segmented',
          rerender: true,
          options: [
            { value: '', label: '单次' },
            { value: 'loop', label: '循环' },
            { value: 'end', label: '停止' },
          ],
        },
        { key: 'vol', label: '音量', type: 'number', min: 0, show: (d) => d.mode === 'loop' },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms', show: (d) => !!d.mode },
      ],
    },

    /* 演出 */
    wait: {
      label: '等待',
      group: 'staging',
      icon: 'clock',
      text: (d) => (d.time || 0) + 'ms',
      code: (d) => [dsl('wait', d.time)],
      fields: [{ key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms' }],
    },
    shake: {
      label: '震屏',
      group: 'staging',
      icon: 'vibrate',
      text: (d) => (d.num || 0) + ' 次',
      meta: (d) => '模式 ' + d.mode + '  幅度 ' + d.width,
      code: (d) => [dsl('shake', d.num, d.mode, d.width)],
      fields: [
        { key: 'num', type: 'vector', label: '参数', keys: ['num', 'mode', 'width'], places: ['次数', '模式', '幅度'], min: 0 },
      ],
    },
    motion: {
      label: '主舞台移动',
      group: 'staging',
      icon: 'move-3d',
      text: (d) => '(' + d.x + ', ' + d.y + ', ' + d.z + ')',
      meta: (d) => (d.time ? d.time + 'ms' : ''),
      code: (d) => [dsl('motion', d.x, d.y, d.z, d.time)],
      fields: [
        { key: 'x', type: 'vector', label: '位置', keys: ['x', 'y', 'z'], places: ['x', 'y', 'z'] },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms' },
      ],
    },
    v3d: {
      label: '镜头',
      group: 'staging',
      icon: 'camera',
      text: (d) => '(' + d.x + ', ' + d.y + ', ' + d.z + ')',
      meta: (d) => (d.time === '' || d.time == null ? '瞬移' : d.time + 'ms'),
      code: (d) => [dsl('v3d', d.x, d.y, d.z, d.time)],
      fields: [
        { key: 'x', type: 'vector', label: '位置', keys: ['x', 'y', 'z'], places: ['x', 'y', 'z'] },
        { key: 'time', label: '时长', type: 'number', min: 0, step: 100, unit: 'ms', placeholder: '空 = 瞬移' },
      ],
    },
    snow: {
      label: '粒子',
      group: 'staging',
      icon: 'snowflake',
      text: (d) => (d.no === '' || d.no == null ? '停止粒子' : '粒子 ' + d.no),
      code: (d) => [dsl('snow', d.no)],
      fields: [{ key: 'no', label: '粒子编号', type: 'number', min: 0, placeholder: '空 = 停止' }],
    },
    fog: {
      label: '雾',
      group: 'staging',
      icon: 'cloud-fog',
      text: () => '雾气',
      code: () => ['[fog]'],
      fields: [],
    },
    endback: {
      label: 'FIN 演出',
      group: 'staging',
      icon: 'flag',
      text: (d) => '收尾编号 ' + (d.no === '' ? '?' : d.no),
      code: (d) => [dsl('endback', d.no)],
      fields: [{ key: 'no', label: '编号', type: 'number', min: 0 }],
    },

    /* 变量 */
    global_set: {
      label: '写全局变量',
      group: 'vars',
      icon: 'variable',
      mono: true,
      text: (d) => 'G[' + d.no + '] = ' + d.value,
      code: (d) => [dsl('global_set', d.no, d.value)],
      fields: [
        { key: 'no', label: '变量编号', type: 'number', min: 0, req: true },
        { key: 'value', label: '值', type: 'text', mono: true },
      ],
    },
    global_eq: {
      label: '条件跳转',
      group: 'vars',
      icon: 'git-branch',
      mono: true,
      text: (d) => 'G[' + d.no + '] == ' + d.value,
      meta: (d) => (bareName(d.target) ? '不等跳到 ' + bareName(d.target) : ''),
      warn: (d) => !bareName(d.target),
      code: (d) => [dsl('global_eq', d.no, d.value, asTarget(d.target))],
      fields: [
        { key: 'no', label: '变量编号', type: 'number', min: 0, req: true },
        { key: 'value', label: '值', type: 'text', mono: true },
        { key: 'target', label: '不等则跳到', type: 'text', mono: true, list: 'labels' },
      ],
    },

    /* 备注 */
    note: {
      label: '注释',
      group: 'note',
      icon: 'sticky-note',
      hideCode: true,
      text: (d) => d.text || '空注释',
      empty: (d) => !d.text,
      code: (d) => ['# ' + String(d.text || '').replace(/\s*\r?\n\s*/g, ' ')],
      fields: [{ key: 'text', label: '内容', type: 'textarea', full: true, rows: 3 }],
    },
    /* 逃生通道：一整行 DSL 原样写入，不解释命令和参数 */
    custom: {
      label: '自定义指令',
      group: 'custom',
      icon: 'terminal',
      mono: true,
      hideCode: true,
      text: (d) => d.line || '空指令',
      empty: (d) => !d.line,
      warn: (d) => !/^\s*\[[\s\S]+\]\s*$/.test(String(d.line || '')),
      code: (d) => [d.line || ''],
      fields: [{ key: 'line', label: '指令', type: 'text', mono: true, full: true, placeholder: '[命令,参数…]' }],
    },
  };

  /* Flat UI 调色板的每个色值明暗差别很大，按对比度自动选黑字或白字 */
  function luminance(hex) {
    const c = hex.replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function onColorFor(hex) {
    const L = luminance(hex);
    const inkL = 0.017;
    const contrast = (Math.max(L, inkL) + 0.05) / (Math.min(L, inkL) + 0.05);
    return contrast >= 4.5 ? '#24211d' : '#ffffff';
  }

  function buildTypeSheet() {
    const rules = Object.keys(TYPES).map((key) => {
      const color = GROUPS[TYPES[key].group].color;
      const on = onColorFor(color);
      const light = on === '#24211d';
      return (
        '.block[data-type="' + key + '"],.palette-item[data-type="' + key + '"],.inspector-kind[data-type="' + key + '"]{--bt:' +
        color +
        ';--on-bt:' +
        on +
        ';--fg-body:' +
        (light ? '82%' : '92%') +
        ';--fg-muted:' +
        (light ? '62%' : '74%') +
        '}'
      );
    });
    const style = document.createElement('style');
    style.id = 'type-sheet';
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
  }

