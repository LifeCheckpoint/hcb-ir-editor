# 立绘位置 / HZC offset / RFVP 验证记录

> 记录时间：2026-11-25  
> 对应代码：`ede504e Read HZC draw offsets and pivots into sprite metadata`  
> 本文只整理已经做过的检查和实验；没有改变运行代码。
>
> fvpanalysis 的文档早期由 AI 整理，个别参数顺序/语义可能不完全准确；本文以实际 py 脚本、HZC 字节和 RFVP 运行结果为优先依据，文档结论只作为线索。

## 1. 结论摘要

- HZC 头里的 `offsetX / offsetY` 是**图像在游戏画面中的显示偏移**，不是 `bs` 的舞台坐标，也不是 mapping 的字段。
- mapping 只负责逻辑绑定：
  ```text
  cha / pose / cloth / face
  → body 文件名 / sheet 文件名
  ```
- 扫描时从 HZC 读取 offset/pivot，存在资源条目上；不要复制到 mapping，否则资源重打包后容易过期。
- 表情表的 offset 已经参与预览的叠脸；全身图的 offset 目前只读取、不参与舞台定位。
- 直接把全身图 offset 加到预览 `left/bottom` 会明显推出画面，已撤回。
- RFVP 测试已经确认：只调用 `bs` 不会创建 Sprite；按 fvpanalysis 的说明，还需要后续 `$chara_disp`（`f_00060441`）提交显示。
- Simple .hcb Editor 的 `hcb_build.py` 里 `bs` 推栈顺序是 `l, pos, nil, z, x, y, nil, lyr, nil, nil`。这一点以 py 脚本为准；早期文档里关于 X/Y 顺序的说法只作为待验证项。

## 2. HZC 头字段

标准 44 字节 HZC/NVSG 头：

| 偏移 | 字段 | 说明 |
|---:|---|---|
| `0x18` | `offsetX` | signed int16，游戏内显示偏移 X |
| `0x1A` | `offsetY` | signed int16，游戏内显示偏移 Y |
| `0x1C` | pivot/unknown | 当前按保留处理 |
| `0x1E` | pivot/unknown | 当前按保留处理 |

实测春 制服：

```text
body   offset 678,415   pivot 0,0
sheet  offset 325,157   pivot 0,0
L      offset 583,282
U      offset 358,215
```

- `sheet` 的 offset 是脸格在身体图上的位置，预览已经使用。
- `body` 的 offset 是整张身体图的绘制偏移，当前没有直接用于舞台定位。
- 立绘 L/U 变体的 offset 不同，说明它不是 mapping 里固定的一行数据。

## 3. mapping 是否应存偏移

不存。

原因：

- offset 是 HZC 资源自身的元数据，随图片或重打包变化。
- mapping 存的是逻辑绑定，不是二进制布局。
- 同一立绘的 L/U 变体 offset 不同，写进 mapping 会需要额外变体字段，重复且容易失配。
- 扫描已经能读到 offset；只有没有 HZC 的场景才需要兜底，而那种场景也没有立绘可显示。

如果以后确实需要自定义资源覆盖，可以作为**可选覆盖字段**加入 mapping，但不能作为默认数据源。

## 4. 当前代码状态

- `electron/scan.js` 读取 HZC `24/26` 和 `28/30`，保存为 `offsetX/offsetY/pivotX/pivotY`，同时保留 `faceX/faceY` 兼容字段。
- `src/resource-store.js` 的 body/sheet 元数据带 offset/pivot。
- `src/app/model.js` 的 stageState 会保存 body offset，但 `stageCard` 没有应用 body offset。
- 预览中：
  - sheet offset 用于表情合成。
  - body offset 暂不参与角色舞台位置。
- mapping 没有新增 offset 字段。

## 5. 预览里的位置语义

当前预览大致是：

```text
position = 舞台站位 + bs.x / bs.y
屏幕位置 = 相机变换(position)
```

HZC body offset **不能**直接作为这个公式里的 `x/y` 追加。它不是角色站位，而是图像绘制偏移；需要先确定 body 图所在的构图画布和统一缩放基准。

目前没有把 body offset 接入舞台定位，避免出现“看起来能调、但和游戏不一致”的假对齐。

## 6. RFVP 验证记录

### 6.1 能跑通的部分

- Windows 预编译版 RFVP 能启动。
- 用游戏目录 `*.bin` 硬链接可以建立测试目录。
- 完整 `Sakura.hcb` 能进入标题、New Game 和游戏画面。
- 最小 HCB 能显示背景、白屏和 `[dia]`。
- 在测试入口前调用 `0x1e7d` 后，`[dia]` 能正常出字。

### 6.2 没跑通的部分

用 `base.chb` 拼的测试 HCB：

- `[bs]` 调用返回，但没有创建 Sprite。
- `RFVP_TRACE=prim,prim_tree` 只看到根 Group：
  ```text
  PrimTree(root=0, custom_root=0, ...)
  #0 type=PrimTypeGroup
  ```
- 换角色、`l`、位置参数都没有产生 Sprite。
- 真实游戏 `Sakura.hcb` 的 `bs` 在 `0x58B8C`，`base.chb` 的 `bs` 在 `0x43F97`；两套函数内部辅助调用不同。
- 把测试代码追加到 `Sakura.hcb` 并改入口会黑屏；补 InitStack 也不完整。
- 通过标题 New Game 进入测试场景后，仍然只验证到背景和文字。

### 6.3 fvpanalysis 提供的线索

仓库里的 `立绘相关KS宏与HCB函数对照.txt` 和 `f_00060441详细解析.md` 说明：

```text
$chara       f_00058B8C   立绘登记/加载/更新
$chara_disp  f_00060441   批量提交 alpha、XY、Z、Parts
```

因此 `bs` 本身只登记状态，真正创建/提交显示还需要 `$chara_disp`。

这很可能是测试 HCB 里 `bs` 没有 Sprite 的原因。下次测试应调用：

```text
bs(...)
chara_disp(...)
```

`f_00060441` 的调用形式是：

```text
f_00060441(unused, a1, a2, a3)
```

常见调用：

```text
f_00060441(1, nil, nil, nil)
```

但具体 HCB 编码仍需以实际 py 脚本和真实调用样本为准。

## 7. 当前未决问题

1. `$chara_disp` 在测试 HCB 中的准确参数和调用时机。
2. 真实 `Sakura.hcb` 的 `bs`/`chara_disp` 入口如何在保留标题初始化的情况下注入测试场景。
3. body HZC offset 的构图画布和统一缩放基准未知。
4. Simple py 的 `bs` 推栈顺序与早期文档的 Y/X 顺序差异，需要真实 HCB 调用验证。
5. body offset 是否正确参与 `PrimSetXY`，还是只参与 graph 绘制原点。

## 8. 下一步建议

按优先级：

1. 用真实 `Sakura.hcb` 的 `bs`（`0x58B8C`）和 `chara_disp`（`0x60441`）构造最小测试，确认 `PrimTree` 出现 `PrimTypeSprite`。
2. 出现 Sprite 后，再对比 `body.offsetX/Y` 与 `PrimTree` 的 `x/y`、`z`、`w/h`。
3. 分别截图 `l=-1 / L / U`，确定 body offset 是屏幕偏移、图内偏移还是 pivot。
4. 确认后再决定是否需要项目设置或映射覆盖字段。

在此之前，预览继续使用现有的站位/x/y 算法，不把 body offset 直接叠加到舞台位置。
