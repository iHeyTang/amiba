# 外部 Agent 的官方扩展路径

以仓库当前 DSH 0.1.1-rc.2 的已安装源码为依据。无需新增通用工具包装器或平行任务系统。

## 首选：SubagentProvider

官方 `@deepseek-ai/dsh-subagent` 提供 `ctx.subagents.registerProvider(provider)`。多个具名 provider 可共存，例如分别实现 Codex、Claude Code 的执行传输。它不是 LLM 模型适配器：负责一次完整 Agent 执行。

provider 实现以下官方契约：

- `name`：唯一 provider 名。
- `capabilities`：如实声明 outputSchema、depthLimit、toolFilter、persona；不支持的能力不能声称已经传给外部 Agent。
- `inheritsParentContext`：如实说明是否继承父会话上下文。
- `start(request)`：建立执行后返回 `SubagentRun`，启动中失败先清理资源。
- `SubagentRun.id`：父会话范围唯一的运行 ID；远程执行不需要伪造本地会话。
- `localAgent: undefined`：用于外部执行。
- `result`：直到外部 Agent 真正完成才结算，产出官方 SubagentResult。远端“已接收”或队列确认不是完成。
- `dispose()`：幂等地停止执行、等待资源退出并清理。持续响应 request.signal，包括启动后取消。

组合层安装 provider 插件，再配置官方 `@deepseek-ai/dsh-tool-subagent` 的 provider 和 toolName。该官方工具已经区分前台与后台；后台分支调用 `jobs.start({kind: "subagent", owner: parent, ...})`，负责将 run 的结算和取消接到 jobs。插件不要再建立第二个 job，也不要再发送一份模型完成通知。

链路为：模型 → 官方子代理工具 → 官方 subagents → provider → 外部 SDK/CLI/协议；后台分支同时由官方工具登记 jobs → Amiba 记录/展示插件。

官方接口注释提及 `@deepseek-ai/dsh-subagent-acp`；当前运行包只安装 spawn/fork 等本地 provider，没有安装 ACP provider。因此 ACP 可以作为下一步核查的传输选项，不能认定它已可用，也不能假设目标产品都支持同一协议。实际实现前按目标 Agent 当前提供的 SDK、CLI 或 ACP 接口选择传输。

外部一次性执行先使用上述 one-shot 契约。当前 continuable 契约以官方本地子会话/AgentHandle 为基础，不能把远程会话 ID 填进本地 childId 后当作已支持继续对话。远程多轮恢复需单独核实官方支持范围，再设计 provider 内的绑定。

## 非 Agent 的原生异步生产者

编译、下载等优先使用已有原生命令的后台能力。确需独立异步服务插件时，直接实现官方 `JobStart.run()`：返回 `cancel(reason)` 和 `done: Promise<JobOutcome>`，可选消费式 `readOutput()`。执行资源必须在 run 内启动，避免 jobs 准入失败后留下无人管理的执行。

取消应幂等，并最终结算 done；done 应在资源清理后完成。远程取消尚未得到确认时不能宣称任务已经停止。使用工具调用的 Agent 作为 owner，沿用官方 job_output/job_kill 的所属会话检查。

Amiba 的 `amibaBackgroundJobs.present()` 是可选展示接口：标题、toolName、非消费 peekOutput。它不接收工具名和参数来替别人执行工作，不掌管执行状态机。

## 输出与重启

jobs 保留当前进程的执行控制。Amiba 保存标题、最终状态、耗时和输出快照，供重启查看。外部 Agent 的完整会话、工件及远端执行 ID 由 provider 按实际协议维护；如果这些数据属于本地父会话，可使用 `amibaSessionStorage` 在该会话目录下按插件命名空间保存。

进程重启后的远端重连、恢复控制不是已有 jobs 的自动能力。没有实现重连核实前，历史记录标记中断，不能把旧句柄伪装成仍可控制的 live job。

## 接入验证

需要覆盖：并发执行互不影响；启动失败清理；启动前后取消；完成/取消竞争只结算一次；真实完成后才通知；所属会话隔离；卸载时清理；记录在重启后仍可查看。提供 preview 时，浏览器读取不能消费模型输出。

当前运行包的隔离 smoke 覆盖直接 jobs 生产者、官方 job_output 收取、持久通知和真实主进程重启。它不调用真实外部 Agent，不代表某个 Codex/Claude Code provider 已安装或验证完成。
