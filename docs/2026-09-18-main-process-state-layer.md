# 主进程 DSH 状态订阅层（Main-process DSH state subscription layer）

日期：2026-09-18
分支：`feat/main-process-state-layer`

## 动机

Amiba 桌面端的目标架构是 **窗口 = 视图，主进程 = 状态**。在引入本层之前，宠物库 /
通知流这类"应用级状态"由**主窗口渲染进程里的 DSH 插件实例**持有，再通过
`desktop-pet:*` IPC 转发给独立宠物页——主窗口一关，宠物数据更新即停。本层把这类
状态的**订阅与快照**下沉到 Electron 主进程（DSH 运行时由主进程启动、主进程本就持有
`DshApiClient`），所有窗口统一从主进程订阅，不再依赖任何窗口的存亡。

## 数据流图

```
                        ┌────────────────────────────────────────────────┐
                        │                 Electron 主进程                  │
                        │                                                │
   DSH 运行时(子进程)      │   dshRuntime (DshApiClient, 唯一连接)            │
 ┌──────────────────┐    │        │           │           │              │
 │ amibaPets        │◄───┼────────┘           │           │              │
 │  (list/activate) │    │  PetsSource ── 每 2s 轮询 amibaPets/list        │
 ├──────────────────┤    │        │           │           │              │
 │ amibaNotifications│    │        ▼           │           │              │
 │  (watch 长轮询)    │◄───┼─ NotificationSource ─ 20s 长轮询 watch(cursor) │
 ├──────────────────┤    │        │           │           │              │
 │ session/list     │    │        ▼           │           │              │
 │ session/follow   │◄───┼─ SessionsSource ─ 每 2s 轮询 session/list       │
 │ $events /        │    │        │           │           │              │
 │ session/control  │◄───┼─ ActivitySource ─ 精选会话 journal follow +      │
 └──────────────────┘    │        │            全局 events mux（只读观察）  │
                         │        ▼           │           │              │
                         │   DshStateLayer ── 合并一个快照 DshStateSnapshot │
                         │        │           │           │              │
                         │        ▼           │           │              │
                         │   dsh-state:snapshot 广播 → 全部窗口            │
                         │   dsh-state:get / activate-pet / dismiss /     │
                         │   mark-read / resync（invoke 契约）             │
                         └───────────────┬────────────────────────────────┘
                                         │ IPC（preload window.amiba.dshState）
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                           ▼
       宠物页窗口                    主窗口                      Quick-Ask
  renderer/pet（纯视图）         renderer/chat（仍持有自建      （本次仅收敛会话索引
  订阅快照渲染宠物/气泡           SessionsProvider；可后续       广播；其余状态仍窗口内）
  改动经契约回主进程           切换到同一订阅层，非本 PR）            订阅/刷新 sessions
```

### 谁生产 / 谁消费 / 谁持久化

| 数据 | 生产者 | 消费者 | 持久化 |
|---|---|---|---|
| 宠物库（pets/activeId） | `amibaPets` 远程服务（DSH 运行时内，主进程 `PetsSource` 轮询订阅） | 宠物页窗口（经 `dshState`）；后续主窗口内部件 | 运行时内 pets 插件自身的库文件（主进程层只持有内存快照） |
| 通知流（rows/connection） | `amibaNotifications`（主进程 `NotificationSource` watch 长轮询） | 宠物页气泡/直播状态 | notification-hub 插件持久化；主进程只维护 cursor + 快照 |
| 会话活动（activity） | DSH `session/list` + `session/follow` + `$events`（主进程 `ActivitySource` 只读投影） | 任意窗口的宠物/状态指示 | 无（纯投影） |
| 会话索引（sessions.revision 广播） | `session/list`（主进程 `SessionsSource` 变更检测）→ `mainStore` 写入 `sessions.revision` | 各窗口 `SessionsStore` 收到即 `refresh()` | `amiba-store.json`（仅 revision 标记） |

要点：**持久化全部留在 DSH 运行时侧**；主进程订阅层是"唯一快照 + 广播"的视图层，
关闭任何窗口都不中断生产。

## IPC 契约（单一订阅源）

`window.amiba.dshState`（preload 新增，类型 `shared/dsh-state.ts`）：

- `get(): Promise<DshStateSnapshot | null>` — 拉取当前快照
- `subscribe(listener)` — 订阅 `dsh-state:snapshot` 推送；订阅即回放一次当前快照
- `activatePet(id)` / `dismissNotification(id)` / `markSessionsRead(reads)` /
  `resyncNotifications()` — 变更全部经主进程执行

旧链路（主窗口插件 `forwardData` → `desktop-pet:data` → 宠物页）已删除。

## 边界与取舍

- `$events` 因 API Gateway 对 waterfall 采用"多消费者广播 + 按客户端投递记账"，
  本层的只读观察不会抢占渲染进程的审批应答路径（未处理即保持 pending，与无客户端
  打开时的行为一致；新客户端连接会收到 pending baseline 回放）。
- 会话活动为**近似投影**（turn/start、assistant/chunk、tool/call、turn/end、
  approval/question 等原始事件 → phase），与 `createSurfaceActivity` 的语义对齐但
  简化；标题在 `session/list` 携带 projections 或 projection 帧时可用。
- 主窗口内部件（内嵌宠物、设置页宠物库）仍走插件自身 store，未切到本层——见
  PR"剩余状态清单"。