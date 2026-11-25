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
- `pos` 为 `m` 时，立绘并不是以角色中心对齐舞台中心；当前预览的 `translateX(-50%)` 很可能与实机不一致。
- 立绘贴图本身很大：`CHR_落葉_基_制服` 为 `1131x2187`，`offset 965,451`，`pivot 0,0`。在 1280x720 画面里必须缩放后才可能完整显示；当前预览固定 `sprite.height=76%` 与实机尺寸不一致。

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

当前预览与实机的差异（待修，不在本次改动）：

| 项目 | 当前预览 | 实机观察 |
|---|---|---|
| 水平对齐 | `translateX(-50%)` 以锚点居中 | 更像图左上角落在锚点/偏移上 |
| 尺寸 | 固定 `sprite.height=76%` | 由 `z` 和贴图原始尺寸决定，`z` 越大越小 |
| `x/y` | 按舞台宽高换算 | 原始像素偏移 |
| 4 参 `bs` | 总是创建/覆盖立绘 | 没有已有立绘时不创建 |
| `l` | 按 0/1/2/-1 选变体 | 至少 `-1` 会找 `U`，`1` 用默认；缺变体会报错 |
| 角色编号 | mapping `cha` | 游戏自己的 `bs` 编号（本作 3=落葉） |

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

1. `pos` 的 `l/m/r` 锚点到底是图左上角、角色脚底，还是另一个 pivot；需要再用三张同 `z` 的截图对齐。
2. `z` 到缩放的准确系数（是否 `1000/(z-cam.z)`，还是另一个焦距）还没有量准；目前只能确定单调关系和“`z` 越大越小”。
3. body HZC `offsetX/Y` 在实机绘制里到底参与哪一步：是只给表情表定位，还是同时影响身体图原点。
4. `l` 的完整枚举（`-1` / `0` / `1` / `2` / `-10`）需要按角色资源逐项验证；本作大量角色只有一种身体资源，缺变体会直接弹错。
5. 4 参 `bs` 是“只更新已有立绘”还是“更新 + 可创建”的边界，需要看已有立绘和无立绘两种情况。

## 8. 下一步建议

按优先级：

1. 先用同一角色、同一 `z`，分别截 `l/m/r` 三张，量出锚点是左上角还是中心；这决定预览是否去掉 `translateX(-50%)`。
2. 固定 `x=y=0`，截 `z=1000/1600/2000`，量同一部位（如头顶）的像素位置，拟合缩放和垂直锚点。
3. 用当前游戏的 `chaload`/`bs` 表生成独立 mapping；不要拿 `mappings/sakura.toml` 的 `cha` 直接当 `bs` 编号。
4. 在预览里给缺失变体加回退（至少不要因为 `l` 指向不存在的 `U` 就整块不显示）。
5. 把 4 参 `bs` 改成“只在已有立绘时更新”，与实机一致。

在量准锚点和缩放之前，预览继续使用现有算法，不把 body offset 直接叠加到舞台位置。
