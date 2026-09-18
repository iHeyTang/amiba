# 会话引擎主进程化（Main-process chat engine host）

日期：2026-09-18
分支：`feat/main-process-chat-engine`

## 动机

第一个里程碑把**共享状态快照**（宠物库/通知流/会话活动）下沉到主进程；本里程碑把**会话
引擎本身**（`DshChatEngineClient`：运行状态、逐会话 journal、审批/提问等待）整体迁到
Electron 主进程。此前每个窗口各自 `new DshChatEngineClient(dshClient)`，各持一套与 DSH
运行时的 WebSocket 连接与运行状态——窗口即引擎。现在：

- 主进程持有**唯一引擎与唯一一组 DSH 连接**（run/follow/events mux）；
- 窗口只订阅它们正在展示的会话（`window.amiba.chatEngine.subscribe`），收到的
  snapshot/事件是主进程按会话路由过来的**投影**；
- 关闭窗口只移除订阅，运行状态存活；重开窗口重新挂回实时状态。

附带收益：引擎新增 `follow(sessionId)` 后，**跨窗口/跨进程的实时直播首次真正成立**——
此前"打开会话的人"只能看到自己提交的回合，宿主侧回合要靠重进会话才看到（也正是用户
此前反馈过的现象）。

## 数据流图

```
                          ┌──────────────────────────────────────────┐
                          │             Electron 主进程                │
                          │                                          │
   DSH 运行时(子进程)        │  dshRuntime (唯一 DshApiClient)             │
 ┌──────────────────┐      │     │                                    │
 │ session/follow   │◄─────┼─────┤  DshChatEngineClient（唯一引擎）      │
 │ $events          │◄─────┼─────┤    ├─ per-session follow(sessionId)  │
 │ session/control  │◄─────┼─────┤    ├─ run()/submit/abort/respond     │
 │ session/prompt…  │◄─────┼─────┤    ├─ events mux 审批/提问 watcher   │
 └──────────────────┘      │     │    └─ onSnapshot/onStreamEvent      │
                           │     │            │                        │
                           │     │  ChatEngineHost（按窗口订阅路由）      │
                           │     │    sessionId → Set<webContentsId>   │
                           │     │    │  subscribe→follow；last→unfollow│
                           │     │    │  附件序列化→回提交窗口           │
                           │     └────┼────────────────────────────────┘
                           │          │ IPC: chat-engine:subscribe/post/
                           │          │      respond-*/submit-receipt/…
                           │          │ 推送: chat-engine:message
                           └──────────┼────────────────────────────────┘
                                      ▼ IPC（preload window.amiba.chatEngine）
              ┌───────────────────────┴──────────────────────┐
              ▼                                               ▼
       主窗口（ui-shell 插件）                            Quick-Ask
       getPlatform().chatEngine（协议 ChatEngineClient）   同左；仅当主进程引擎
       优先于本地 DshChatEngineClient 兜底                    不存在时才本地兜底
```

### 要点

- **多消费者安全性**：`$events` 审批水瀑是对所有客户端广播 + 按客户端投递记账
  （`dsh-api-gateway`），主进程引擎持有并应答；窗口只经 IPC 转发指令，不重复抢答。
- **follow 与 run 的防重复**：同一引擎内 `run()` 进行中时 `follow()` 的帧被丢弃
  （`observePassiveFrame` 的 controller 守卫 + follow 循环的本地-run 检查），跟随
  持续消费帧保持与实时边缘同步，回合结束后自动恢复被动跟随。
- **附件草稿**：官方草稿注册表在渲染进程；引擎序列化时主进程向"提交该回合的窗口"
  发一次性请求，窗口用本地 `agentAttachments.serialize` 解析后回传。
- **子代理地址**：主进程从 `sessions.local-meta`（渲染进程会话运行时持久化的
  retainedAddress）与 `session/list` 的 parentSessionId 解析，保持 subagent 续聊语义。

## 窗口内仍持有的状态（剩余清单）

| 项 | 说明 | 下一步 |
|---|---|---|
| `SessionsStore`（索引/活动会话/消息缓存） | 仍是每窗口实例；`agentSessions` 适配器仍走窗口内 `DshApiClient`（unary 已走主进程代理；history 是打开的 follow 页读） | 将 agentSessions/agentWorkspaces/agentModels 适配器改为 IPC 代理，Quick-Ask 可移除渲染层 DshApiClient |
| Quick-Ask 的渲染层 DshApiClient | 仅服务上述适配器（会话列表/历史） | 同上 |
| 主窗口 DSH Web Shell 插件图 | 官方插件/通知 UI 依赖它（shell 自身连接） | 不属于"会话引擎"范畴，保留 |
| pets/notification 插件自身 store | 与引擎无关 | 见上一里程碑（订阅层） |

## 验证

- `apps/desktop` typecheck（renderer + node）✅
- `plugins/dsh-plugin-ui-shell` build ✅（typecheck 基线坏在测试/脚本文件的环境漂移，
  与本次改动无关，已在 dev worktree 复现）
- `packages/app-runtime` vitest ✅ 255/255（含新增 follow/unfollow 2 例）
- `apps/desktop build`（electron-vite + verify-desktop-bundle）✅
- `apps/desktop test`（110 主进程测试）见提交说明