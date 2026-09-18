# Amiba 主进程架构：窗口 = 视图，主进程 = 状态与运行态

日期：2026-09-18
分支：`feat/main-process-runtime`

## 目标形态

重型的、常驻的，全部住在 Electron **主进程**：

- **DSH 状态订阅层**（宠物库 / 通知流 / 会话活动 → 单一快照广播，`dsh-state:*`）
- **唯一会话引擎**（`DshChatEngineClient`：run/follow/审批/提问等待，`chat-engine:*`）
- **会话数据面**（`agentSessions` / `agentWorkspaces` / `agentModels` / presets /
  settings / credentials / permissions / skills / commands → `dsh-api:call` 代理）
- DSH 运行时子进程管理、窗口管理、附件上传载体

窗口只承担**展示**：React UI、每窗口选择状态（活动会话/打开的标签）、DSH Web
Shell 插件图（官方插件机制，主窗口）与渲染进程内附件草稿注册表（官方控制器）。

## 总数据流

```
                        ┌────────────────────────────────────────────────┐
                        │              Electron 主进程                     │
                        │  dshRuntime（唯一 DshApiClient ↔ DSH 运行时子进程）│
                        │     │          │           │                   │
   DSH 运行时(子进程)     │  DshStateLayer  ChatEngineHost  DshApiProxy     │
 ┌─────────────────┐     │  (宠物/通知/   (唯一引擎 +   (会话/工作区/模型    │
 │ amibaPets        │◄────┼── 活动快照)    按窗口订阅     等适配器)          │
 │ amibaNotifications│◄───┼─ → dsh-state:  路由 + 附件    → dsh-api:call    │
 │ session/follow   │◄────┼── snapshot 广播 序列化桥       统一 invoke       │
 │ $events          │◄────┼────────────────────────────────────────────  │
 │ session/list/prompt│◄───┼────────────────────────────────────────────  │
 └─────────────────┘     │        └──────────┬──────────────┬─────────┘   │
                         │   dsh-state:snapshot │ chat-engine:message │   │
                         └─────────────────────┼──────────────┼─────────┘
                                               ▼              ▼ IPC
     ┌────────────────────┬─────────────────────┴──────────────┴─────────┐
     ▼                    ▼                       ▼                      ▼
  主窗口（Shell 插件图）  Quick-Ask             宠物页              未来窗口
  展示 + 交互转发         纯视图（无 client/      纯视图（快照订阅）
```

### 谁生产 / 谁消费 / 谁持久化

| 数据 | 生产者（主进程） | 消费者（窗口） | 持久化 |
|---|---|---|---|
| 宠物库 / 通知流 / 会话活动 | DshStateLayer（`amibaPets·list`、`amibaNotifications·watch`、`session/follow`+`$events` 投影） | 宠物页、任意状态指示 | DSH 运行时内插件（订阅层只持内存快照） |
| 会话运行状态 / 事件流 / 审批等待 | ChatEngineHost（唯一 DshChatEngineClient + 每会话 follow） | 主窗口 ChatSurface、Quick-Ask | DSH session log（引擎只持运行态） |
| 会话索引 / 消息 / 工作区 / 模型 | DshApiProxy（`createDshPlatformAdapters` 绑定主进程 client） | SessionsStore（每窗口索引+选择）+ 各 UI | DSH 运行时 + `amiba-store.json`（本地元数据） |
| 附件草稿 | 渲染进程官方草稿注册表（引擎序列化时经主进程回请提交窗口） | 拥有草稿的窗口 | 草稿只活在所属窗口 |

### IPC 清单（preload `window.amiba`）

| 命名空间 | 用途 |
|---|---|
| `dshState`（get/subscribe/activatePet/dismissNotification/markSessionsRead/resync） | 共享状态快照订阅与变更 |
| `chatEngine`（subscribe/unsubscribe/submit/abort/respond-*/onMessage/序列化桥） | 唯一会话引擎消费 |
| `dshApis.call(adapter, method, args)` | 会话数据面适配器代理 |
| `sessions.revision` 存储标记（DshStateLayer 写、SessionsStore 订阅刷新） | 跨窗口会话索引即时同步 |

## 窗口剩余状态清单（明确边界）

| 留在窗口 | 原因 |
|---|---|
| `SessionsStore` 的**选择/展示状态**（activeId、openTabs、活动消息缓存） | 跨窗口同步选择曾是 UX bug 的根因，设计上就是每窗口视图层状态；其**数据面**已全部走主进程 |
| 主窗口 DSH Web Shell 插件图（官方插件 UI/通知/官方会话控制器） | DSH 官方机制把插件客户端绑在渲染进程；Amiba 自身重状态已全部下沉 |
| 渲染进程附件草稿注册表 | 官方 ConversationController 的草稿/文件在所属窗口（字节不跨进程） |

## 行为保证与边界

- `$events` 审批水瀑对全部客户端广播且按客户端投递记账：主进程引擎持有并应答，
  窗口只经 IPC 转发指令，无重复抢答；只读观察（订阅层）不阻塞应答路径。
- 同一引擎内 `run()` 进行中时 `follow()` 帧被丢弃（controller 守卫 + follow 循环
  检查），回合结束自动恢复被动跟随；`follow` 让"宿主侧回合实时直播"首次真正成立。
- 子代理地址由主进程从 `sessions.local-meta` 与 `session/list.parentSessionId`
  解析；工作区策略镜像渲染层 `resolveSessionCreationWorkspace`。
- Quick-Ask 不再 boot/transport/自建 DshApiClient；主窗口渲染层也不再为聊天自建
  client（仅插件图按 DSH 机制保留）。
- `session/list` 由**单一** `SessionIndex` 轮询器供给（dsh-state 签名广播 /
  activity 选会话 / 引擎 hostRunning 与子代理 parent）——一处轮询，三处消费。
- 会话创建目录策略（`session-workspace.ts`）与子代理 retainedAddress 是**共享纯
  函数**（渲染层与主进程同一实现，`resolveSessionCreationWorkspace` 只是薄包装）。
- 旧 `desktop-pet:activity` 发布管道已删除（宠物页早不消费；订阅层提供活动）。

## 验证

- desktop typecheck（renderer + node）✅
- desktop build（electron-vite + verify-desktop-bundle；完整 `pnpm build` 被已知
  runtime:prepare 补丁重放环境漂移挡住——与代码无关）✅
- desktop 主进程测试（110/110）✅
- app-runtime vitest（255/255，含 follow/unfollow 单测）✅
- ui-shell 插件 build ✅
- pets 插件 typecheck ✅；test 21 通过 + 1 skip + 1 环境漂移失败（`remote.test.ts`
  `registerGenerationSource`，在未改动 dev worktree 同样复现，与本次无关）
- ui-shell 插件 build ✅（其 typecheck 基线坏在测试/脚本文件的环境漂移，同源复现）