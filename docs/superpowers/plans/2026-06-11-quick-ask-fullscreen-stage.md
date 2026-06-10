# Quick-Ask 整屏透明舞台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把快速唤起(Quick-Ask)窗口从"贴合内容尺寸"改为"整屏透明舞台",彻底解耦窗口尺寸与卡片尺寸,使任意 HTML 弹层不再被 BrowserWindow 边界裁切。

**Architecture:** OS 窗口永远是光标所在显示器整屏大小的透明 always-on-top NSPanel(几何永不随内容变);卡片由 CSS 定位在顶部 ~22% 处;窗口行为由一个 `QuickAskMode` 决定,现仅实现 `modal`(点空白关闭 + 失焦隐藏)。删除 `quick-ask:resize` 全链路,主进程不再关心内容高度。`pinned`/`promoted` 沿 `MODE_POLICY` 缝后接。

**Tech Stack:** Electron(main + preload)、React + Tailwind(renderer)、TypeScript。无单元测试框架——验证 = `pnpm typecheck`(catches 所有悬空引用)+ `pnpm build:desktop` + 手动多屏运行。

**设计依据:** [docs/superpowers/specs/2026-06-11-quick-ask-fullscreen-stage-design.md](../specs/2026-06-11-quick-ask-fullscreen-stage-design.md)

**Git 身份(本仓 local config 漂到了 qq 邮箱,必须显式覆盖):** 所有 commit 用
`git -c user.email=dehui1012@gmail.com -c user.name=iHeyTang commit ...`

---

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `apps/desktop/src/main/quick-ask-window.ts` | 创建/显示/隐藏 Quick-Ask 窗口 | 整屏 bounds、`QuickAskMode` 缝、`movable:false`/`hasShadow:false`、删 `resizeQuickAsk` 与高度常量 |
| `apps/desktop/src/main/index.ts` | 主进程入口、IPC 注册 | 删 `resizeQuickAsk` import 与 `quick-ask:resize` handler |
| `apps/desktop/src/preload/index.ts` | 渲染层 IPC bridge | 删 `quickAsk.resize` |
| `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx` | 弹窗 React 外壳 | 删 resize effect;backdrop 点击关闭 + 卡片 CSS 定位 + CSS 阴影 + 去拖拽把手 |

两个任务:
- **Task 1** 把 main + IPC + 渲染层的 resize 链路一次性切到整屏舞台模型(原子改动,中间态无法独立成立)。提交后 typecheck/build 通过,窗口已是整屏透明、弹层不再裁切(卡片定位尚粗糙)。
- **Task 2** 完成渲染层卡片布局(backdrop 关闭、居中、顶部 22%、阴影、去把手),并做多屏手动验收。

---

## Task 1: 主进程整屏舞台 + 模式缝 + 拆除 resize 链路

**Files:**
- Modify: `apps/desktop/src/main/quick-ask-window.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx`

### Step 1.1 — 删除高度相关常量,加入 `QuickAskMode` 缝

- [ ] 打开 `apps/desktop/src/main/quick-ask-window.ts`。删除原有常量块(`QUICK_ASK_WIDTH` / `QUICK_ASK_INITIAL_HEIGHT` / `QUICK_ASK_MAX_HEIGHT` / `QUICK_ASK_TOP_OFFSET_RATIO` 及其上方的多行注释,约 43-54 行)。保留 `BLUR_GRACE_MS` / `lastSummonAt` 与 `quickAskWindow` 声明。

在 `const IS_MAC = ...` 之后、`BLUR_GRACE_MS` 附近,新增模式缝:

```ts
/**
 * Presentation mode of the Quick-Ask stage. The OS window is ALWAYS a
 * full-display transparent canvas; the mode only flips event/dismiss
 * policy, never geometry. Only `modal` exists today — `pinned`
 * (click-through stage that stays on blur) and `promoted` (hand the
 * session to a real window) slot into MODE_POLICY + applyMode without a
 * rewrite. See the design spec for how each future mode maps in.
 */
export type QuickAskMode = "modal"

interface ModePolicy {
  /** OS window draggable. Modal stages are fixed, like Spotlight. */
  movable: boolean
  /**
   * Whether blank (transparent) regions pass clicks through to the apps
   * behind. Modal must CAPTURE clicks so the renderer's backdrop can
   * dismiss on outside-click. (`pinned` will flip this to true.)
   */
  ignoreMouseEvents: boolean
  /** Hide the stage when it loses key status (user clicked another app). */
  hideOnBlur: boolean
}

const MODE_POLICY: Record<QuickAskMode, ModePolicy> = {
  modal: { movable: false, ignoreMouseEvents: false, hideOnBlur: true },
}

let currentMode: QuickAskMode = "modal"

/**
 * Apply a presentation mode's window-level policy. Geometry is NOT
 * touched here — the stage is always the full work area (see
 * `computeBounds`). Today only `modal` is wired.
 */
function applyMode(win: BrowserWindow, mode: QuickAskMode): void {
  currentMode = mode
  const policy = MODE_POLICY[mode]
  win.setMovable(policy.movable)
  win.setIgnoreMouseEvents(policy.ignoreMouseEvents)
}
```

### Step 1.2 — `computeBounds` 返回整屏 workArea

- [ ] 把 `computeBounds()`(约 69-81 行)整体替换为:

```ts
/**
 * The stage fills the entire work area of whichever display currently
 * holds the mouse cursor. Cursor (not focused window) is the most
 * reliable "where the user is" signal across heterogeneous focus states.
 * A full-work-area transparent canvas is what gives popups room to paint
 * — nothing renders outside a BrowserWindow's pixel rect.
 */
function computeBounds(): {
  x: number
  y: number
  width: number
  height: number
} {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const wa = display.workArea
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height }
}
```

### Step 1.3 — 构造选项:`movable:false`、`hasShadow:false`,并应用 modal 模式

- [ ] 在 `createQuickAskWindow` 的 `new BrowserWindow({...})` 选项里:
  - 把 `movable: true` 改为 `movable: false`。
  - 把 `hasShadow: true` 改为 `hasShadow: false`(文档:透明窗不显示原生阴影,阴影改由卡片 CSS 负责)。
  - `resizable: false`、`transparent: true`、`alwaysOnTop: true`、`type: "panel"`、`focusable: true` 等保持不变。
  - 顺手把 `hasShadow` 上方那段解释原生阴影的注释更新为一行:`// hasShadow:false — transparent windows don't get a native shadow; the card paints its own CSS shadow.`

- [ ] 在 `win.setVisibleOnAllWorkspaces(...)` 调用之后、`win.on("blur", ...)` 之前,加入:

```ts
  // Establish the default (and currently only) presentation policy.
  applyMode(win, "modal")
```

### Step 1.4 — blur 隐藏改为读 mode 策略

- [ ] 把 `win.on("blur", ...)`(约 183-186 行)替换为:

```ts
  win.on("blur", () => {
    if (Date.now() - lastSummonAt < BLUR_GRACE_MS) return
    if (!MODE_POLICY[currentMode].hideOnBlur) return
    if (!win.isDestroyed() && win.isVisible()) win.hide()
  })
```

### Step 1.5 — `summonQuickAsk`:setBounds 到整屏,删除高度保留逻辑

- [ ] 在 `summonQuickAsk` 里,找到重新定位的那段(从 `const target = computeBounds()` 到 `win.setBounds(next)`,约 244-259 行,含中间的 `current`/`next`/`console.log("[amiba] setBounds=...")`)。整段替换为:

```ts
  // The stage always fills the cursor display's work area, so multi-
  // monitor users get it on their current screen and a display-arrangement
  // change can never strand it off-screen. No height preservation: window
  // geometry is constant — the card sizes itself via CSS.
  win.setBounds(computeBounds())
```

(保留这段之前的 `console.log("[amiba] summonQuickAsk: showing")` 与 cursor/display 日志、之后的 `deliver()` 逻辑不动。)

### Step 1.6 — 删除 `resizeQuickAsk`

- [ ] 删除整个 `resizeQuickAsk` 函数及其上方文档注释(约 301-321 行)。`hideQuickAsk` / `destroyQuickAskWindow` / `getQuickAskWindow` 保留不变。

### Step 1.7 — index.ts:移除 resize import 与 handler

- [ ] 打开 `apps/desktop/src/main/index.ts`。在 import 块(39-45 行)删除 `resizeQuickAsk,` 这一行:

```ts
import {
  createQuickAskWindow,
  destroyQuickAskWindow,
  hideQuickAsk,
  summonQuickAsk,
} from "./quick-ask-window"
```

- [ ] 把 `registerQuickAskIpcHandlers`(311-320 行)替换为(只留 dismiss):

```ts
function registerQuickAskIpcHandlers(): void {
  ipcMain.handle("quick-ask:dismiss", () => {
    hideQuickAsk()
  })
}
```

- [ ] 同步更新其上方注释(305-310 行),把 "dismiss + dynamic resize" 改为 "dismiss only":

```ts
/**
 * Quick-Ask Spotlight popup back-channel: dismiss. The popup gets
 * streaming chat via the existing `chat:client-to-engine` IPC like any
 * other surface; window sizing is now fully CSS-driven (the stage is a
 * fixed full-screen transparent canvas), so there is no resize channel.
 */
```

### Step 1.8 — preload:移除 `quickAsk.resize`

- [ ] 打开 `apps/desktop/src/preload/index.ts`。把 `quickAsk` 对象(101-115 行)里的 `resize` 删掉,只留 `onPrefill` + `dismiss`:

```ts
  quickAsk: {
    onPrefill: (
      cb: (payload: { text: string; sourceApp: string }) => void,
    ) => {
      const handler = (
        _e: unknown,
        payload: { text: string; sourceApp: string },
      ) => cb(payload)
      ipcRenderer.on("quick-ask:prefill", handler)
      return () => ipcRenderer.off("quick-ask:prefill", handler)
    },
    dismiss: () => ipcRenderer.invoke("quick-ask:dismiss"),
  },
```

- [ ] 把其上方注释(94-100 行)里 "sends `dismiss` / `resize` back" 改为 "sends `dismiss` back"。

### Step 1.9 — renderer:删除 resize effect 与相关常量/import

- [ ] 打开 `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx`。
- [ ] 删除 `EXPANDED_HEIGHT_PX` 常量及其上方文档注释(约 60-66 行)。
- [ ] 删除整段窗口-resize 的 `useLayoutEffect`(约 198-232 行,从 `// Window-resize strategy:` 注释到该 effect 结束的 `}, [expanded, bridge])`)。
- [ ] 在 import 里(47-54 行)移除 `useLayoutEffect`(它只被刚删的 effect 用到):

```ts
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
```

> 此时 `expanded`(约 95 行)仍被 JSX 的 `expanded && "h-full"` 使用,不会变成未使用变量。卡片布局留到 Task 2;本步只拆 resize。

### Step 1.10 — typecheck(验证所有删除无悬空引用)

- [ ] Run: `cd apps/desktop && pnpm typecheck`
- Expected: PASS,无报错。(若报 `resizeQuickAsk` / `quickAsk.resize` / `EXPANDED_HEIGHT_PX` / `useLayoutEffect` 未定义或未使用,说明上面某处漏改——回去补。)

### Step 1.11 — 确认无其它残留引用

- [ ] Run: `cd apps/desktop && grep -rnE "resizeQuickAsk|quick-ask:resize|quickAsk\.resize|EXPANDED_HEIGHT_PX" src`
- Expected: 无输出(空)。

### Step 1.12 — build

- [ ] Run(仓库根): `pnpm build:desktop`
- Expected: 构建成功(`electron-vite build` 无错误)。

### Step 1.13 — Commit

```bash
git -c user.email=dehui1012@gmail.com -c user.name=iHeyTang add \
  apps/desktop/src/main/quick-ask-window.ts \
  apps/desktop/src/main/index.ts \
  apps/desktop/src/preload/index.ts \
  apps/desktop/src/renderer/quick-ask/QuickAskView.tsx
git -c user.email=dehui1012@gmail.com -c user.name=iHeyTang commit -m "refactor(desktop): quick-ask 改为整屏透明舞台,拆除 resize 链路

窗口改为光标显示器整屏 workArea 大小的透明 NSPanel,几何不再随内容
变;新增 QuickAskMode 模式缝(仅 modal:movable=false / 不忽略鼠标 /
失焦隐藏);movable/hasShadow 置 false。删除 resizeQuickAsk 及高度常量、
quick-ask:resize handler 与 preload 方法、renderer 的 resize effect。"
```

---

## Task 2: 渲染层卡片布局 — backdrop 关闭 + 居中 + 顶部 22% + CSS 阴影 + 去拖拽

**Files:**
- Modify: `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx`

### Step 2.1 — 重写外层结构:全屏 backdrop + 居中卡片

- [ ] 在 `QuickAskView` 内、`return (` 之前,新增 backdrop 点击关闭处理器(放在已有的 `openExternal` 等 useCallback 附近):

```ts
  // Modal dismiss: a mousedown anywhere on the transparent backdrop (i.e.
  // NOT on the card) closes the stage — the Spotlight/Raycast convention.
  // The card stops propagation so interacting with it never dismisses.
  // Electron transparent windows don't pass clicks through by default, so
  // the backdrop reliably receives this event.
  const onBackdropMouseDown = useCallback(() => {
    void bridge.quickAsk.dismiss()
  }, [bridge])
```

- [ ] 把当前的 `return ( <div ref={rootRef} className={cn(... )}> ... </div> )` 整体替换为下面的结构。`rootRef` 移到 backdrop(仍包含 textarea,prefill 聚焦的 `querySelector` 照常工作);拖拽把手那段 `app-drag-region` div(约 280-288 行)**删除**;`ChatSurface` 与 `ContinuationHint` 的用法不变,只是搬进卡片:

```tsx
  return (
    <div
      ref={rootRef}
      onMouseDown={onBackdropMouseDown}
      // Full-window transparent backdrop. No dim/blur — the stage looks
      // like just a floating card, matching Spotlight/Raycast. Clicking
      // the blank area dismisses; the card below stops propagation.
      className="fixed inset-0 flex justify-center"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          // The visible card. Centered horizontally, pushed down ~22vh so
          // there's headroom ABOVE for the slash/@ menu (TriggerMenu opens
          // upward via bottom-full) and a large area BELOW for downward
          // dropdowns/selects. CSS shadow (not native — transparent
          // windows don't get one). overflow-hidden clips the inner
          // ChatSurface to the rounded shape.
          "animate-notifier-in mt-[22vh] flex w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-background text-foreground shadow-2xl",
          // expanded → fixed height so ChatSurface fills it and streaming
          // scrolls INSIDE its own ScrollArea (no window resize, ever).
          // compact → hug the composer, capped so a stray tall empty state
          // can't run off-screen.
          expanded ? "h-[480px]" : "max-h-[480px]",
        )}
      >
        <ChatSurface
          variant="fullscreen"
          emptyState="composer-only"
          composerAutoFocus
          client={client}
          capabilities={capabilities}
          openSettings={() => {}}
          openAgentDestination={openExternal}
        />

        {showContinuationHint && (
          <ContinuationHint
            label={t("quickAsk.continuation.label", {
              time: formatRelativeTime(
                activeSession?.updatedAt ?? Date.now(),
                t,
              ),
            })}
            newLabel={t("quickAsk.continuation.new")}
            dismissLabel={t("quickAsk.continuation.dismiss")}
            onNew={() => void sessions.deselect()}
            onDismiss={() => setHintDismissed(true)}
          />
        )}
      </div>
    </div>
  )
```

### Step 2.2 — 确认 body/html 背景透明(否则 backdrop 会盖住整屏一层实色)

- [ ] Run: `cd apps/desktop && grep -rnE "background|bg-" src/renderer/quick-ask/index.html src/renderer/quick-ask/*.css 2>/dev/null; ls src/renderer/quick-ask`
- [ ] 若存在给 `html`/`body`/`#root` 设的实色背景,确保 quick-ask 入口处它们是透明的(透明窗依赖 body 透明)。若本来就没有实色背景,无需改动。记录结论。

### Step 2.3 — typecheck

- [ ] Run: `cd apps/desktop && pnpm typecheck`
- Expected: PASS。(`useState` 仍被 `hintDismissed`/`summonMessageCount` 使用;`Clock`/`X` 等保持原样。)

### Step 2.4 — build

- [ ] Run(仓库根): `pnpm build:desktop`
- Expected: 构建成功。

### Step 2.5 — 手动验收(单屏)

- [ ] Run(仓库根): `pnpm dev:desktop`(或 `pnpm dev:desktop:fresh`)。
- [ ] 双击 ⌘ 唤起。逐项确认:
  - 弹窗出现在屏幕顶部 ~22% 居中,背景完全透明(看不到全屏实色层)。
  - 在 composer 输入 `/` 或 `@` 触发菜单(向上弹)→ **完整可见,不被裁**。
  - 打开模型选择 / 任意下拉(向下弹)→ **完整可见,不被裁**。
  - 点卡片以外的空白处 → 关闭。
  - 点别的应用窗口 → 关闭。
  - 按 Esc → 关闭。
  - 发一轮对话,流式输出时窗口不抖动,内容在卡片内部滚动。
  - ⌘K 新建会话正常;prefill(选中文字后唤起)聚焦正常。

### Step 2.6 — 手动验收(多屏,主要风险点)

- [ ] 若有外接显示器(尤其排布在主屏上方、Y 坐标为负的副屏):把鼠标移到副屏,双击 ⌘ 唤起。
- Expected: 弹窗出现在**副屏**顶部 ~22%,显示正常、点击关闭正常。
- [ ] 若无多屏环境,在此步明确记录"未验证多屏",留待具备条件时补测——不要默认通过。

### Step 2.7 — Commit

```bash
git -c user.email=dehui1012@gmail.com -c user.name=iHeyTang add \
  apps/desktop/src/renderer/quick-ask/QuickAskView.tsx
git -c user.email=dehui1012@gmail.com -c user.name=iHeyTang commit -m "feat(desktop): quick-ask 卡片改 CSS 定位 + backdrop 点击关闭

外层改为全屏透明 backdrop(mousedown 空白处关闭),卡片水平居中、
距顶 22vh、max-w-640、expanded 固定 480 高内部滚动、CSS shadow-2xl;
移除拖拽把手。弹层(向上的斜杠/@ 菜单、向下的下拉)不再被窗口边界
裁切。"
```

---

## Self-Review(对照 spec)

- **§3 整屏舞台**:Task 1.2 `computeBounds`→workArea + 1.3 构造 ✓
- **§3 模式缝**:Task 1.1 `QuickAskMode`/`MODE_POLICY`/`applyMode` + 1.3 应用 + 1.4 blur 读策略 ✓
- **§4 modal 点空白关闭**:Task 2.1 backdrop `onMouseDown` ✓ / 失焦隐藏 1.4 ✓ / Esc 既有不动 ✓
- **§4 不做拖拽**:1.3 `movable:false` + 2.1 删 `app-drag-region` ✓
- **§4 背景不变暗**:2.1 backdrop 无 bg ✓
- **§4 卡片顶部 22%**:2.1 `mt-[22vh]` ✓
- **§5.1 删 resizeQuickAsk + 常量**:1.6 + 1.1 ✓
- **§5.2 index 删 import+handler**:1.7 ✓
- **§5.3 preload 删 resize**:1.8 ✓
- **§5.4 renderer 删 resize effect / 加 shadow / 卡片高度 / 入场动画挂卡片**:1.9 + 2.1 ✓
- **§5.5 三条消隐收敛**:backdrop(2.1)+ blur(1.4)+ Esc(既有)✓
- **§7 多屏验证**:Task 2.6(含"无环境则记录未验证")✓
- **§8 验收标准**:Task 2.5 / 2.6 覆盖弹层不裁、三种关闭、多屏、不抖动、无残留(1.11)✓

**Placeholder scan:** 无 TBD/TODO;每个改码步骤均给出确切 old→new 代码或确切命令。
**Type consistency:** `QuickAskMode` / `MODE_POLICY` / `currentMode` / `applyMode` 命名在 1.1/1.3/1.4 间一致;`onBackdropMouseDown` 仅 2.1 定义并使用;`expanded` 在 1.9 之后仍被 2.1 使用。
**说明(偏离 TDD):** `apps/desktop` 无测试框架(已核实),不为本次窗口/CSS 改动新引入测试栈;以 `pnpm typecheck`(捕获全部删除引用)+ `pnpm build:desktop` + 手动多屏验证作为验证门,符合既有工程实践。

---

## Task 3:紧凑态弹层 CSS 裁切修复(执行期新增,源于代码审查)

**背景:** Task 2 完成后代码审查发现「整屏窗口」必要但不充分——紧凑态(空 composer)下弹层仍被两层 `overflow-hidden` 裁切(唤起卡片 + 共享 `ChatSurface` body 容器)。见设计 spec §9。

**Files:**
- Modify: `packages/ui/src/chat/ChatSurface.tsx`(共享组件,改动以 `isComposerOnlyEmpty` 门控,等效仅影响快速唤起)
- Modify: `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx`

**三处改动:**
1. `ChatSurface` 根节点 fullscreen 分支的 `isComposerOnlyEmpty` 臂 `"" → "rounded-xl"`,使其 `bg-background` 自带圆角。
2. `ChatSurface` body 容器(~1713):`overflow-hidden` 从常驻 base 移入 `!isComposerOnlyEmpty && "flex-1 overflow-hidden"`。
3. 唤起卡片:`overflow-hidden` 从 base 移入 `expanded ? "h-[480px] overflow-hidden" : "max-h-[480px]"`。

**验证门:** `pnpm --filter @amiba/ui typecheck` + `apps/desktop pnpm typecheck` + `pnpm build:desktop` 全绿;grep 确认卡片→菜单链路无其它 `overflow-hidden` 祖先。主窗口路径 class 集合证明等价(spec 审查确认)。

**评审结论:** spec ✅ 合规且主窗口 class 集合逐字等价;代码质量 ✅(裁切移除完整、展开态不变)。两处注释清理(去掉泄漏的 "(Edit 1)" 标签 + 补 `expanded`⇄`isComposerOnlyEmpty` 不变式注释)已 amend。

**提交:** `4ef2800`(含注释清理)。

**仍待人工验证(GUI):** 圆角观感、紧凑态斜杠/@ 菜单与下拉完整可见——见下方验收。

---

## 提交记录(main)

- `e976060` Task 1:整屏透明舞台 + 模式缝 + 拆 resize 链路(含审查修复 forward:true / 注释)
- `c191eaa` Task 2:卡片 CSS 定位 + backdrop 点击关闭(含 items-start 修复)
- `4ef2800` Task 3:紧凑态弹层 overflow 裁切修复(含注释清理)

## 人工验收清单(需在运行的 app 上确认)

- [ ] 双击 ⌘ 唤起:卡片在光标屏顶部 ~22%,周围完全透明(无整屏实色层),圆角正常。
- [ ] 紧凑态输入 `/` 或 `@`:菜单向上完整可见,不被裁。
- [ ] 紧凑态触发向下的下拉:完整可见,不被裁。
- [ ] 展开态(有对话)同样不被裁;流式输出窗口不抖动。
- [ ] 点卡片外空白 / 点别的应用 / Esc:三种方式都能关闭。
- [ ] 多显示器(尤其负 Y 副屏):唤起位置与点击关闭正常。
- [ ] 暗色主题下确认无方角/异色露出。
