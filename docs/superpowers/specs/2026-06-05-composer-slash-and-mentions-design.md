# Composer 斜杠命令 + @ 引用设计

- 日期：2026-06-05
- 范围：packages/ui（主体）+ packages/core（数据源复用）+ apps/desktop（Files provider 注入）
- 目标：把 hermes-agent CLI 的「`/` 唤起命令、`@` 唤起引用」体验带到 web/desktop 聊天输入框
- 第一阶段交付物：基于 Lexical 的富文本 Composer 内核（行为 1:1 平替）+ 触发引擎 + Skills 的 @ 芯片

## 1. 目标与非目标

### 目标

- 在聊天输入框中支持两种触发：
  - **`/` 斜杠命令**：仅在行首生效，整行即一条命令，对齐 CLI 的 `_looks_like_slash_command` 语义。
  - **`@` 行内引用**：任意位置触发，选中后插入可整体删除的**原子芯片**，嵌在正常消息文本里。
- `@` 支持四类来源：**Skills / Files-文件夹 / Sessions-历史 / Agents-Personas**（数据源就绪程度不同，见 §5 分阶段）。
- 斜杠命令采用 **hybrid** 行为：多数命令作为文本发给后端（后端已能解析），少数有原生 UI 的命令（如打开设置）选中即执行 UI 动作。
- 用 **Lexical** 替换现有 `<textarea>`，芯片为原子节点，但**对外契约保持 `value: string` / `onChange(string)` 不变**，5 个消费界面零改动。
- 提供**可插拔 provider 抽象**：`packages/ui` 内置可处处使用的 provider，宿主特有数据源（如 Files）由各 app 注入。

### 非目标（明确不做）

- ❌ 改 `Composer` 的对外 props 契约（仍是 `value: string`）。
- ❌ 后端识别 `@[...]` token 语法 —— 展开在前端发送层完成。
- ❌ 新增 `/hermes/commands` 后端接口（一期用静态镜像；后续可选）。
- ❌ 真正的 Personas 列表接口（一期用 channels 兜底）。
- ❌ 浏览器扩展端的 Files 引用（一期仅桌面端注入；扩展端退化为无该 provider）。
- ❌ 富文本格式化（粗体/列表等）—— 编辑器只承载纯文本 + 芯片 + 命令文本。

## 2. 核心策略：保留字符串契约，芯片是富渲染层

编辑器内部用 Lexical 节点树，但对外仍是字符串。**规范 token 串**是 single source of truth：

```
帮我看下 @[file:src/foo.ts] 这个文件，参考 @[session:a1b2|登录重构] 的讨论
```

- `serialize(editorState) -> string`：每次编辑把节点树序列化成 token 串，喂给 `onChange`。
- `parse(string) -> editorState`：外部 `value` 变化时（快捷动作预填、`pendingPrompt` 等），把普通文本还原成文本节点、`@[...]` 还原成芯片节点。
- 非法/未知 token → 退化为纯文本，**绝不丢字符**。

Token 语法（前端内部约定，后端不感知）：

| 类型 | Token | 说明 |
|---|---|---|
| Skill | `@[skill:translate]` | name |
| File | `@[file:src/foo.ts]` | 相对路径 |
| Session | `@[session:<id>\|<title>]` | id 权威，title 仅展示 |
| Channel | `@[channel:<id>]` | channel id |

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
   ├─ TriggerPlugin                     检测 `/`(行首) 与 `@`(任意位置)，维护 query
   ├─ TriggerMenu (绝对定位浮层)         候选列表 + 键盘上下/Enter/Esc + 空态/错误态
   ├─ serialize / parse                 节点树 <-> 规范 token 串
   └─ ProviderRegistry                  { slash, skills, sessions, channels, files? }

发送层 (Composer.onSubmit 内)
   └─ expandMentions(tokenString) -> finalText
        - 命令模式整行: 原样发 (后端解析) 或拦截为 UI 动作
        - @[skill|file|session|channel]: 各 provider.serialize() 展开
```

组件落点（建议）：

- `packages/ui/src/chat/composer/` 新目录：
  - `RichComposerEditor.tsx`、`plugins/*`、`MentionNode.tsx`、`TriggerMenu.tsx`、`serialize.ts`、`parse.ts`
  - `providers/`：`types.ts`（接口）、`skills.ts`、`sessions.ts`、`channels.ts`、`slash.ts`、`slash-registry.ts`（静态镜像）
- `Composer.tsx`：内部把 `<Textarea>` 换成 `<RichComposerEditor>`，props 不变。
- Files provider 接口在 ui 定义，实现由 `apps/desktop` 注入（Electron IPC）。

## 4. Provider 抽象

```ts
interface MenuItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  // 选中后要插入的引用（@ 类）或要执行的动作（slash UI 动作类）
  insert?: MentionData          // @ 类：生成芯片
  action?: (ctx) => void        // slash UI 动作类：选中即执行
  raw?: string                  // slash 文本类：插入的命令文本
}

interface TriggerProvider {
  trigger: '/' | '@'
  id: string
  // 命中判定 / 排序权重（数字越大越靠前；false 不参与）
  match(query: string): boolean | number
  // 拉候选（可异步、可失败 -> 菜单显示错误态，不阻塞输入）
  search(query: string): Promise<MenuItem[]>
  onSelect(item: MenuItem, editor: LexicalEditor): void
  // 该类型 token -> 发送文本（仅 @ 类需要）
  serialize?(mention: MentionData): string
}

interface MentionData {
  type: 'skill' | 'file' | 'session' | 'channel'
  payload: Record<string, string>   // 如 { name } / { path } / { id, title } / { id }
  display: string                    // 芯片上显示的文字
}
```

- `packages/ui` 内置 `skills` / `sessions` / `channels` / `slash`（数据源在 core，处处可用）。
- `files` provider 由 app 通过 Composer 的注入点传入（可选；缺省则 `@` 菜单不含 Files 分组）。

## 5. 五类来源与数据缺口

| Provider | 触发 | 数据源 | 状态 |
|---|---|---|---|
| Slash 命令 | `/` 行首 | 静态镜像 `slash-registry.ts`（精选 `COMMAND_REGISTRY`，排除 `cli_only`/`gateway_only`） | ✅ |
| Skills | `@` | `getHermesSkills()`（`@hermes-x/core`） | ✅ 全界面 |
| Sessions | `@` | `listHermesSessions()`（`@hermes-x/core`） | ✅ |
| Agents/Channels | `@` | `listChannels()`（静态） | ⚠️ 仅 channels，无 personas |
| Files/文件夹 | `@` | **无统一接口**，按界面注入（桌面 Electron IPC） | ⚠️ 扩展端一期不做 |

**数据缺口处理**：

- Files：`packages/ui` 只定义 provider 接口；桌面端实现「列工作区文件」的 IPC 并注入。浏览器扩展端一期不注入该 provider。
- Personas：一期用 channels 兜底当作「目标/Agent」。真正的 persona 列表需后端补接口，列为后续。

## 6. 斜杠命令清单来源（静态镜像）

- 一期在 `slash-registry.ts` 维护精选命令清单，字段与 Python `CommandDef` 对齐：`name / description / category / aliases / argsHint / subcommands`，外加前端特有的 `kind: 'send' | 'ui-action'` 与可选 `onSelect`。
- 仅收录 UI 相关、`cli_only=false` 且 `gateway_only=false` 的命令。
- `kind: 'send'`（如 `/model`、`/new`、`/skills`、`/help`、`/status`）→ 补全为文本，发送时整行原样发后端。
- `kind: 'ui-action'`（如打开设置面板）→ 选中即执行 `onSelect`，清空输入，不发消息。
- 漂移风险：清单与后端 registry 手工同步。后续可加 `/hermes/commands` 接口由后端下发，替换静态镜像（provider 接口不变）。

## 7. 序列化与发送链路

- **编辑时**：`onChange(serialize(editorState))` → token 串，维持 `value: string` 契约。
- **发送时**：`Composer.onSubmit` 拿 token 串，先判定是否命令模式（行首 `/` 且整行匹配单条命令）：
  - 命令模式 + `kind:'ui-action'` → 执行动作并 return（不发消息）。
  - 命令模式 + `kind:'send'` → 原样把整行作为 content 发后端。
  - 否则走 `expandMentions(tokenString)`：扫描 `@[...]`，按 type 调对应 provider 的 `serialize()` 展开为最终文本，普通文本原样保留，得到 `finalText` 后发送。
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

| 界面 | 文件 |
|---|---|
| ChatView | `packages/ui/src/chat/ChatView.tsx` |
| ChatSurface（主面板，全能力） | `packages/ui/src/chat/ChatSurface.tsx` |
| Quick-Ask 弹窗 | `apps/desktop/src/renderer/quick-ask/QuickAskView.tsx` |
| 浏览器扩展侧栏 | `apps/browser-extension/src/sidepanel/index.tsx` |
| 桌面主窗 / FullScreenChatView | `apps/desktop/src/renderer/App.tsx` + `packages/ui/src/chat/FullScreenChatView.tsx` |

Files provider 仅桌面相关界面注入；其余界面 `@` 菜单不含 Files 分组（优雅降级）。

## 10. 分阶段交付（降风险）

- **P0 平替**：接入 Lexical，做成保持 `value:string` 契约、行为 1:1 对齐的 Composer 内核；5 界面验证无回归。**不加任何触发能力。**
- **P1**：触发引擎 + TriggerMenu + MentionNode 芯片 + serialize/parse，**只接 Skills**（接口处处可用、最简单），打通 @ 全链路。
- **P2**：Slash provider（静态镜像 + hybrid 路由：send vs ui-action）。
- **P3**：Sessions + Channels providers。
- **P4**：Files provider（按界面注入，桌面优先，Electron IPC 列文件）。Personas 待后端接口。

每个阶段独立可测、可合入，互不阻塞。

## 11. 错误处理

- provider `search()` 失败/超时 → 菜单显示「加载失败」或空态，**不阻塞输入**。
- `parse()` 遇非法 token → 退化为纯文本，保留原字符。
- 触发后无候选 → 菜单显示空态提示（如「无匹配命令/引用」）。
- 命令模式整行无匹配命令 → 当作普通消息发送（对齐 CLI：不强行拦截）。
- 菜单打开时按 Esc / 失焦 / 删除触发符 → 关闭菜单并回到普通编辑。

## 12. 测试策略

- **往返属性测试**：随机构造含芯片的节点树，`parse(serialize(x)) === x`；任意字符串经 `parse → serialize` 不丢字符。
- **键盘路径**：IME 合成、Enter/Cmd+Enter/Shift+Enter、菜单内上下/Enter/Esc。
- **provider 单测**：各 `match/search/onSelect`，命中排序、空态、失败态。
- **命令路由**：`send` 类整行入 content；`ui-action` 类触发动作且不发消息；行首 vs 非行首 `/`。
- **集成 / 快照**：5 界面 Composer 挂载与发送链路；附件、快捷动作、麦克风与触发能力共存不冲突。

## 13. 待后续解决（不阻塞一期）

- `/hermes/commands` 后端接口（替换静态镜像，消除漂移）。
- 真正的 Personas 列表接口（替换 channels 兜底）。
- 浏览器扩展端的 Files 来源（页面上下文 / 受限 fs）。
