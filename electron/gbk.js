/**
 * GBK 编码：Simple .hcb Editor 用 open(script, 'r', encoding='gbk') 读脚本，
 * 导出的 DSL 必须是 GBK，不能直接写 UTF-8。
 *
 * Node 没有 GBK encoder，这里反向用 TextDecoder('gbk') 建表：
 * 把所有双字节 GBK 序列一次解码，得到「字符 → 字节」映射（23940 个），
 * ASCII 直接取码位。表建一次缓存。
 */

let table = null;

function build() {
  if (table) return table;
  const pairs = [];
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      pairs.push(lead, trail);
    }
  }
  const buf = Buffer.from(pairs);
  const text = new TextDecoder('gbk').decode(buf);
  const map = new Map();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\uFFFD') continue;
    if (!map.has(ch)) map.set(ch, [buf[2 * i], buf[2 * i + 1]]);
  }
  table = map;
  return map;
}

function encodeGbk(input) {
  const map = build();
  const out = [];
  const bad = new Set();
  for (const ch of String(input == null ? '' : input)) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const hit = map.get(ch);
    if (hit) out.push(hit[0], hit[1]);
    else bad.add(ch);
  }
  return { bytes: Buffer.from(out), bad: [...bad] };
}

module.exports = { encodeGbk };
