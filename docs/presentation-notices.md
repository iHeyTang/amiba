# 插件展示通知与执行归属

插件需要向用户展示事件时，追加 `amiba/notice`（`PresentationNotice`）。这是持久化的 UI 事件，不向模型注入消息，也不创建用户轮次。需要唤醒模型的行为仍由官方 jobs/agent 机制负责。

## 写入约定

使用 `@amiba/dsh-plugin-background-jobs` 的 `appendPresentationNotice(session, notice)`，不要直接 append。统一入口给事件信封添加 `ignorable: true`：DSH 不认识这个 UI 扩展时仍可回放会话，事件内容不会被删除；Amiba 仍可投影并展示它。仅适用于不影响模型执行状态的 UI 事件，不能用于绕过未知必需事件校验。

当前官方 0.1.1-rc.2 的读取器支持该字段，但 append 未透传，仓库通过受版本约束的 pnpm patch 补足。runtime:prepare 同步应用该补丁到 npm 安装的托管运行时；升级官方包时需要重新确认支持情况。

## 两种独立的关联

- `reference` 是插件实体引用，供插件渲染器打开任务或其他实体；核心不解释实体类型。
- `placement` 是核心的展示归属。省略或 `{ kind: "standalone" }` 表示独立通知；`{ kind: "execution", sessionId, callId }` 表示属于指定会话的工具调用执行记录。

不要把实体 ID 填入 callId，不要根据标题、消息顺序、完成时正在运行的调用猜测归属。调用中创建的后台工作必须在派出时保留 `rootCallId ?? callId`，而非完成时获取当前调用。

```ts
appendPresentationNotice(owner.session, {
  version: 1,
  id: notificationId,
  source: "example-plugin",
  summary: "构建完成",
  body: "构建已完成，可以查看产物。",
  placement: { kind: "execution", sessionId: owner.id, callId: dispatchCallId },
  reference: { kind: "build", sessionId: owner.id, id: buildId },
});
```

## 核心行为

实时和历史投影保留相同的 placement。对话流校验当前会话后，通过精确 callId 查找已加载的工具执行记录，即使通知跨用户轮次到达，也归入原调用的执行折叠区。折叠内继续复用 `amiba.conversation.notice` 插件渲染器。

没有关联、外部会话关联或尚未加载原调用时，通知仍独立可见；不会寻找邻近执行记录，不会隐藏未知通知。原调用随后加载时会按明确关联重新归组。旧记录不做迁移或猜测补全。

## 使用 jobs 的插件

`BackgroundJobs` 在观察 jobs 创建时捕获调用上下文，完成通知自动携带原调用归属。插件继续使用官方 jobs 注册执行；无需自己维护通知归组。没有工具调用上下文的生产者（例如主动系统事件）默认独立展示。

实体引用解决导航，placement 解决执行归属，两者互不替代；整个过程不引入新的任务生命周期。

## Persistent notifications

Persistent notification state lives in `dsh-plugin-notification-hub`, independently of presentation. Its own DSH Remote namespace supplies a cursor-based subscription; read, dismissal and business resolution are separate lifecycle facts. The product shell publishes session read watermarks through the invisible `amiba.session.observer` slot. This observer remains active without the pets plugin.

A presentation plugin owns its own notification policy and UI; no shared modal, bubble or pet component is required. The pet plugin's desktop bubbles are one consumer.
