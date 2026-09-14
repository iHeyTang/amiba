# 异步任务记录与展示

本插件观察官方 `dsh-jobs` / `dsh-jobs-local`，提供会话内执行记录、工作台列表和输出预览。不注册模型工具，不执行工具，不将同步工具转换为异步工具。

## 职责

- 原生命令、一次性子代理和生产插件管理执行资源，官方 jobs 管生命周期、所属会话、读取、停止和模型完成通知。
- `BackgroundJobs` 捕获当前工具调用的 `rootCallId ?? callId`，保存任务记录并提供详情 RPC。不存在调用上下文时不猜关联。
- `SubagentJobs` 只为官方 continuable 子代理的每轮执行建立 job；一次性子代理已由官方登记，不重复建立。官方 subagent 负责模型回报，这个桥接领取 jobs 的报告责任以避免重复唤醒。
- UI 通过 `amiba.workbench.panel` 提供任务列表，已结束列表默认收起。对话中沿用普通工具的定制展示，不接管工具行，也不额外展示后台进度或完成状态。

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

模型通知继续由官方 `tool-jobs` 或 subagent 负责，本插件只生成结构化 `amiba/notice` 展示事件，不再次唤醒模型。结构化后台完成通知和官方 `tool-jobs` 的 UI 通知均不在对话中展示，结果通过普通工具结果与助手回复呈现。通用通知协议见 [展示通知](../../docs/presentation-notices.md)。

记录使用官方 storage domain，存放于官方会话目录的 `plugins/background-jobs/records.json`。持久记录 ID 独立于可能复用的运行时 job ID。完成通知引用持久 ID 和启动时间，带原调用的 execution placement。详情 RPC 可在未激活 Agent 时读取；停止只作用于当前进程内的同一运行实例。

记录包括标题、状态、时间、调用关联与最多 65536 字符的输出快照，不保存执行句柄。新进程读取未结束的记录时标记为 interrupted，不自动重跑。持久输出不等于恢复官方模型工具的运行时读取能力。

列表必须有 `recordId`、`kind`、`status`、`startedAt`、`updatedAt`、`resultCallIds`；详情必须有 `liveOutput`、`outputAvailable`。不补旧字段、不做迁移、不根据标题或时间猜关联。正在创建的实时 job 可以先显示状态，记录同步前不开启详情或停止入口。

## 外部 Agent

优先实现官方 `SubagentProvider` 并复用官方子代理工具。不要为同一次官方子代理执行额外登记 job。非 Agent 的异步服务直接作为 jobs 生产者。具体约定见 [外部 Agent 接入](../../docs/external-agent-integration.md)。

## 验证

`pnpm --filter @amiba/dsh-plugin-background-jobs test` 验证记录、会话归属、非消费预览、continuation 桥接、通知和工作台。运行包 smoke 使用显式 jobs 生产插件，并通过官方 `job_output` 收取结果；真实重启后验证记录与输出仍可查询。

## 对话中的工具展示

bash/pwsh/pty-send、job_output、job_list 和 job_kill 沿用各自的普通工具定制展示。本插件不注册 `amiba.tool.execution` 或 `amiba.conversation.progress`，不关联改写、隐藏或合并结果读取行，也不在工具详情里追加后台状态、实际运行计时、轮询或停止操作。对话未结束时使用会话统一的“正在处理”提示。

工作台继续提供任务状态、输出预览和停止操作；命令汇总定位原调用，子代理等任务在工作台展开详情。调用定位由会话级导航服务先展开执行组，再滚动至原工具行。未载入的调用定位失败会明确提示，不猜另一个调用。
