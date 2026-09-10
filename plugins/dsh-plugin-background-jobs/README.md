# 异步任务记录与展示

本插件观察官方 `dsh-jobs` / `dsh-jobs-local`，提供会话内执行记录、工作台列表、输出预览和完成通知。不注册模型工具，不执行工具，不将同步工具转换为异步工具。

## 职责

- 原生命令、一次性子代理和生产插件管理执行资源，官方 jobs 管生命周期、所属会话、读取、停止和模型完成通知。
- `BackgroundJobs` 捕获当前工具调用的 `rootCallId ?? callId`，保存任务记录并提供详情 RPC。不存在调用上下文时不猜关联。
- `SubagentJobs` 只为官方 continuable 子代理的每轮执行建立 job；一次性子代理已由官方登记，不重复建立。官方 subagent 负责模型回报，这个桥接领取 jobs 的报告责任以避免重复唤醒。
- UI 复用 `amiba.workbench.panel`、`amiba.conversation.progress` 和 `amiba.conversation.notice`。进行中显示轻量提示，已结束列表默认收起。

## 生产者接入

生产者使用 `ctx.jobs.start({owner: agent, ...})`，即可被列表观察。全局无 owner 的任务不生成会话记录。

需要自定义标题、终端类型和实时输出时，依赖 `amibaBackgroundJobs`：

```ts
ctx.amibaBackgroundJobs.present(agent.id, jobId, {
  title: "运行项目测试",
  toolName: "bash",
  peekOutput: () => producerOutputSnapshot(),
});
```

`peekOutput` 是无消费副作用的快照，不得调用 `jobs.read` 或推进模型输出游标。任务结算时它必须仍可读取，供完成通知发布前保存。不要在生产者完成瞬间先销毁预览。标题应描述工作目的，不能直接暴露命令中的环境变量或凭据。

当前官方 `JobHooks.readOutput` 有一个消费游标。未提供独立预览时，只保存正常工具调用已经读取的输出，不为了界面主动消费。运行中暂无输出显示“等待输出…”，结束后暂无输出显示“暂无输出”。结果视图复用主面板 Markdown；终端文本保持原样。子代理预览是结果摘要，不是完整子会话历史。

## 通知与持久记录

模型通知继续由官方 `tool-jobs` 或 subagent 负责，本插件只生成结构化 `amiba/notice` 展示事件，不再次唤醒模型。官方 `tool-jobs` 的 UI 通知被抑制以避免重复展示。通用通知协议见 [展示通知](../../docs/presentation-notices.md)。

记录使用官方 storage domain，存放于官方会话目录的 `plugins/background-jobs/records.json`。持久记录 ID 独立于可能复用的运行时 job ID。完成通知引用持久 ID 和启动时间，带原调用的 execution placement。详情 RPC 可在未激活 Agent 时读取；停止只作用于当前进程内的同一运行实例。

记录包括标题、状态、时间、调用关联与最多 65536 字符的输出快照，不保存执行句柄。新进程读取未结束的记录时标记为 interrupted，不自动重跑。持久输出不等于恢复官方模型工具的运行时读取能力。

列表必须有 `recordId`、`kind`、`status`、`startedAt`、`updatedAt`、`resultCallIds`；详情必须有 `liveOutput`、`outputAvailable`。不补旧字段、不做迁移、不根据标题或时间猜关联。正在创建的实时 job 可以先显示状态，记录同步前不开启详情或停止入口。

## 外部 Agent

优先实现官方 `SubagentProvider` 并复用官方子代理工具。不要为同一次官方子代理执行额外登记 job。非 Agent 的异步服务直接作为 jobs 生产者。具体约定见 [外部 Agent 接入](../../docs/external-agent-integration.md)。

## 验证

`pnpm --filter @amiba/dsh-plugin-background-jobs test` 验证记录、会话归属、非消费预览、continuation 桥接、通知和工作台。运行包 smoke 使用显式 jobs 生产插件，并通过官方 `job_output` 收取结果；真实重启后验证记录与输出仍可查询。

## 命令与子代理的不同展示

UI Shell 的通用 `amiba.tool.execution` 槽接收原工具 owner 和 fallback。本插件只接管有精确调用关联的 bash/pwsh/pty-send job；其他工具返回原插件 fallback，核心不识别命令名称。

命令原工具行显示 job 状态，时间统一采用本次工具调用耗时；命令实际运行耗时在展开详情中明确标注，可展开已保存输出、停止运行。官方 job_output 读取的 canonical text 独立于状态页脚保存，终态重复读取不会重复累加输出。完成通知保留为持久事件，但已关联命令不再另画一条通知。结果读取行以“获取执行结果”展示对应命令、读取状态和本次调用耗时，点击在当前行展开输出；工作台命令汇总定位原调用，子代理等任务仍在工作台展开详情。

调用定位由会话级导航服务提供：先展开包含调用的执行组，再滚动至原工具行。`revealToolCall` 和 `revealVersion` 通过工具 owner 传递，插件无须查询页面 DOM 或模拟点击。未载入的调用定位失败会明确提示，不猜另一个调用。

命令与结果读取的标题行统一复用 `ToolRowFrame`：图标、目标截断、调用耗时、悬停和展开箭头均由公共组件负责。插件只提供展开内容；运行状态、实际耗时与停止操作位于详情中。公共组件支持受控展开，供按需加载和调用定位使用。
