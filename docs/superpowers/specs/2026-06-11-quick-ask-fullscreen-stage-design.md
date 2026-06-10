# Quick-Ask 弹层裁切修复:整屏透明舞台设计

**日期**: 2026-06-11
**状态**: 设计已确认,待写实施计划
**涉及**: `apps/desktop`(main / preload / renderer)

---

## 1. 问题

快速唤起(Quick-Ask)是一个 Spotlight 风格的无边框、透明、always-on-top NSPanel。窗口被刻意做成**贴着内容尺寸**:宽 640、紧凑态高 84px,靠 `quick-ask:resize` IPC 跟随内容长高,封顶 540px(见 `apps/desktop/src/main/quick-ask-window.ts`)。

根因:**任何 HTML 弹层(无论 `position:absolute` 还是 Radix 的 Portal)都只能绘制在所属 BrowserWindow 的像素矩形内,窗口外的部分操作系统根本不渲染。** 因此弹层被裁,具体两类:

- **向上展开的内联弹层**:斜杠 / @ 触发菜单 `packages/ui/src/chat/composer/TriggerMenu.tsx:30` 用 `bottom-full ... max-h-64`,向输入框上方弹约 256px。紧凑态窗口上方没有像素,直接全没。
- **Portal 出去的 Radix 弹层**:`Select` / `Tooltip` / `Dialog`(`packages/ui/src/primitives/`)挂到 body,但同样画不出窗口边界。

## 2. 目标 / 非目标

**目标**
- 任何弹层在快速唤起里都能完整显示,且不为单个弹层写特例逻辑。
- 方案要"删耦合"而非"加补丁":让主进程不再关心内容高度。
- 为后续 `钉住` / `转窗口` 能力留出无冲突的扩展缝。

**非目标(本次不做)**
- 不实现 `钉住`(pinned)与 `转窗口`(promoted),仅留接口缝。
- 不做拖拽重定位(见 §4 决策)。
- 不改 NSPanel 焦点处理、prefill 聚焦、blur grace window 等既有正确逻辑。

## 3. 选定方案:整屏透明舞台(A1)+ 模式缝

**核心:OS 窗口永远是"光标所在显示器整屏大小的透明舞台",几何永不随内容变;所有可见尺寸交给 CSS;窗口行为由一个 `mode` 决定,现在只实现 `modal`。**

弹层在任何模式下都天然放得下,因为舞台一直是整屏的。这把"窗口尺寸"与"卡片尺寸"彻底解耦。

### 官方 API 背书(Electron 文档)

方案只由 Electron 文档明确支持的积木拼成,并刻意避开文档点名的脆区:

- `transparent: true` —— 文档支持的透明窗。
- **"You cannot click through the transparent area."** —— 透明窗默认吃点击,正好白送 `modal` 的"点 backdrop 关闭",无需额外代码。
- **"The native window shadow will not be shown on a transparent window."** —— 故弃用 `hasShadow`,改用卡片 CSS 阴影。
- `setIgnoreMouseEvents(ignore, { forward: true })` + `mouseenter/mouseleave` 切换 —— 文档原样示例,留给将来 `pinned` 的穿透舞台。
- **"Transparent windows are not resizable ... may make a transparent window stop working on some platforms."** —— 现状每次流式输出都 resize 透明窗,踩这条;新设计**整屏固定、永不因内容 resize**,只在唤起时按显示器重定位,比现状更合规。

> 说明:"全屏蒙版"不是 Electron 钦定的 pattern,而是用上述官方积木拼出的工程方案;但它用到的每个 API 都有官方背书,且避开了文档点名的脆区。

## 4. 已确认的交互决策

| 决策点 | 选择 | 说明 |
|---|---|---|
| 透明区点击 | **点空白即关闭(模态/Spotlight 式)** | 打开期间舞台接管本显示器;点卡片外任意处=关闭 |
| 拖拽重定位 | **不做(选项 B)** | 固定在顶部 22%,零拖拽状态;最纯粹,且 `mode` 缝保证将来可加"CSS 移卡片"而不重构 |
| 背景遮罩 | **全透明、不变暗** | 对齐 Spotlight/Raycast,无 dim/blur |
| 卡片位置 | 水平居中 `max-w-[640px]`,距顶 ~22vh | 沿用原 `TOP_OFFSET_RATIO` 视觉位置 |

## 5. 详细改动

### 5.1 主进程 `apps/desktop/src/main/quick-ask-window.ts`

- `computeBounds()` 返回光标所在显示器的整个 `display.workArea`(x/y/width/height),不再是 640×84 居中。
- 窗口构造:`transparent:true`、`frame:false`、`resizable:false`、`movable:false`、`hasShadow:false`。NSPanel(`type:'panel'`)+ `setVisibleOnAllWorkspaces(... skipTransformProcessType)` + `setActivationPolicy('regular')` 原样保留——与窗口大小无关。
- 引入 `type QuickAskMode = "modal"`(类型留口)与 `applyMode(win, mode)`,集中设置 `movable` / `setIgnoreMouseEvents` / blur 是否隐藏。今天 `modal` = "blur 隐藏 + 不忽略鼠标"。
- `summonQuickAsk`:每次按光标显示器的 workArea 重新 `setBounds`(多屏/排布变化自然跟手);**删除**高度保留逻辑(无高度概念)。`blur` 隐藏改为读当前 mode 的策略,而非写死。
- **删除** `resizeQuickAsk` 导出及 `QUICK_ASK_INITIAL_HEIGHT` / `QUICK_ASK_MAX_HEIGHT` / `QUICK_ASK_WIDTH` / `QUICK_ASK_TOP_OFFSET_RATIO`(后两者挪到渲染层用 CSS)。

### 5.2 主进程 `apps/desktop/src/main/index.ts`

- 删除 `quick-ask:resize` 的 `ipcMain.handle`(约 315-317 行)及 `resizeQuickAsk` import(约 43 行)。
- `quick-ask:dismiss` → `hideQuickAsk` 保持不变。

### 5.3 preload `apps/desktop/src/preload/index.ts`

- 删除 `quickAsk.resize`(约 113-114 行)。`onPrefill` / `dismiss` 不动。

### 5.4 渲染层 `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx`

- 根节点变成**铺满整窗的 backdrop**(`fixed inset-0`),本身是"点击关闭"热区:`onMouseDown` 命中 backdrop(非卡片)→ `bridge.quickAsk.dismiss()`;卡片 `stopPropagation`。backdrop 全透明、不变暗。
- 卡片定位纯 CSS:`mx-auto max-w-[640px]`,距顶 ~22vh。上方留白给 `TriggerMenu` 的 `bottom-full`,下方一大片给向下的 Select/下拉。
- 卡片高度:`max-height`(沿用 480)+ 内部滚动(ChatSurface 已自带)。紧凑态让卡片自然贴合 composer——纯 CSS,**不再发任何 IPC**。
- 阴影:卡片加 `shadow-2xl`(或设计系统 elevation token)。
- **删除** resize 相关的 `useLayoutEffect` / `ResizeObserver`(约 203-232 行),以及把 `EXPANDED_HEIGHT_PX` 当**窗口**高度用的逻辑。`expanded` 可保留,仅用于决定卡片 `max-h` vs 贴合,不再跨进程。
- **删除**顶部拖拽把手那段 `app-drag-region`。入场动画 `animate-notifier-in` 留在**卡片**上(不挂 backdrop,否则整屏闪一下)。

### 5.5 交互收敛

三条消隐路径统一收敛到 `hideQuickAsk`:
1. backdrop 点击(渲染层 → `quick-ask:dismiss`)
2. 点别的应用触发 `blur`(主进程,`modal` 模式才隐藏)
3. Esc(渲染层,已有)

## 6. 后续能力如何接入同一条缝(本次仅留口)

- **转窗口(promoted)**:= 把当前 session 交给主窗口/独立窗口显示,再 `hideQuickAsk`。靠已有的跨窗口共享 SessionDB + 与主窗口右栏同一个 `ChatSurface`(见 `QuickAskView.tsx` 顶部注释),零新状态,不需要舞台窗口变形。
- **钉住(pinned)**:= `applyMode(win, "pinned")`:`setIgnoreMouseEvents(true, { forward:true })` + 卡片/弹层 `mouseenter/mouseleave` 动态取消/恢复忽略 + blur 不隐藏。窗口几何不变,仍是整屏舞台,弹层照样放得下。

二者都只是给 `mode` 加分支,不重构。

## 7. 风险与验证

- **主要风险**:整屏 workArea 大小的透明 always-on-top NSPanel,在多屏(尤其负 Y 坐标的副屏)上是否仍正确合成、点击是否正常关闭。代码里有过 screen-saver layer 的伤疤(`quick-ask-window.ts:155-176`),但本方案不碰那套、只是把同一个透明窗放大,风险低。**实施计划必须含一条多屏手动验证**。
- `setBounds` 仅用于"按显示器重定位",不再有内容驱动的 resize,严格少于现状。
- backdrop 透明区需能收到点击(默认 `pointer-events` 即可)。
- 入场动画只挂卡片,避免整屏闪烁。
- 既有 NSPanel 焦点、blur grace window、prefill 聚焦逻辑全部不动。

## 8. 验收标准

- 在快速唤起里打开斜杠/@ 菜单、模型选择等任意弹层,均完整可见、不被裁。
- 点卡片外空白处关闭;点别的应用关闭;Esc 关闭。
- 多显示器(含副屏)下唤起,出现在光标所在屏顶部 ~22%,显示与点击正常。
- 流式输出时窗口不再逐帧抖动(内容在卡片内部滚动)。
- `quick-ask:resize` 全链路已移除,无残留引用。
