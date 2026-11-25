# 立绘位置 / HZC offset / RFVP 验证记录

> 记录时间：2026-11-25，实机补充 2026-11-26  
> 对应代码：`ede504e Read HZC draw offsets and pivots into sprite metadata`  
> 本文只整理已经做过的检查和实验；没有改变运行代码。
>
> fvpanalysis 的文档早期由 AI 整理，个别参数顺序/语义可能不完全准确；本文以实际 py 脚本、HZC 字节和实机运行结果为优先依据，文档结论只作为线索。

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
- RFVP 旧测试里“只调用 `bs` 不会创建 Sprite”的结论**不适用于这个可执行版本**：用同版本 `Sakura_cn.exe` + `hcb_build.py` 编译的最小 `game.chb`，`bs` 能直接出立绘；旧测试失败更可能是 `base.chb` / 入口不匹配，而不是 `bs` 本身不创建 Sprite。
- Simple .hcb Editor 的 `hcb_build.py` 里 `bs` 推栈顺序是 `l, pos, nil, z, x, y, nil, lyr, nil, nil`。这一点以 py 脚本为准；早期文档里关于 X/Y 顺序的说法只作为待验证项。

## 1.1 实机验证（2026-11-26，`祈愿与仲夏日之梦`）

测试对象：

```text
D:\Users\Downloads\祈愿与仲夏日之梦
Sakura_cn.exe
game.chb  (SHA256 5225080633E1A8125D98BB46F01B29DB2677D310D4AF733C6AF2AA650D3523B1)
```

该 `game.chb` 与 Simple .hcb Editor 仓库 `示例项目/game.chb` 的 SHA256 完全一致；脚本正文也与 `Script (3).txt` 一致（54334 字节，GBK）。因此可以直接用仓库里的 `hcb_build.py` 离线编译测试脚本，不需要改原游戏。

验证方法：

1. 把原游戏目录的 `graph_*`、`bgm`、`se`、`voice`、`movie` 用 junction 链接到临时目录；
2. 用 `示例项目/base/base.chb` 作为基底，写一个只含 `[bg]` + `[bs]` + `[dia]` 的 `base/Script.txt`，用 `hcb_build.py` 编译成 `.test.chb`；
3. 临时替换 `game.chb`，启动 `Sakura_cn.exe`，用 Win32 `SetCursorPos` / `keybd_event` 过标题，`PrintWindow` 或 `CopyFromScreen` 截图；
4. 不改原目录，不依赖桌面控制工具。

已确认的行为：

- `bs` 能直接创建立绘，不需要额外的 `$chara_disp`。这与第 6 节的旧 RFVP 结论冲突，旧结论应视为测试基座问题。
- 4 参 `[bs,3,1,0,12]` 在场景开始时**不会**创建立绘，画面只有背景；它更像“更新已有立绘的 pose/face”，不是创建。示例脚本里 4 参 `bs` 也都出现在一次完整 `bs` 之后。
- 完整参数 `[bs,3,1,0,12,1,m,1600,0,0,1]` 能出立绘。`z=1600` 时角色明显比 `z=1000` 小；`z` 是深度/缩放，不是屏幕位置。
- `x/y` 是**像素偏移**，不是舞台百分比：`x=-400,y=-400` 会把整张图往左上推，头直接出画，符合“图左上角 + 原始像素偏移”的直觉。
- `pos` 为 `m` 时，立绘并不是以角色中心对齐舞台中心；修复前的 `translateX(-50%)` 与实机不一致。
- 立绘贴图本身很大：`CHR_落葉_基_制服` 为 `1131x2187`，`offset 965,451`，`pivot 0,0`。在 1280x720 画面里必须缩放后才可能完整显示；修复前的固定 `sprite.height=76%` 与实机尺寸不一致。

`l` 参数的一个实测坑：

```text
[bs,3,1,0,12,1,m,1600,0,0,1]    → 正常显示默认身体
[bs,3,1,0,12,-1,m,1000,0,0,1]   → 报错找不到 graph_bs/CHR_落葉_基_制服U
```

- 这个游戏里 `l=-1` 会去找 `U` 后缀，而 `l=1` 使用默认身体；`hcb_build.py` 注释里“1=U，-1=默认”的说法在这个基座上不成立。至少不能把 `-1` 无条件当默认。
- `CHR_落葉_基_制服U` 确实不存在（该游戏只有 `CHR_落葉_基_制服` 和 `_表情`），所以实机会弹错误框，不是静默回退。预览/导入应对缺失变体做回退，不能假设每个 `l` 都有资源。

`bs` 编号也不是 mapping 里的 `cha`：

```text
脚本 [bs,3,...]   → 实机加载 CHR_落葉_*
mapping cha = 3   → CHR_千和_*
```

- `mappings/sakura.toml` 是原版 Sakura 的表，里面没有 `落葉`，也没有这个同人游戏新增的编号；直接拿它给本作做预览会把角色对错。
- 立绘编号必须以当前游戏的 `chaload` / 基底表为准；mapping 的 `cha` 不能当作 `bs` 的第一个参数直接复用。

当前预览与实机的差异（2026-11-26 已按实机修正，`project-settings` 里可微调）：

| 项目 | 旧预览 | 实机观察 / 现在的实现 |
|---|---|---|
| 水平对齐 | `translateX(-50%)` 以锚点居中 | 图左上角按锚点 + `x`，再用图内 pivot 对齐 |
| 尺寸 | 固定 `sprite.height=76%` | 有 HZC 宽高时按 `focal/(z-cam.z)` 和原图尺寸缩放 |
| `x/y` | 按舞台宽高换算 | 原始像素偏移 |
| 4 参 `bs` | 总是创建/覆盖立绘 | 没有已有立绘时不创建；有则只更新姿势/表情 |
| `l` | 按 0/1/2/-1 选变体 | 缺失变体回退默认底图；UI 不再写死 L/U/S |
| 角色编号 | mapping `cha` | mapping 可显式写 `bs`，旧表缺省等于 `cha` |

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
- `src/app/model.js` 的 `stageState` 保存 body offset，但 `stageCard` 仍然不把 body offset 加进位置。
- 预览中：
  - sheet offset 用于表情合成。
  - body offset 只作为元数据保留，不参与舞台定位；实机验证也证明它不是简单屏幕偏移。
- mapping 没有新增 offset 字段。
- 2026-11-26 已实现：
  - `sprite` 行可选 `bs`，旧表省略时等于 `cha`；资源组按 `bs` 建，`cha` 指令仍按角色编号找图。
  - 4 参 `bs` 在没有已有立绘时不创建；有立绘时只更新姿势/表情，保留位置和 z。
  - 缺失 `l` 变体回退到默认底图，不整块消失。
  - 预览的变体键仍沿用 mapping 的 `-1 / 0 / 1 / 2`；本作实机 `l=-1 → U` 的对应关系还没有写进 mapping，所以预览里 `-1` 目前会落到默认底图。不要把预览结果当成 `l` 语义的最终依据。
  - 预览立绘改为原图尺寸 + `focal/(z-cam.z)` 缩放，图内 pivot 对齐，`x/y` 按原始像素偏移。
  - `sprite.height/maxWidth` 只作为拿不到 HZC 宽高时的兜底。


## 5. 预览里的位置语义

当前预览（2026-11-26 之后）：

```text
scale = focal / max(1, z - camera.z)         // focal 默认 1000
w = body.w * scale
h = body.h * scale
left = 舞台站位锚点 + bs.x - w * pivotX - camera.x * scale
top  = 舞台高度 * anchorY + bs.y - h * pivotY - camera.y * scale
```

- `pivotX / pivotY` 是图内锚点，默认 `7% / 11.3%`，落在角色脸部附近。
- `anchorY` 默认 `47.6%`（约 343px / 720p），是图内锚点要落在舞台上的纵向位置。
- 这组默认值是用本作实机 `z=1000` 和 `z=1600` 两张截图拟合的近似值，不是从引擎二进制里读出的硬编码；换游戏/角色可以在项目设置里微调。
- `body offset` 仍然不直接参与这个公式。实机验证显示它不是“把整张图平移 offsetX/offsetY”这么简单。
- 4 参 `bs` 只改 pose/face，不会重置 `pos/z/x/y`。

### 5.1 为什么不是固定 76%

HZC 身体图本身远大于 720p（例：`CHR_落葉_基_制服` 1131×2187）。实机在 `z=1600` 时画面只露出头部到裙摆，腿在画面外；固定 76% 会把立绘缩成小图，和游戏对不上。现在按原图尺寸乘 `focal/z`，允许超出舞台，由 `overflow:hidden` 裁掉，行为更接近实机。

## 6. RFVP 验证记录

### 6.1 能跑通的部分

- Windows 预编译版 RFVP 能启动。
- 用游戏目录 `*.bin` 硬链接可以建立测试目录。
- 完整 `Sakura.hcb` 能进入标题、New Game 和游戏画面。
- 最小 HCB 能显示背景、白屏和 `[dia]`。
- 在测试入口前调用 `0x1e7d` 后，`[dia]` 能正常出字。

### 6.2 没跑通的部分

> 2026-11-26 更正：用同版本 `Sakura_cn.exe` + `示例项目/base/base.chb` 编译的最小 `game.chb` 已经能直接出立绘，说明下面的失败不是“`bs` 本身不创建 Sprite”，而是当时测试 HCB 的基底/入口不匹配。下面的记录只保留为旧实验过程。

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

因此 fvpanalysis 推断 `bs` 本身只登记状态，真正创建/提交显示还需要 `$chara_disp`。

> 2026-11-26 更正：这条推断没有在这个可执行版本上复现。用同版本 `Sakura_cn.exe` + `示例项目/base/base.chb` 编译的最小 `game.chb`，`[bs]` 后直接出立绘；更可能的情况是 `base.chb` 的 `bs` 内部已经包含提交逻辑，而真实 `Sakura.hcb` 的 `bs` 因为基座不同需要额外 `$chara_disp`。以实机为准。

旧计划里的调用形式：

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

1. `pivotX/pivotY/anchorY` 是用本作 `落葉` 的两张截图拟合的；换角色后需要再验证是否应该按 HZC offset 或每角色单独配置。
2. `focal` 目前固定 1000，能拟合 `z=1000/1600` 的大致位置；更精确的焦距/相机模型还没有从引擎里确认。
3. body HZC `offsetX/Y` 在实机绘制里到底参与哪一步：是只给表情表定位，还是同时影响身体图原点。
4. `l` 的完整枚举（`-1` / `0` / `1` / `2` / `-10`）需要按角色资源逐项验证；本作大量角色只有一种身体资源，缺变体会直接弹错，预览现在会回退默认底图。
5. `-10` 小头像的实机行为还没有接入预览；目前只避免把它当普通立绘。

## 8. 下一步建议

1. 用当前游戏的 `chaload`/`bs` 表生成独立 mapping（本作 `bs=3` 是落葉、`bs=14` 是叶月、`bs=2` 是春），不要拿 `mappings/sakura.toml` 的 `cha` 当 `bs` 编号。
2. 对春/落葉/雪々 分别截 `l` 的各个值，确认哪些变体存在、哪些会弹错；把存在的变体写进 mapping 的 `bs` 行。
3. 用同一角色补 `l/m/r` 三张和 `z=2000/2400`，验证 pivot 和焦距默认值。
4. 给 `-10` 小头像补一个单独的渲染分支。

body offset 仍然不直接叠加到舞台位置；如果以后确认它参与绘制原点，再作为可选的 `sprite.pivot` 覆盖字段接入。
