# Agent Village 扩展设计（星露谷风格 agent 活动看板）

- 日期：2026-06-05
- 范围：新增 `extensions/agent-village/`（不改动任何 core 包 / apps）
- 灵感来源：[ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI)
- 一句话：一个 amiba 扩展，用星露谷式像素村庄**实时展示"当前 agent 正在做什么"**，下半部配像素风统计面板。

## 1. 目标与非目标

### 目标

- 在 amiba 既有扩展系统里新增一个**自包含扩展** `io.hermes.agent-village`，形态对齐现有 `tool-meter` / `token-meter`：一个 ActivityBar 图标 + 一个 webview 主面板 + 一个轻量设置页。
- **两者并重**的体验：
  - 上半部 = **实时活场景**——PixiJS 渲染的像素村庄，agent 化身村民，跟着工具调用走到对应"工位"做星露谷式动作（读文件=看书、跑命令=敲铁砧、搜索=钓鱼……）。
  - 下半部 = **像素风统计面板**——复用 `@amiba/ui` 的图表，展示调用趋势、热力图、按工具占比、成本、在场会话列表、村庄事件日志。
- **多 agent 村庄**：利用 hermes-agent 的 `parent/child session` 关系，主会话 = 主角村民，每个子会话 = 一个村民，表达"谁在忙 / 谁在等 / 谁收工 / 谁出错"。
- **方案 A：自包含 · 轮询驱动**——不碰 `packages/extension-api` / `extension-host` / `apps/*`，全部能力在扩展内用既有 host API 实现。

### 非目标（v1 明确不做）

- ❌ 音效 / 背景音乐
- ❌ 子 agent 的**实时精确工具**动作（受限于数据源，见 §3；待 hermes-agent 提供子会话事件流后于 v2 接入）
- ❌ 亲子关系连线、网格寻路、昼夜/天气、地图滚动多场景
- ❌ 点击村民下钻到会话详情
- ❌ 为实时性扩展 host→webview 推送通道（即"方案 B"，blast radius 大，v1 不做；≤1s 轮询延迟对氛围场景无影响）
- ❌ 把扩展塞进 desktop 默认内置列表的发版改动（按现有扩展的接入方式即可，不在本 spec 范围）

## 2. 架构总览

```
┌─ 扩展 main（utilityProcess，dist/main.cjs）──────────────────┐
│  host.chat.onEvent("tool.started"/"tool.completed"/          │ ← 实时：仅当前桌面会话
│                    "run.completed")                          │
│      ├─→ liveMain：内存里维护"主角当前工具/起始时间"          │
│      └─→ events-store：把每个工具事件写入 storage 按天桶       │
│  host.ipc.expose("village.world")                            │
│      └─→ 合成 WorldState = liveMain ⊕ host.hermes.listSessions│ ← 被调用时现拉
│  host.ipc.expose("village.stats")                            │
│      └─→ 趋势/热力图(来自 listSessions) + by-tool/日志(来自事件)│
└──────────────────────────────────────────────────────────────┘
                 ▲  window.hermes.ipc.invoke（UI 轮询 ~800ms，tab 隐藏暂停）
┌─ 扩展 ui（webview, React + Tailwind, dist/ui）────────────────┐
│  <App>                                                        │
│   ├─ <VillageScene>  ← PixiJS：把 WorldState 渲染成村庄        │
│   │       Pixi ticker 60fps 补间，村民走向对应工位            │
│   └─ <StatsPanel>    ← DOM：复用 @amiba/ui（Heatmap 等）     │
└──────────────────────────────────────────────────────────────┘

extensions/agent-village/
├── manifest.json / package.json / tsconfig.json
├── vite.main.config.ts / vite.ui.config.ts
├── postcss.config.cjs / tailwind.config.cjs
├── assets/                # CC0 瓦片/角色 + 手搓补，含 CREDITS.md
└── src/{main,shared,ui,i18n}/
```

核心想法：用一条清晰的纯函数边界把**"算什么"（main 合成 `WorldState`）**和**"怎么画"（ui 的 PixiJS 渲染器）**切开。渲染器只消费 `WorldState`，因此"算什么"可单测、"怎么画"可独立迭代。

### 2.1 Manifest（具体字段）

```jsonc
{
  "$schema": "../../packages/extension-api/src/manifest.schema.json",
  "id": "io.hermes.agent-village",
  "name": "Agent Village",
  "version": "0.1.0",
  "engines": { "amiba": "^0.1.0" },
  "entries": { "main": "dist/main.cjs" },
  "contributes": {
    "main": {
      "icon": "trees",                                   // lucide 图标名
      "labels": { "en": "Village", "zh-CN": "智能体村庄" },
      "view": "dist/ui/main/index.html",
      "order": 350
    },
    "settings": {
      "icon": "trees",
      "labels": { "en": "Village", "zh-CN": "智能体村庄" },
      "view": "dist/ui/settings/index.html",
      "order": 350
    }
  },
  "permissions": ["ipc", "storage", "settings", "i18n", "lifecycle.boot"]
}
```

- 包名 `@amiba/ext-agent-village`。
- `contributes.settings` 用独立 HTML 入口（`src/ui/settings/`），由 `vite.ui.config.ts` 的 `rollupOptions.input` 多入口产出（`main` + `settings`）。
- `chat.onEvent` / `hermes.listSessions` 在 Phase 1 不需要单独权限 token（沿用 tool-meter 写法）。

## 3. 数据来源与关键限制（必须诚实）

实时事件 `host.chat.onEvent`（见 `apps/desktop/src/main/chat/engine.ts:297-318`）**只覆盖用户在桌面端正在跑的那个会话**。子 agent（Task 类工具派生的 child session）的**内部工具调用通常不会顺着主会话的 SSE 流出来**——它们在网关侧是独立 session。

因此村庄数据由两个来源拼成：

| 数据源 | 覆盖范围 | 实时性 | 能拿到 |
|---|---|---|---|
| `host.chat.onEvent`（推送） | 仅当前桌面主会话 | **实时**，带 `emoji`/`label`/`durationMs` | 主角"此刻在调哪个工具" |
| `host.hermes.listSessions()`（轮询） | **所有** session（含子） | 轮询（~1s） | 谁存在、`parent_session_id`、忙/闲/收工（`last_active`/`ended_at`/`end_reason`）、`tool_call_count`、token、成本 |

**由此确定的保真度**：
- **主角村民**：由事件流驱动，**精准实时**（工具名→动画零歧义）。
- **子 agent 村民**：由 `listSessions` 轮询填充——能精准表达"是否在场 / 是谁的孩子 / 忙还是收工 / 干了多少活 / 花了多少钱"，但**"此刻具体在调哪个工具"是近似的**（v1 用通用"忙碌"动画 + 状态推断；精确化待 v2 子会话事件流）。

`listSessions` 默认页大小 50、上限 200；统计窗口取数时显式传 `limit: 200`。`listSessions` 不可达时返回空数组（非 null），调用方可无脑 `.map`/`.filter`。

## 4. 数据模型

```ts
// shared/types.ts
type AgentActivity =
  | "idle" | "thinking" | "reading" | "writing"
  | "running" | "searching" | "browsing" | "spawning"
  | "done" | "error"

interface Villager {
  sessionId: string
  parentSessionId?: string
  role: "main" | "sub"          // main = 当前桌面活跃会话
  title?: string
  status: "thinking" | "working" | "waiting" | "done" | "error"
  activity: AgentActivity        // 决定走到哪个工位 + 播哪个动画
  currentTool?: string           // main 实时；sub 近似/最近一次
  emoji?: string                 // 头顶气泡（hermes 事件常带）
  toolCalls: number
  costUsd?: number
  tokens?: number
  lastActiveAt?: number
  endedAt?: number
}

interface WorldState {
  generatedAt: number
  villagers: Villager[]
}

// 统计面板
interface DayBucket { day: string; calls: number; costUsd: number }
interface ToolShare { tool: string; calls: number }
interface VillageStats {
  generatedAt: number
  today: { activeAgents: number; calls: number; costUsd: number }
  trend: DayBucket[]              // 近 N 天（来自 listSessions 按天桶）
  heatmap: DayBucket[]            // 日调用密度（来自 listSessions）
  byTool: ToolShare[]            // 桌面端工具分布（来自自捕获事件）
  recentLog: ToolEventRecord[]   // 村庄事件日志（来自自捕获事件，最新在前）
}

interface ToolEventRecord {
  ts: number
  sessionId?: string
  tool: string
  toolCallId: string
  durationMs?: number
  emoji?: string
  label?: string
}
```

### `WorldState` 合成规则（`main/world.ts`，纯函数）

1. 取 `liveMain`（来自事件）确定主角的 `activity`/`currentTool`/`emoji`。
2. `listSessions({ limit: 200 })` → 找到当前桌面主会话行 + 所有 `parent_session_id === mainSessionId` 的子会话行。
3. 每行映射成 `Villager`：
   - `role`：主会话 = `main`，其余 = `sub`。
   - 主角 `activity` = `liveMain` 的实时值；子 agent `activity` 由状态推断：`ended_at` 存在 → `done`（`end_reason` 异常 → `error`）；近 ~30s 内 `last_active` → `working`；否则 → `waiting`。
   - `currentTool`：主角取实时；子 agent 取最近一次（若曾在事件里出现该 sessionId）否则空。
4. **拥挤折叠**：村民数 > `villagerCap`（默认 8）时，保留主角 + 最近活跃的 N-1 个，其余折叠为一个"群组"占位（带数字角标）。

## 5. 场景设计（PixiJS）

### 5.1 村庄布局（固定小地图，不滚动）

```
        🔮 公告板             ✨ 水井/传送阵
      (browsing/web)        (spawning/子agent 诞生处)
                                              📚 书架
                                            (reading)
   🎣 池塘 ┄┄┄┄ 🟩 中心广场 🟩 ┄┄┄┄ ✍️ 书写台
 (searching)    (thinking/idle 踱步)        (writing)
                                              🔨 铁砧
                     🔥 篝火 / ⛺ 帐篷       (running/shell)
                     (done 收工休息)
```

### 5.2 工具 → 活动 → 工位/动作 映射表

数据驱动，放 `shared/activity-map.ts`，按**工具名小写**用正则/子串匹配。事件自带的 `emoji` 永远显示在头顶气泡（信息优先）。

| Activity | 匹配工具名（示例） | 工位 | 动作 |
|---|---|---|---|
| `reading` | `read*`, `cat`, `view`, `open`, `head`, `tail` | 📚 书架 | 坐下翻书 |
| `writing` | `write*`, `edit`, `create`, `apply_patch`, `str_replace`, `mkdir` | ✍️ 书写台 | 伏案写字，纸张飞出 |
| `running` | `shell`, `bash`, `exec`, `run`, `npm`, `pnpm`, `git`, `test` | 🔨 铁砧 | 叮叮当当敲打 |
| `searching` | `search`, `grep`, `glob`, `find`, `rg`, `ls` | 🎣 池塘 | 钓鱼/撒网 |
| `browsing` | `web`, `fetch`, `http`, `browse`, `url`, `navigate`, `curl` | 🔮 公告板 | 凝视水晶球 |
| `spawning` | `task`, `agent`, `spawn`, `dispatch`, `subagent`, `delegate` | ✨ 水井 | 召唤——新村民从井口冒出 |
| `thinking` | 会话活跃但无工具 / reasoning 中 | 🟩 广场 | 踱步，头顶 💭 |
| `idle` | 两轮之间空闲 | 🟩 广场 | 站立/张望 |
| `done` | session 已结束（正常） | 🔥 篝火/⛺ | 走过去坐下/睡觉 😴 |
| `error` | `end_reason` 异常/aborted | 原地 | 头顶 ❗、沮丧 |
| *（未匹配工具）* | 任意 | 🟩 广场 | 通用"忙碌" + 用事件 emoji/工具名做气泡 |

> 兜底：未知工具不"消失"，而是站广场显示真实工具名气泡——信息不丢，只是动作泛化。

### 5.3 村民行为状态机

- **诞生**：新 session → 村民从 ✨水井 淡入，走向当前活动工位。
- **移动**：`activity` 变化 → 走向新工位（v1 直线/曼哈顿补间，不寻路）；到位后循环播该工位动作。
- **气泡**：头顶 `emoji + 简短 label`（优先用事件的 `emoji`/`label`，否则用工具名）。
- **身份**：主角戴帽子/特殊配色 + 名牌；子 agent 用配色/肤色变体。
- **亲子**：子村民聚集在主角附近（v1）；连线 v2。
- **收工**：session ended → 走向 🔥篝火/⛺帐篷，淡出或 😴。
- **拥挤**：同屏 cap（默认 8）；超出折叠为"一群 + 数字角标"。

### 5.4 渲染循环

- Pixi `ticker` 跑 60fps：插值村民位置（朝目标工位走）、循环工位动作帧。
- 数据轮询 ~800ms：`ipc.invoke("village.world")` 拿到新 `WorldState` 作为"目标态"，渲染器 diff 后更新每个村民的目标工位/动画；`document.hidden` 时暂停轮询。
- 渲染器是 `WorldState → 场景` 的纯函数式 reconciler（按 `sessionId` 复用/新建/移除 villager sprite）。

## 6. 统计面板

DOM 实现，复用 `@amiba/ui` 的 `Heatmap` / SparkBar / ToolRow（仿 `tool-meter/src/ui/main/App.tsx`）。与场景上下分栏（或 tab 切换）。

| 区块 | 数据口径 | 来源 |
|---|---|---|
| Hero 三连：在场 agent / 今日调用 / 今日成本 | 全量、跨来源 | `listSessions()` |
| 在场会话列表（title·role·status·调用数·成本） | 实时 | `WorldState` |
| 趋势（近 N 天调用密度）+ 热力图 | 全量、跨来源 | `listSessions()` 按天桶 |
| 按工具占比 | **仅桌面端跑过的会话**（有工具名） | 自捕获事件 |
| 村庄事件日志（"🪓 main ran shell 1.2s"） | 同上 | 自捕获事件 |

> 口径差异需在 UI 标注：`listSessions` 有每会话**调用总数/成本/token**但**无按工具拆分**；工具名分布只能来自自捕获事件。面板标注"按工具占比 = 桌面端工具分布"。

## 7. 存储与设置

- **存储**（`host.storage`，已自动按扩展 id 命名空间）：
  - `events.<dayKey>` → `ToolEventRecord[]`（append，仿 tool-meter 按天桶）——喂"按工具占比 + 事件日志"。
  - 旧桶按统计窗口上限自然淘汰（读时只取窗口内天数）。
- **设置**（`host.settings`，`ui.*` 键，最小集）：
  - `ui.animationSpeed`：慢/正常/快
  - `ui.showBubbles`：头顶气泡开关
  - `ui.statsWeeks`：统计窗口周数
  - `ui.villagerCap`：同屏村民上限
  - 主题/语言自动跟随宿主（`window.hermes.theme` / `.language` + `on("theme"/"language")`），不在设置页。

## 8. 文件结构

```
extensions/agent-village/
  manifest.json  package.json  tsconfig.json
  postcss.config.cjs  tailwind.config.cjs
  vite.main.config.ts  vite.ui.config.ts
  assets/                       # CC0 瓦片/角色 + 手搓补，含 CREDITS.md
  src/
    main/
      index.ts                  # activate：订阅事件 + expose ipc
      world.ts                  # 合成 WorldState（纯函数）
      events-store.ts           # 事件按天桶存储 + 聚合（纯函数 + storage IO）
      stats.ts                  # VillageStats 聚合（listSessions + events）
    shared/
      hermes-bridge.ts  i18n.ts  tailwind.css  types.ts
      activity-map.ts           # 工具名→activity（main 与 ui 共用，纯函数）
    ui/
      main/ { index.html  main.tsx  App.tsx }       # 村庄主面板入口
      settings/ { index.html  main.tsx  App.tsx }   # 设置页入口
      scene/
        engine.ts               # Pixi app bootstrap
        world-renderer.ts       # WorldState → 场景 reconciler
        villager.ts             # villager sprite + 动画状态
        stations.ts             # 工位坐标 + activity→工位
        assets-manifest.ts      # 素材 import + 加载
      stats/ { StatsPanel.tsx + 子组件 }
    i18n/ { en.json  zh-CN.json }
```

## 9. 构建 / 依赖 / 许可

- 双 Vite 配置照搬 tool-meter：
  - `vite.main.config.ts` → `dist/main.cjs`（lib/cjs；external `@amiba/*`、`electron`、`node:*` 等）。
  - `vite.ui.config.ts`（`base:"./"`，root `src/ui`）→ `dist/ui`，**多入口**（`rollupOptions.input` = `main` + `settings`，分别产出 `dist/ui/main/index.html`、`dist/ui/settings/index.html`）。**PixiJS 打进 ui bundle**（external 只作用于 main 侧）。
- 素材：`import url from "../../../assets/..."` → Vite 指纹化 + `base:"./"` 相对路径 → Pixi `Assets.load(url)`。
- 依赖：
  - deps：`@amiba/extension-api`、`@amiba/ui`、`lucide-react`、`pixi.js`
  - peer：`electron`、`react`、`react-dom`
  - dev：`@amiba/extension-cli`、`@amiba/tailwind-preset`、`@vitejs/plugin-react`、`tailwindcss`、`postcss`、`autoprefixer`、`typescript`、`vite`、`vitest`、`@types/*`
- **许可合规**：`assets/CREDITS.md` 逐项登记每个第三方素材的来源 + 许可；混合策略下每个第三方素材**必须可再分发**（CC0 最稳；手搓补的素材标注自有）。星露谷本体素材**禁止**直接使用。
- dev：`amiba-ext dev`；pack：`amiba-ext pack`（照搬 package.json scripts）。

## 10. 测试与验收

- **纯函数单测（vitest）**：
  - `activity-map`：工具名→activity（大小写 / 子串 / 兜底）。
  - `world`：给定 `liveMain` + `listSessions` mock → 期望 `WorldState`（亲子分组、status 推断、cap 折叠）。
  - `events-store` / `stats`：事件天桶 → by-tool / 热力图分级；`listSessions` → 天桶 / 成本累加。
- **不对 Pixi 渲染做单测**——靠 `WorldState` 纯函数边界保证逻辑正确，渲染器只消费它。
- **构建自检**：`tsc --noEmit` exit=0；`vite build`（两配置）exit=0；`amiba-ext pack` 产物可被宿主加载。
- **人工验收**：桌面端跑一个会话 → 主角实时走到对应工位做动作；派生子 agent → 村庄出现新村民；会话结束 → 村民收工；统计面板数字与 `listSessions` 一致。

## 11. 后续（v2+）

- 子 agent 实时精确工具（需 hermes-agent 暴露子会话事件流，或方案 B 的 push 通道）。
- 亲子关系连线、点击村民下钻会话详情、网格寻路、昼夜/天气、音效。
- 更"星露谷"的专属素材包（替换 CC0 打底）。
