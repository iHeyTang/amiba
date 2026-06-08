# Composer 斜杠命令 + @ 引用设计

- 日期：2026-06-05
- 范围：
  - packages/ui（主体：Lexical 编辑器 + 触发引擎 + 全部 provider）
  - packages/core（新增 `getHermesCommands()` / `getHermesPersonalities()` 客户端）
  - hermes-plugin-http-backplane（新增 `GET /hermes/commands` + `GET /hermes/personalities` 接口）
  - apps/desktop（注入 Files provider：Electron IPC 列工作区文件）
  - apps/browser-extension（注入 Page-context provider：`@page` / `@tab`，复用现有 `chromePageContext`）
- 目标：把 hermes-agent CLI 的「`/` 唤起命令、`@` 唤起引用」体验带到 web/desktop/扩展 聊天输入框
- 交付方式：**一次性完整交付**（含斜杠命令、subcommand 二级补全、全部 @ 来源、两个新后端接口）。§10 给出的是同一交付内的**构建依赖顺序**，不是分批发布。

## 1. 目标与非目标

### 目标

- 在聊天输入框中支持两种触发：
  - **`/` 斜杠命令**：仅在行首生效，整行即一条命令，对齐 CLI 的 `_looks_like_slash_command` 语义；支持**一级命令名 + 二级 subcommand** 补全（如 `/reasoning ` 后补 `low/medium/high`）。
  - **`@` 行内引用**：任意位置触发，选中后插入可整体删除的**原子芯片**，嵌在正常消息文本里。
- `@` 全部来源（按界面可用性见 §5）：
  - **Skills**（`getHermesSkills()`）
  - **Sessions / 历史**（`listHermesSessions()`）
  - **Personas**（新增 `/hermes/personalities`，即 `agent.personalities`）
  - **Channels / 投递目标**（`listChannels()`）
  - **Files / 文件夹**（桌面端，Electron IPC 列工作区文件）
  - **Page-context**（扩展端，`@page` / `@tab`，复用 `chromePageContext`）
- 斜杠命令采用 **hybrid** 行为：多数命令作为文本发给后端（后端已能解析），少数有原生 UI 的命令（如打开设置）选中即执行 UI 动作。
- 斜杠命令与 personas 清单**实时从后端拿**：新增接口由 backplane 序列化下发 `COMMAND_REGISTRY` / `agent.personalities`，与 CLI 同一份 single source of truth，**无副本漂移**。
- 用 **Lexical** 替换现有 `<textarea>`，芯片为原子节点，但**对外契约保持 `value: string` / `onChange(string)` 不变**，5 个消费界面零改动。
- 提供**可插拔 provider 抽象**：`packages/ui` 内置处处可用的 provider（slash / skills / sessions / personas / channels）；宿主特有数据源（Files、Page-context）由各 app 注入。

### 非目标 / 平台约束

- ❌ 改 `Composer` 的对外 props 契约（仍是 `value: string`）。
- ❌ 后端识别 `@[...]` token 语法 —— 展开在前端发送层完成。
- ❌ `/hermes/commands`、`/hermes/personalities` 的写操作（仅只读列表；命令执行仍走 content 文本由后端原有逻辑解析）。
- ⛔ **浏览器扩展端列本地文件**：Chrome MV3 无任何文件系统枚举能力（manifest 仅 `tabs/scripting/downloads/...`，无 `fileSystem`、无 native messaging）。这是**平台硬约束、非延期**；扩展端用 `@page`/`@tab` 页面上下文作为对应能力。
- ❌ 富文本格式化（粗体/列表等）—— 编辑器只承载纯文本 + 芯片 + 命令文本。

## 2. 核心策略：保留字符串契约，芯片是富渲染层

编辑器内部用 Lexical 节点树，但对外仍是字符串。**规范 token 串**是 single source of truth：

```
帮我看下 @[file:src/foo.ts] 这个文件，参考 @[session:a1b2|登录重构] 的讨论，用 @[persona:concise] 的风格
```

- `serialize(editorState) -> string`：每次编辑把节点树序列化成 token 串，喂给 `onChange`。
- `parse(string) -> editorState`：外部 `value` 变化时（快捷动作预填、`pendingPrompt` 等），把普通文本还原成文本节点、`@[...]` 还原成芯片节点。
- 非法/未知 token → 退化为纯文本，**绝不丢字符**。

Token 语法（前端内部约定，后端不感知）：

| 类型 | Token | 说明 |
|---|---|---|
| Skill | `@[skill:translate]` | name |
| Session | `@[session:<id>\|<title>]` | id 权威，title 仅展示 |
| Persona | `@[persona:concise]` | personality key |
| Channel | `@[channel:<id>]` | channel id |
| File | `@[file:src/foo.ts]` | 相对路径（桌面端） |
| Page | `@[page]` / `@[tab:<id>\|<title>]` | 扩展端：当前页 / 指定标签页 |

> 选择 `@[type:payload]` 而非裸 `@x`：避免与正文里普通的 `@` 冲突，解析无歧义，且 payload 能携带 id 等结构化信息。

## 3. 架构总览

```
Composer (对外 props 不变: value:string / onChange / onSubmit(overrideText?))
└─ RichComposerEditor (Lexical)
   ├─ 基础插件层（1:1 复刻现有行为）
   │   ├─ HistoryPlugin                 撤销/重做
   │   ├─ AutoGrowPlugin                自动撑高到 maxTextareaPx 后滚动
   │   ├─ ImeEnterPlugin                IME 合成期不误触发送 + Enter/Cmd+Enter/Shift+Enter
   │   ├─ TypewriterPlaceholderPlugin   打字机占位（输入/busy 暂停）
   │   └─ PastePlugin                   透传 onPaste
   ├─ MentionNode (DecoratorNode)       渲染 @ 芯片（React 组件，原子、可整体删除）
   ├─ TriggerPlugin                     检测 `/`(行首) 与 `@`(任意位置)，维护 query；支持二级 subcommand
   ├─ TriggerMenu (绝对定位浮层)         候选列表 + 键盘上下/Enter/Esc + 空态/错误态
   ├─ serialize / parse                 节点树 <-> 规范 token 串
   └─ ProviderRegistry
        内置: { slash, skills, sessions, personas, channels }
        注入: { files? (桌面), pageContext? (扩展) }

发送层 (Composer.onSubmit 内)
   └─ expandMentions(tokenString) -> finalText
        - 命令模式整行: 原样发 (后端解析) 或拦截为 UI 动作
        - @[skill|session|persona|channel|file|page|tab]: 各 provider.serialize() 展开

数据后端 (新增 2 个只读接口)
   hermes-plugin-http-backplane (.../settings/)
   ├─ GET /hermes/commands       ──serialize──> COMMAND_REGISTRY (hermes_cli.commands)
   │                                            复用 _is_gateway_available() + 剔除消息平台专用命令
   └─ GET /hermes/personalities  ──serialize──> load_config().agent.personalities (内置14 + 用户自定义)
   packages/core
   ├─ getHermesCommands()        ──fetch──> /hermes/commands       (与 getHermesSkills 同范式)
   └─ getHermesPersonalities()   ──fetch──> /hermes/personalities
```

组件落点（建议）：

- `packages/ui/src/chat/composer/` 新目录：
  - `RichComposerEditor.tsx`、`plugins/*`、`MentionNode.tsx`、`TriggerMenu.tsx`、`serialize.ts`、`parse.ts`
  - `providers/`：`types.ts`（接口）、`slash.ts`、`skills.ts`、`sessions.ts`、`personas.ts`、`channels.ts`
- `packages/core/src/hermes-commands.ts` / `hermes-personalities.ts`：新增客户端（参照 `hermes-skills.ts`），从 core 导出。
- `hermes-plugin-http-backplane/runtime/features/hermes_proxy/settings/`：新增 `commands_routes.py`、`personalities_routes.py`（+ 必要时同名 `_service.py`），在 `__init__.py` 的 `register()` 里挂载。
- `Composer.tsx`：内部把 `<Textarea>` 换成 `<RichComposerEditor>`，props 不变；新增**可选**的 provider 注入点（`mentionProviders?` prop），各 app 传入 Files / Page-context provider。
- `apps/desktop`：新增「列工作区文件」IPC（main 进程 fs），renderer 侧包成 Files provider 注入。
- `apps/browser-extension`：用 `chromePageContext` 包成 Page-context provider 注入。

## 4. Provider 抽象

```ts
interface MenuItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  insert?: MentionData          // @ 类：生成芯片
  action?: (ctx) => void        // slash UI 动作类：选中即执行
  raw?: string                  // slash 文本类：插入的命令文本
  subcommands?: string[]        // slash：进入二级补全
}

interface TriggerProvider {
  trigger: '/' | '@'
  id: string
  group?: string                              // @ 菜单分组标题（Skills / Sessions / Personas / ...）
  match(query: string): boolean | number      // 命中判定 / 排序权重（false 不参与）
  search(query: string): Promise<MenuItem[]>   // 拉候选（可异步、可失败 -> 错误态，不阻塞输入）
  onSelect(item: MenuItem, editor: LexicalEditor): void
  serialize?(mention: MentionData): string     // 该类型 token -> 发送文本（仅 @ 类需要）
}

interface MentionData {
  type: 'skill' | 'session' | 'persona' | 'channel' | 'file' | 'page'
  payload: Record<string, string>   // 如 { name } / { id, title } / { key } / { path } / { tabId }
  display: string                    // 芯片上显示的文字
}
```

- 内置 provider（数据源在 core，处处可用）：`slash` / `skills` / `sessions` / `personas` / `channels`。
- 注入 provider（宿主特有，通过 `Composer.mentionProviders` 传入）：`files`（桌面）/ `pageContext`（扩展）。缺省则该分组不出现在 `@` 菜单（优雅降级）。

## 5. 来源与可用性

| Provider | 触发 | 数据源 | 可用界面 |
|---|---|---|---|
| Slash 命令（含 subcommand） | `/` 行首 | `GET /hermes/commands` | 全部 |
| Skills | `@` | `getHermesSkills()` | 全部 |
| Sessions | `@` | `listHermesSessions()` | 全部 |
| Personas | `@` | `GET /hermes/personalities` | 全部 |
| Channels | `@` | `listChannels()`（静态） | 全部 |
| Files / 文件夹 | `@` | Electron IPC 列工作区文件（注入） | 桌面 |
| Page-context（`@page`/`@tab`） | `@` | `chromePageContext`（注入） | 扩展 |

- 桌面端有真实文件树；扩展端无法列本地文件（§1 平台约束），改提供 `@page`/`@tab`。两者都通过 `mentionProviders` 注入，UI 主体不感知差异。

## 6. 后端新增接口（实时下发，无漂移）

两个接口都落在 `hermes-plugin-http-backplane/.../settings/`，与 `skills_routes.py` 同范式（aiohttp `web.get` + `web.json_response`），在 `settings/__init__.py` 的 `register()` 中挂载；只读、无写操作。backplane 已普遍 `from hermes_cli.* import ...`，可直接复用其数据。

### 6.1 `GET /hermes/commands`

- 数据：`from hermes_cli.commands import COMMAND_REGISTRY`。
- **surface 过滤**：复用 `hermes_cli.commands._is_gateway_available(cmd)`（web/desktop 是非 CLI 客户端，等价 gateway surface）；排除 `cli_only`（除非 `gateway_config_gate` 命中），并剔除明显仅消息平台用的 `gateway_only` 命令（`start`/`topic`/`approve`/`deny`/`sethome` 等）。黑名单在实现期定稿。
- 响应：`[{ name, description, category, aliases, args_hint, subcommands }, ...]`（snake_case，对齐 `/hermes/skills` 风格）。`subcommands` 用于前端二级补全。

### 6.2 `GET /hermes/personalities`

- 数据：`load_config().get("agent", {}).get("personalities", {})`（与 CLI `_personality_completions` 同一来源：14 内置 + 用户自定义）。
- 响应：`[{ key, builtin: bool, preview?: string }, ...]`。`preview` 可取系统提示词前 N 字用于菜单副标题；`builtin` 区分内置/自定义。

### 6.3 前端消费

- `packages/core`：`getHermesCommands()` / `getHermesPersonalities()`，参照 `getHermesSkills()`，定义对应 TS 类型。
- `slash` provider 启动拉一次（可缓存）：后端命令 + 前端极小的**「哪些走 UI 动作」覆盖表**合并；默认 `kind:'send'`，覆盖表里标 `ui-action` 的给 `onSelect`。命令定义本体不复制，**与 CLI 永远一致**。
- 命中带 `subcommands` 的命令、且用户已输入到该命令 + 空格 → 进入二级菜单补 subcommand。
- `personas` provider：拉 personalities 列表，选中插入 `@[persona:key]` 芯片。

## 7. 序列化与发送链路

- **编辑时**：`onChange(serialize(editorState))` → token 串，维持 `value: string` 契约。
- **发送时**：`Composer.onSubmit` 拿 token 串，先判定是否命令模式（行首 `/` 且整行匹配单条命令）：
  - 命令模式 + `kind:'ui-action'` → 执行动作并 return（不发消息）。
  - 命令模式 + `kind:'send'` → 原样把整行作为 content 发后端。
  - 否则走 `expandMentions(tokenString)`：扫描 `@[...]`，按 type 调对应 provider 的 `serialize()` 展开：
    - `skill` → 技能调用/范围提示；`session` → 会话引用；`persona` → 风格指令；`channel` → 投递目标标注；
    - `file` → 路径（+ 可选内容/附件）；`page`/`tab` → `formatPageContextsForPrompt()` 展开为页面上下文文本。
  - 普通文本原样保留，得到 `finalText` 后发送。
- 后端只收到普通文本/命令文本，**无需识别 `@[...]`**。

## 8. 必须 1:1 保留的现有 Composer 行为

换 Lexical 后逐项重做并回归验证：

- 自动撑高到 `maxTextareaPx` 后出现滚动条
- IME 合成期（`nativeEvent.isComposing` 或 `key === 'Process'`）不误触发送
- Enter / Cmd(Ctrl)+Enter 发送；Shift+Enter 换行
- 打字机占位动画（用户输入或 `busy` 时暂停；`prefers-reduced-motion` 时静态显示首条）
- 附件芯片行（先于 `chipRow` 插槽渲染）+ 拖拽放置区（`onDragOver/Leave/Drop`）
- 快捷动作 chips（模板渲染 → `onSubmit(overrideText)`）
- 麦克风按钮（`microphone` prop 存在时渲染）
- 发送/停止/排队四态按钮（`busy × canSubmit` 的 4 元组逻辑）
- 全部插槽 props：`topAffordance / chipRow / actionsLeft / extrasAbove / extrasBelow / dropOverlay / renderSendButton / kbdHints` 等
- `onKeyDownExtra`（返回 `true` 跳过默认 Enter 逻辑）、`onPaste` 透传
- `autoFocus / rows / disabled / frameVariant / flatTop` 等外观与行为开关

## 9. 消费界面（5 处）

平替必须在以下全部界面无回归：

| 界面 | 文件 | 注入的 provider |
|---|---|---|
| ChatView | `packages/ui/src/chat/ChatView.tsx` | 仅内置 |
| ChatSurface（主面板，全能力） | `packages/ui/src/chat/ChatSurface.tsx` | 由宿主决定 |
| Quick-Ask 弹窗 | `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx` | Files |
| 浏览器扩展侧栏 | `apps/browser-extension/src/sidepanel/index.tsx` | Page-context |
| 桌面主窗 / FullScreenChatView | `apps/desktop/src/renderer/App.tsx` + `packages/ui/src/chat/FullScreenChatView.tsx` | Files |

## 10. 构建依赖顺序（同一交付，非分批发布）

按依赖关系排定的实现顺序，全部进同一个交付：

1. **编辑器内核平替**：接入 Lexical，保持 `value:string` 契约、§8 行为 1:1 对齐；5 界面验证无回归。（一切的地基）
2. **触发引擎 + 菜单 + 芯片 + 序列化**：TriggerPlugin / TriggerMenu / MentionNode / serialize·parse，先用最简单的内置 provider（Skills）打通 @ 全链路。
3. **后端两接口 + core 客户端**：`/hermes/commands`、`/hermes/personalities` 与 `getHermesCommands()`、`getHermesPersonalities()`。可与 1–2 并行（接口契约先定）。
4. **内置 providers 全量**：slash（含 subcommand 二级补全 + UI 动作覆盖表）、sessions、personas、channels。
5. **注入 providers**：桌面 Files（新增 IPC）、扩展 Page-context（包 `chromePageContext`）。
6. **发送层 expandMentions**：各 provider `serialize()` 展开 + 命令路由收口。

每步可独立测试、可合入；顺序只表达依赖，不表达发布批次。

## 11. 错误处理

- provider `search()` 失败/超时 → 菜单显示「加载失败」或空态，**不阻塞输入**。
- `parse()` 遇非法 token → 退化为纯文本，保留原字符。
- 触发后无候选 → 菜单显示空态提示（如「无匹配命令/引用」）。
- 命令模式整行无匹配命令 → 当作普通消息发送（对齐 CLI：不强行拦截）。
- 菜单打开时按 Esc / 失焦 / 删除触发符 → 关闭菜单并回到普通编辑。
- 注入 provider 缺失（如扩展端无 Files）→ 该分组不出现，其余正常。

## 12. 测试策略

- **往返属性测试**：随机构造含芯片的节点树，`parse(serialize(x)) === x`；任意字符串经 `parse → serialize` 不丢字符。
- **键盘路径**：IME 合成、Enter/Cmd+Enter/Shift+Enter、菜单内上下/Enter/Esc。
- **provider 单测**：各 `match/search/onSelect`，命中排序、空态、失败态；slash 二级 subcommand 补全。
- **命令路由**：`send` 类整行入 content；`ui-action` 类触发动作且不发消息；行首 vs 非行首 `/`。
- **后端接口**：`/hermes/commands` surface 过滤生效（不含 `cli_only` / 被剔除的消息平台命令）；`/hermes/personalities` 含内置+自定义；两个 core 客户端解析与失败兜底。
- **注入 provider**：桌面 Files（IPC 列表、模糊匹配）、扩展 Page-context（`@page`/`@tab` 取当前页/标签页并展开）。
- **集成 / 快照**：5 界面 Composer 挂载与发送链路；附件、快捷动作、麦克风与触发能力共存不冲突。

## 13. 明确的平台约束（非延期）

- 浏览器扩展端**无法**列本地文件（Chrome MV3 平台限制）；以 `@page`/`@tab` 页面上下文替代，已纳入交付。
- 其余无延期项：斜杠命令、subcommand 补全、全部 @ 来源、两个后端接口均在本次交付内完成。
