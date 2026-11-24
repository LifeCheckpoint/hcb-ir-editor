#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Sakura.hcb 的 Lua IR 生成资源映射表（mappings/sakura.toml）。

前置：
  1. 用 fvpanalysis 的 hcb_to_ir.py 把 Sakura.hcb 转成 Lua IR：
       python hcb_to_ir.py Sakura.hcb --nls sjis -o .ref/fvp/local --prefix Sakura
  2. 扫描游戏归档，生成映射表需要的条目/格数：
       node tools/dump-mapping-inputs.cjs
  3. 生成：
       python tools/build-mapping.py

立绘编号的来源是 hcb 里的 f_00058B8C：
  a1 = 角色资源组编号（0..19, 21..24）
  a2 = 姿势编号（1 基 / 2 喜 / 3 悲 / 11 幼少基 …）
  a3 = 服装编号（0 制服 / 1 私服 / …；0 是合法值）
  a4 = PartsSelect 的细分表情编号（不是表情表格子号，映射表只记格数）
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

JP_CN = {
    "クロ": "小黑",
    "ハル": "春",
    "千和": "千和",
    "姫織": "姫织",
    "ましろ": "真白",
    "十夜": "十夜",
    "あさひ": "朝日",
    "あず咲": "梓咲",
    "ナナ": "七七",
    "智仁": "智仁",
    "ソル": "索尔",
    "ナハト": "纳哈特",
    "少女": "女孩子",
    "大雅": "大雅",
}

NAME_OVERRIDE = {14: "春２", 19: "サブ５", 24: "千和（24）"}


def q(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def inline_key(key) -> str:
    key = str(key)
    return key if re.match(r"^[A-Za-z0-9_-]+$", key) else q(key)


def inline_value(value) -> str:
    if isinstance(value, str):
        return q(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(inline_value(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = ["%s = %s" % (inline_key(k), inline_value(v)) for k, v in value.items() if v is not None]
        return "{ " + ", ".join(parts) + " }"
    raise TypeError("不能写成内联 TOML 的值: %r" % (value,))


def inline_row(row: dict) -> str:
    parts = ["%s = %s" % (inline_key(k), inline_value(v)) for k, v in row.items() if v is not None]
    return "{ " + ", ".join(parts) + " }"


def emit_rows(out: list[str], name: str, rows: list[dict]) -> None:
    if not rows:
        out += [name + " = []", ""]
        return
    out.append(name + " = [")
    for row in rows:
        out.append("  " + inline_row(row) + ",")
    out += ["]", ""]


def parse_sprite_function(lines: list[str]) -> tuple[dict, list]:
    start = next(i for i, line in enumerate(lines) if line.startswith("function f_00058B8C("))
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("function "))

    bases = []
    for i in range(start, end):
        m = re.match(r'\s*S0 = "graph_bs/(CHR_[^"]+)"', lines[i])
        if not m:
            continue
        a1 = None
        for j in range(i, start, -1):
            if re.match(r"\s*S0 = a1\s*$", lines[j]):
                for k in range(j + 1, min(j + 5, i)):
                    mm = re.match(r"\s*S1 = (-?\d+)\s*$", lines[k])
                    if mm:
                        a1 = int(mm.group(1))
                        break
                if a1 is not None:
                    break
        bases.append({"line": i, "base": m.group(1), "a1": a1})

    groups = []
    for b in bases:
        if not groups or groups[-1]["a1"] != b["a1"]:
            groups.append({"a1": b["a1"], "bases": [], "start": b["line"]})
        groups[-1]["bases"].append(b["base"])
    for i, g in enumerate(groups):
        g["end"] = groups[i + 1]["start"] if i + 1 < len(groups) else end

    def const_at(i: int):
        values, add, sub = [], False, False
        for j in range(i + 1, min(i + 9, len(lines))):
            s = lines[j]
            m = re.match(r"\s*S1 = (-?\d+)\s*$", s)
            m2 = re.match(r"\s*S2 = (-?\d+)\s*$", s)
            if m:
                values.append(int(m.group(1)))
            if m2:
                values.append(int(m2.group(1)))
            if "(S1 + S2)" in s:
                add = True
            if "(S1 - S2)" in s:
                sub = True
            if "(S0 == S1)" in s:
                if not values:
                    return None
                if add and len(values) >= 2:
                    return values[0] + values[1]
                if sub and len(values) >= 2:
                    return values[0] - values[1]
                return values[0]
            if "goto" in s and "set_e" not in s and j > i + 6:
                break
        return None

    chars = {}
    sprites = {}
    for g in groups:
        a1 = g["a1"]
        if a1 is None:
            continue
        poses, cloths, pose_multi, cloth_multi = {}, {}, {}, {}
        for i in range(g["start"], g["end"]):
            m = re.match(r"\s*S0 = (a2|a3)\s*$", lines[i])
            if not m:
                continue
            var = m.group(1)
            n = const_at(i)
            if n is None:
                continue
            suffixes = []
            for j in range(i + 1, min(i + 100, g["end"])):
                if j > i + 2 and (re.match(r"\s*S0 = a[23]\s*$", lines[j]) or "graph_bs/CHR_" in lines[j]):
                    break
                sm = re.match(r'\s*S1 = "(_[^"]+)"\s*$', lines[j])
                if sm and sm.group(1) != "_表情":
                    suffixes.append(sm.group(1))
            if not suffixes:
                continue
            target = poses if var == "a2" else cloths
            multi = pose_multi if var == "a2" else cloth_multi
            target.setdefault(n, suffixes[0])
            multi[n] = suffixes

        base_names = g["bases"]
        # 主角色名：优先取第一个能命中 graph_bs 的 base
        primary = base_names[0]
        for b in base_names:
            if any(b + ps + cs in bs_meta for ps in poses.values() for cs in cloths.values()):
                primary = b
                break
        token = primary[4:]
        name = NAME_OVERRIDE.get(a1, JP_CN.get(token, token))
        aliases = []
        for b in base_names:
            t = b[4:]
            if t != name and t not in aliases:
                aliases.append(t)
        if a1 == 24:
            aliases = []
        chars[a1] = {"no": a1, "name": name, "aliases": aliases}

        for b in base_names:
            for pn, ps in poses.items():
                for cn, cs in cloths.items():
                    for psuf in pose_multi.get(pn, [ps]):
                        for csuf in cloth_multi.get(cn, [cs]):
                            body = b + psuf + csuf
                            if body not in bs_meta:
                                continue
                            key = (a1, pn, cn)
                            if key in sprites:
                                continue
                            sheet = body + "_表情"
                            row = {
                                "cha": a1,
                                "pose": pn,
                                "cloth": cn,
                                "pose_name": psuf[1:],
                                "cloth_name": csuf[1:],
                                "body": body,
                            }
                            if sheet in bs_meta:
                                row["sheet"] = sheet
                                row["faces"] = bs_meta[sheet]["cells"]
                            sprites[key] = row

    return chars, list(sprites.values())


def index_bg_funcs(lines: list[str]) -> dict:
    """一个背景编号通常对应一个函数；取包含该编号 BG 字符串最多的函数。"""
    starts = [i for i, line in enumerate(lines) if line.startswith("function ")]
    ends = starts[1:] + [len(lines)]
    counts: dict = {}
    for i, line in enumerate(lines):
        if '"BG' not in line:
            continue
        for m in re.finditer(r'"BG(\d{3})_', line):
            bid = int(m.group(1))
            k = bisect.bisect_right(starts, i) - 1
            if k < 0:
                continue
            rng = (starts[k], ends[k])
            counts.setdefault(bid, {})
            counts[bid][rng] = counts[bid].get(rng, 0) + 1
    return {bid: max(v, key=v.get) for bid, v in counts.items()}


def bg_variants(lines: list[str], bid: int, a: int, b: int) -> list:
    """解析背景函数里 a7（DSL 的差分参数）→ BG 文件的分支。

    每个 a7 分支内部还可能按 a9/a10=100 切时段/天气（_100/_120）。
    这里取该分支的默认（else）文件，也就是脚本不额外传时段参数时实际加载的那张。
    """
    labels = {}
    for i in range(a, b):
        m = re.match(r"\s*::(BB_[0-9A-F]+)::", lines[i])
        if m:
            labels[m.group(1)] = i
    if not labels:
        return []
    ordered = sorted(labels.items(), key=lambda x: x[1])
    positions = [x[1] for x in ordered]

    def block_end(label: str) -> int:
        pos = labels[label]
        k = bisect.bisect_right(positions, pos)
        return ordered[k][1] if k < len(ordered) else b

    def strings_in(label: str) -> list:
        e = block_end(label)
        out = []
        for i in range(labels[label], e):
            m = re.search(r'"(BG%03d_[^"]*)"' % bid, lines[i])
            if m:
                out.append(m.group(1))
        return out

    def follow(label: str):
        seen = set()
        for _ in range(6):
            if label in seen:
                return None
            seen.add(label)
            ss = strings_in(label)
            if ss:
                return ss[-1]
            e = block_end(label)
            gs = []
            for i in range(labels[label], e):
                m = re.search(r"goto (BB_[0-9A-F]+)", lines[i])
                if m:
                    gs.append(m.group(1))
            if not gs:
                return None
            label = gs[0]
        return None

    out = []
    for i in range(a, b):
        if not re.match(r"\s*S0 = a7\s*$", lines[i]) or i + 2 >= b:
            continue
        m = re.match(r"\s*S1 = (-?\d+)\s*$", lines[i + 1])
        if not m or "(S0 == S1)" not in lines[i + 2]:
            continue
        n = int(m.group(1))
        target = None
        for j in range(i + 3, b):
            mm = re.match(r"\s*::(BB_[0-9A-F]+)::", lines[j])
            if mm:
                target = mm.group(1)
                break
        if not target:
            continue
        file = follow(target)
        if file:
            out.append((n, file))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lua", default=str(ROOT / ".ref/fvp/local/Sakura.lua"))
    parser.add_argument("--in-dir", default=str(ROOT / ".ref/fvp"))
    parser.add_argument("--out", default=str(ROOT / "mappings/sakura.toml"))
    args = parser.parse_args()

    global bs_meta
    in_dir = Path(args.in_dir)
    lines = Path(args.lua).read_text(encoding="utf-8").splitlines()
    bg_funcs = index_bg_funcs(lines)
    bs_meta = json.loads((in_dir / "bs_meta.json").read_text(encoding="utf-8"))
    domain = json.loads((in_dir / "domain.json").read_text(encoding="utf-8"))
    bg_names = set(json.loads((in_dir / "bg_names.json").read_text(encoding="utf-8")))
    cg_names = json.loads((in_dir / "cg_names.json").read_text(encoding="utf-8"))
    raw_loaded = json.loads((in_dir / "cg_loaded.json").read_text(encoding="utf-8"))
    audio_names = json.loads((in_dir / "audio_names.json").read_text(encoding="utf-8"))
    cg_loaded = []
    for n in raw_loaded:
        s = str(n).strip()
        if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
            s = s[1:-1]
        if s and not s.lower().startswith("0x"):
            cg_loaded.append(s)

    chars, sprites = parse_sprite_function(lines)
    sprites.sort(key=lambda r: (r["cha"], r["pose"], r["cloth"]))

    bg_rows = []
    for b in domain["bg"]:
        no = int(b["id"])
        file = "BG%03d_000" % no
        if file not in bg_names:
            variants = sorted(x for x in bg_names if x.startswith("BG%03d_" % no))
            if not variants:
                continue
            file = variants[0]
        vs = []
        rng = bg_funcs.get(no)
        if rng:
            for diff, vfile in bg_variants(lines, no, *rng):
                if diff == 1 or vfile == file:
                    continue
                if not any(v["diff"] == diff for v in vs):
                    vs.append({"diff": diff, "file": vfile})
        bg_rows.append({"no": no, "name": b["name"], "file": file, "variants": vs})

    archive = {}
    for x in cg_names:
        archive.setdefault(x["name"].lower(), x["name"])
    cg_rows, seen = [], set()
    for name in cg_loaded:
        if not name or name in seen:
            continue
        seen.add(name)
        cg_rows.append({"name": name, "file": archive.get(name.lower(), name)})

    out = [
        "# Sakura.hcb 资源映射表（自动生成）",
        "#",
        "# 来源：Sakura.hcb → fvpanalysis hcb_to_ir.py 的 Lua IR；立绘条目/表情格数来自 graph_bs.bin。",
        "# 角色编号 = f_00058B8C 的 a1；pose = a2；cloth = a3（0 合法）。",
        "# 立绘只收录 hcb 实际引用、且 graph_bs.bin 里存在的组合。",
        "# 背景默认 _000；没有 _000 的取第一个变体；a7 差分写成 bg.variants 内联表。",
        "# 差分分支里 a9/a10=100 的时段/天气版本没有并入：那需要额外参数，DSL 的 diff 只选默认分支。",
        "# CG 来自 cg_loaded.txt；BGM / 音效按归档条目全量列出；voice 段留给人工/agent 补。",
        "#",
        "# 统计：角色 %d，立绘 %d，背景 %d，CG %d，BGM %d，音效 %d"
        % (
            len(chars),
            len(sprites),
            len(bg_rows),
            len(cg_rows),
            len(audio_names.get("bgm", [])),
            len(audio_names.get("se", [])),
        ),
        "",
        "# —— 角色 ——",
        "",
    ]
    character_rows = []
    for no in sorted(chars):
        c = chars[no]
        row = {"no": no, "name": c["name"]}
        if c["aliases"]:
            row["aliases"] = c["aliases"]
        character_rows.append(row)
    emit_rows(out, "character", character_rows)

    out += ["# —— 立绘 ——", ""]
    emit_rows(out, "sprite", sprites)

    out += ["# —— 背景 ——", ""]
    bg_inline = []
    for b in bg_rows:
        row = {"no": b["no"], "name": b["name"], "file": b["file"]}
        if b.get("variants"):
            row["variants"] = {str(v["diff"]): v["file"] for v in b["variants"]}
        bg_inline.append(row)
    emit_rows(out, "bg", bg_inline)

    out += ["# —— CG ——", ""]
    cg_inline = []
    for c in cg_rows:
        row = {"name": c["name"]}
        if c["file"] != c["name"]:
            row["file"] = c["file"]
        cg_inline.append(row)
    emit_rows(out, "cg", cg_inline)

    out += ["# —— 音频 ——", ""]
    bgm_rows = [{"no": int(name), "file": name} for name in audio_names.get("bgm", [])]
    se_rows = [{"no": int(name), "file": name} for name in audio_names.get("se", [])]
    emit_rows(out, "bgm", bgm_rows)
    emit_rows(out, "se", se_rows)

    Path(args.out).write_text("\n".join(out), encoding="utf-8")
    print("wrote %s: %d characters, %d sprites, %d bg, %d cg" % (args.out, len(chars), len(sprites), len(bg_rows), len(cg_rows)))


if __name__ == "__main__":
    main()
