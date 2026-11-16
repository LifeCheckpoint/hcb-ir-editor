# 代码结构

## 为什么不是 ES Module

这个原型没有打包器，Electron 直接加载 `src/index.html`。脚本全部是**同步 classic script**：

- 每个 `app/*.js` 顶层声明（`const` / `function`）落在同一个全局词法环境里，后面的脚本可以直接用前面的名字；
- `app/boot.js` 在 `app/*.js` 里最后加载，它才调用 `buildTypeSheet()` / `renderChapters()`；`resource.js` 在其后，用自己的 boot 初始化资源区；
- 主要 API 仍然通过 `window.DSL` / `window.PROJECT` / `window.MAPPING` / `window.RES` / `window.WIRING` 暴露给其它层。

这不是理想模块化，但比一个 4000 行的 IIFE 好定位；将来如果加 Vite/esbuild，可以整体换成 ESM，不需要改业务逻辑。

## 加载顺序

`src/index.html` 的顺序是契约：

```text
icons.js
dsl.js
mapping.js
resource-store.js
wiring.js
app/core.js
app/types.js
app/model.js
app/project.js
app/import-export.js
app/state.js
app/history.js
app/chapters.js
app/stack.js
app/palette.js
app/inspector.js
app/multi-inspector.js
app/focus.js
app/menubar.js
app/boot.js
resource.js
```

- `app/core.js` 起提供 `icon` / `el` / `esc` / `dsl` / `GROUPS` 等基础名字；
- `app/types.js` 的 `TYPES` 里大量箭头函数会引用后面的 `mapCg` / `spritePick`，但只在 render 时执行，加载时不会碰 TDZ；
- `app/project.js` 在加载时挂 `window.PROJECT`；`app/import-export.js` 挂 `window.DSL`；
- `app/boot.js` 只注册 `DOMContentLoaded`；`resource.js` 自己也有 boot，顺序保持先写作后资源。
- **不要随意改顺序**；移动脚本后先检查顶层 `const` 是否在被初始化前使用。

## 写作区（app/）

| 文件 | 职责 |
|---|---|
| `core.js` | 图标、DOM/字符串工具、分组色、`dsl` 参数拼接、选项列表（bg/cha/cg） |
| `types.js` | `TYPES` 原语定义、Flat UI 色板、对比度选字色、注入 block 类型样式 |
| `model.js` | `viewOf`、块摘要、舞台 `stageCard`、资源接线 `refOfBlock`、场景/块查找、`el` |
| `project.js` | `.hcbproj` 读写、`window.PROJECT`、最近项目、保存状态 |
| `import-export.js` | DSL 导入对话框、导入到新项目/章节/小节、DSL 导出、`window.DSL` |
| `state.js` | 全局 `state`、单选/多选/聚焦、当前章/块、自绘下拉、右键菜单 |
| `history.js` | 撤销/重做快照；100 步，只覆盖剧本内容 |
| `chapters.js` | 左栏章节/场景、增删改/复制/折叠 |
| `stack.js` | 主栏场景、块节点、聚焦灰条、拖拽排序 |
| `palette.js` | 插入面板、`DEFAULTS`、`makeBlock` |
| `inspector.js` | 右栏、单块字段渲染、数字/文本回退、立绘选择器、`patchBlock` |
| `multi-inspector.js` | 多选参数栏：同类型字段、多个值、批量提交 |
| `focus.js` | 聚焦模式类型选择；非聚焦块压成灰条 |
| `menubar.js` | 菜单栏、快捷键、弹层 |
| `boot.js` | 最后一次初始化 |

## 资源区

`resource.js` 仍是单个 IIFE（约 770 行），内部有导航/归档表/绑定表/映射表/详情四块。它和写作区共享 `window.*` API，但不共享全局词法作用域。

下一步如果继续拆，建议按下面切，并且先引入一个显式的 `window.RES_UI` 命名空间，而不是把内部 `state/render` 直接暴露成全局：

```text
resource/core.js      state、归档索引、分页/搜索
resource/bindings.js  绑定表、resolveBinding、BINDINGS API
resource/mapping.js   映射表视图、路径/重新载入
resource/assets.js    归档表、预览、详情、播放器
resource.js           boot + 组装
```

## 样式

`styles/app.css` 已按原有注释边界拆成 6 个文件，`index.html` 的 link 顺序就是层叠顺序：

```text
tokens.css      变量
base.css        基础/外壳
write.css       写作区左栏/主栏
inspector.css   右栏/字段/立绘
overlays.css    下拉/弹层/窄屏
resource.css    资源工作区
dialogs.css     起始页/导入/接线
```

只拆文件，不改选择器和变量；新增样式放对应文件，避免重新长成 4000 行。

## 验证

```bash
node --check src/app/*.js
node --check src/resource.js
node tools/test-dsl.cjs
node tools/test-mapping.cjs
npm run smoke
```

冒烟覆盖导入、项目保存/重开、映射表、导出和资源区；改了加载顺序或顶层声明后必须跑一次。
