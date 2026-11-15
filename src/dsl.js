/* ==========================================================================
   DSL 读入：把 Simple .hcb Editor 的脚本拆成原语块
   脚本是「一行一条指令」的纯文本：
     [命令,参数…]   一条原语
     ::标签         跳转用的标签
     # 注释         注释（含被注释掉的指令）
   这里只做语法层，不碰界面；编码解码也放在这里，导入时可以换编码重读。
   ========================================================================== */

(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 编码
   * ------------------------------------------------------------------ */

  const ENCODINGS = [
    { value: 'auto', label: '自动（逐行判断）' },
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'gb18030', label: 'GBK / GB18030' },
    { value: 'shift_jis', label: 'Shift-JIS' },
    { value: 'utf-16le', label: 'UTF-16 LE' },
  ];

  const encLabel = (value) => (ENCODINGS.find((e) => e.value === value) || { label: value }).label;

  const stripBom = (s) => s.replace(/^\uFEFF/, '');

  function toBytes(input) {
    if (!input) return new Uint8Array(0);
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input.buffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    if (Array.isArray(input)) return new Uint8Array(input);
    return new Uint8Array(0);
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const utf8 = () => new TextDecoder('utf-8', { fatal: true });
  const plain = (enc) => new TextDecoder(enc);

  /* 没有 BOM 的 UTF-16：看零字节比例 */
  function looksUtf16(bytes) {
    const n = Math.min(bytes.length, 4096);
    if (n < 4) return null;
    let zeros = 0;
    for (let i = 0; i < n; i++) if (bytes[i] === 0) zeros++;
    if (zeros / n < 0.2) return null;
    return bytes[0] === 0 || bytes[1] !== 0 ? 'utf-16be' : 'utf-16le';
  }

  /* 自动：有 BOM 按 BOM；否则逐行试 UTF-8，失败的那行按 GBK */
  function decodeAuto(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return finish(plain('utf-8').decode(bytes), 'utf-8', null);
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return finish(plain('utf-16le').decode(bytes), 'utf-16le', null);
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return finish(plain('utf-16be').decode(bytes), 'utf-16be', null);
    }
    const u16 = looksUtf16(bytes);
    if (u16) return finish(plain(u16).decode(bytes), u16, null);

    // 0x0A 不会出现在 UTF-8 / GBK 的多字节序列里，可以按字节切行
    let start = 0;
    let ok = 0;
    let gbk = 0;
    const lines = [];
    for (let i = 0; i <= bytes.length; i++) {
      if (i !== bytes.length && bytes[i] !== 0x0a) continue;
      let end = i;
      if (end > start && bytes[end - 1] === 0x0d) end--;
      const seg = bytes.subarray(start, end);
      try {
        lines.push(utf8().decode(seg));
        ok++;
      } catch (_) {
        lines.push(plain('gb18030').decode(seg));
        gbk++;
      }
      start = i + 1;
    }
    const encoding = gbk === 0 ? 'utf-8' : ok === 0 ? 'gbk' : 'mixed';
    return { text: stripBom(lines.join('\n')), encoding, detail: { utf8: ok, gbk } };
  }

  function decodeAs(bytes, encoding) {
    const name = encoding === 'gbk' ? 'gb18030' : encoding;
    try {
      return finish(new TextDecoder(name, { fatal: true }).decode(bytes), encoding, null);
    } catch (err) {
      return { error: '这段字节不是合法的 ' + encLabel(encoding) };
    }
  }

  function finish(text, encoding, detail) {
    return { text: stripBom(text), encoding, detail };
  }

  function decode(input, encoding) {
    const bytes = toBytes(input);
    if (!bytes.length) return { text: '', encoding: encoding || 'utf-8', detail: null };
    if (!encoding || encoding === 'auto') return decodeAuto(bytes);
    return decodeAs(bytes, encoding);
  }

  /* ------------------------------------------------------------------ *
   * 解析
   * ------------------------------------------------------------------ */

  const clean = (v) => String(v == null ? '' : v).trim();
  const argAt = (args, i) => (i < args.length ? clean(args[i]) : '');

  const LOAD_TYPES = new Set(['bgload', 'cgload', 'chaload', 'note', 'custom']);

  function splitArgs(body) {
    if (body === '') return [];
    return body.split(',').map(clean);
  }

  /* 一条原语 → 块；多出来的参数原样留在块尾 */
  function toBlock(cmd, args) {
    const at = (i) => argAt(args, i);
    const extra = (from) => (args.length > from ? args.slice(from) : null);
    const out = (type, data, from) => {
      const ex = extra(from);
      const block = { type, data: data || {} };
      if (ex && ex.length) block.extra = ex;
      return block;
    };

    switch (cmd) {
      case 'start':
        return out('start', {}, 0);
      case 'end':
        return out('end', {}, 0);
      case 'ssel':
        return out('ssel', {}, 0);
      case 'white':
        return out('white', {}, 0);
      case 'black':
        return out('black', {}, 0);
      case 'movie':
        return out('movie', {}, 0);
      case 'fog':
        return out('fog', {}, 0);
      case 'bsfade':
        return out('bsfade', {}, 0);
      case 'jump':
        return out('jump', { target: at(0) }, 1);
      case 'achieve':
        return out('achieve', { no: at(0) }, 1);
      case 'chaload':
        return out('chaload', { name: at(0), aliases: args.slice(1).join(',') }, args.length);
      case 'cha': {
        const who = at(0);
        const slash = who.indexOf('/');
        return out(
          'cha',
          {
            name: slash > 0 ? who.slice(0, slash) : who,
            show: slash > 0 ? who.slice(slash + 1) : '',
            voice: at(1),
          },
          2
        );
      }
      case 'dia':
        return out('dia', { text: at(0), size: at(1) }, 2);
      case 'msg':
        return out('msg', { mode: at(0) }, 1);
      case 'bg':
        return out('bg', { id: at(0), diff: at(1) }, 2);
      case 'bgload':
        return out('bgload', { id: at(0), file: at(1), name: at(2) }, 3);
      case 'cgload':
        return out('cgload', { name: at(0) }, 1);
      case 'cg': {
        if (args.length >= 5) {
          return out(
            'cg',
            { name: at(0), keep: false, x: at(1), y: at(2), zoom: at(3), time: at(4) },
            5
          );
        }
        return out('cg', { name: at(0), keep: true, x: 0, y: 0, zoom: 2000, time: at(1) }, 2);
      }
      case 'eyecatch':
        return out('eyecatch', { no: at(0) }, 1);
      case 'effect':
        return out('effect', { no: at(0), time: at(1) }, 2);
      case 'bs':
        return out(
          'bs',
          {
            cha: at(0),
            pose: at(1),
            cloth: at(2),
            face: at(3),
            l: at(4),
            pos: at(5),
            z: at(6),
            x: at(7),
            y: at(8),
            lyr: at(9),
          },
          10
        );
      case 'bs_fade':
        return out('bs_fade', { cha: at(0), mode: at(1) }, 2);
      case 'bs_move':
        return out(
          'bs_move',
          args.length >= 5
            ? { cha: at(0), dx: at(1), dy: at(2), z: at(3), time: at(4) }
            : { cha: at(0), dx: at(1), dy: at(2), z: '', time: at(3) },
          5
        );
      case 'bs_color':
        return out('bs_color', { cha: at(0), r: at(1), g: at(2), b: at(3) }, 4);
      case 'bs_ani':
        return out('bs_ani', { cha: at(0), no: at(1) }, 2);
      case 'bgm':
        return out('bgm', { no: at(0) }, 1);
      case 'bgmstop':
        return out('bgmstop', { time: at(0) }, 1);
      case 'se':
        return out(
          'se',
          args.length >= 4
            ? { no: at(0), mode: at(1), vol: at(2), time: at(3) }
            : { no: at(0), mode: at(1), vol: '', time: at(2) },
          4
        );
      case 'wait':
        return out('wait', { time: at(0) }, 1);
      case 'shake':
        return out('shake', { num: at(0), mode: at(1), width: at(2) }, 3);
      case 'motion':
        return out('motion', { x: at(0), y: at(1), z: at(2), time: at(3) }, 4);
      case 'v3d':
        return out('v3d', { x: at(0), y: at(1), z: at(2), time: at(3) }, 4);
      case 'snow':
        return out('snow', { no: at(0) }, 1);
      case 'endback':
        return out('endback', { no: at(0) }, 1);
      case 'global_set':
        return out('global_set', { no: at(0), value: at(1) }, 2);
      case 'global_eq':
        return out('global_eq', { no: at(0), value: at(1), target: at(2) }, 3);
      default:
        return null;
    }
  }

  function labelBlock(name) {
    return { type: 'label', data: { name } };
  }

  function sectionTitle(section) {
    if (section.label) return section.label;
    const onlyLoads = section.blocks.length && section.blocks.every((b) => LOAD_TYPES.has(b.type));
    return onlyLoads ? '预载' : '开头';
  }

  function parse(text, options) {
    options = options || {};
    const split = options.split !== false;
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rawLines = src.split(/\r\n|\r|\n/);

    const stats = {
      lines: rawLines.length,
      blank: 0,
      comments: 0,
      labels: 0,
      blocks: 0,
      options: 0,
      unknown: {},
      unknownLines: 0,
      unterminatedSel: 0,
    };

    const sections = [];
    let cur = { label: null, blocks: [] };
    let pendingSel = null;

    const push = (block) => {
      cur.blocks.push(block);
      stats.blocks++;
    };

    const flushSel = () => {
      if (!pendingSel) return false;
      stats.unterminatedSel++;
      push({ type: 'sel', data: { prompt: pendingSel.prompt, options: pendingSel.options } });
      pendingSel = null;
      return true;
    };

    rawLines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        stats.blank++;
        return;
      }
      if (line[0] === '#') {
        const body = line.slice(1).trim();
        if (!body) {
          stats.blank++;
          return;
        }
        stats.comments++;
        push({ type: 'note', data: { text: body } });
        return;
      }
      if (line.startsWith('::')) {
        const name = line.slice(2).trim();
        if (!name) {
          stats.blank++;
          return;
        }
        stats.labels++;
        if (split && cur.blocks.length) {
          sections.push(cur);
          cur = { label: name, blocks: [] };
        } else if (!cur.label) {
          cur.label = name;
        }
        push(labelBlock(name));
        return;
      }
      if (line[0] === '[' && line[line.length - 1] === ']') {
        const parts = splitArgs(line.slice(1, -1));
        const cmd = (parts.shift() || '').toLowerCase();
        if (cmd === 'sel') {
          const kind = String(parts[0] || '').toLowerCase();
          if (kind === 'start') {
            flushSel();
            pendingSel = { prompt: argAt(parts, 1), options: [] };
            return;
          }
          if (kind === 'op') {
            if (!pendingSel) {
              stats.unknownLines++;
              stats.unknown.sel = (stats.unknown.sel || 0) + 1;
              push({ type: 'custom', data: { line } });
              return;
            }
            pendingSel.options.push({ text: argAt(parts, 1), target: argAt(parts, 2) });
            stats.options++;
            return;
          }
          if (kind === 'end') {
            flushSel();
            return;
          }
        }
        const block = toBlock(cmd, parts);
        if (block) {
          push(block);
        } else {
          stats.unknownLines++;
          stats.unknown[cmd || '?'] = (stats.unknown[cmd || '?'] || 0) + 1;
          push({ type: 'custom', data: { line } });
        }
        return;
      }
      // 不以 [ 或 :: 开头的行：原样保留，不猜
      stats.unknownLines++;
      push({ type: 'custom', data: { line } });
    });

    if (pendingSel) {
      flushSel();
    }
    if (cur.blocks.length) sections.push(cur);

    sections.forEach((s) => {
      s.title = sectionTitle(s);
    });

    stats.sections = sections.length;
    stats.empty = stats.blocks === 0;

    return { sections, stats };
  }

  root.HCB_DSL = {
    ENCODINGS,
    encLabel,
    decode,
    base64ToBytes,
    parse,
  };
})(typeof window !== 'undefined' ? window : globalThis);
