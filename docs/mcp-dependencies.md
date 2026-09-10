# 插件 MCP 依赖契约

2026-09-07。实现入口：`dsh-plugin-mcp-manager` 的 `manager.dependencies`。底层仍由 DSH MCP Client 运行，不引入第二套 MCP 客户端。

## 所有权

- 服务定义由提供者注册：稳定 id、显示名、精确实现版本、是否允许共享。不同所有者不能覆盖相同服务；同一提供者的多个连接可以引用同一份定义。
- 连接由服务提供者登记：连接 id、显示名、账号/授权身份、私有运行配置。当前没有复制到 Manager 的持久化文件；真实凭据和开关仍由提供者自己的设置存储维护。
- 使用者只声明服务、支持版本、连接引用和共享策略，不传凭据或重新实现 MCP。运行实例和租约归统一 Manager 管理。
- 手工添加的 MCP 保留原管理入口；插件托管连接在独立只读分区展示，不能通过手工 MCP 编辑器覆盖。配置只有提供者一个写入入口。

## 开发接口

```ts
const deps = ctx.amibaMcpManager.dependencies;
const unregisterService = await deps.registerService(
  { id: "example-provider", name: "Example" },
  { id: "example.documents", name: "Documents", version: "1.2.3", shareable: true },
);
const unregisterConnection = await deps.registerConnection(
  { id: "example-provider", name: "Example" },
  {
    id: "account-reference", name: "Work", serviceId: "example.documents",
    identity: "tenant-and-authorization-reference",
    server: { transport: "stdio", command: "example-mcp",
      args: [], env: { TOKEN: privateToken }, enabled: true },
  },
);
// 消费插件从自身配置读取 connectionId，声明精确支持版本。
const lease = await deps.acquire({
  owner: { id: "knowledge-plugin", name: "Knowledge" },
  serviceId: "example.documents", version: "1.2.3",
  connectionId: "account-reference", sharing: "shared",
});
// acquire 是底层一次性租约；普通消费插件使用下面的作用域绑定。
// 配置提供者卸载时先注销连接，再注销服务。
```

消费插件可通过导出的 `useMcpDependency(ctx, request, activate)` 声明依赖。该接口由 Cordis 监听 Manager 的加载/卸载，由 `McpDependencyBinding` 监听服务与连接变化；只有依赖就绪才在新的插件作用域调用 `activate(featureCtx, lease)`。功能资源通过 `featureCtx.effect` 注册，依赖撤销或消费插件卸载时一并清理。它不依赖提供者与消费者的启动顺序。

产品插件优先使用 `useMcpRequirement(ctx, owner, requirement, activate)`：声明稳定需求 ID、名称、服务/版本及工具原名和可读能力说明。插件不预填账号引用；用户在 MCP 设置中的「插件访问授权」选择连接并批准。McpAccess 只在 `access.json` 保存需求指纹、连接引用和批准时的账号身份，不复制凭据。扩大工具需求、更新服务版本或更换账号需要新批准；停用一个插件保留其批准以便恢复，显式撤销才删除批准。Remote 提交包含查看时的批准标记，拒绝需求或账号变化后的过期页面提交。

正式插件批准的租约只能 `expose` 到目标 Agent 的 DSH 作用域，不能在普通宿主插件的全局 context 中发布。插件应在激活回调中安装其功能资源，并在目标 Agent 可用时将工具投影到该 Agent 的 context；不创建第二个工具执行引擎。

非 Cordis 使用者可使用 `dependencies.bind(request, signal)`，通过 `getState/subscribe` 展示 waiting、connecting、ready、error、disposed 状态，通过 `waitForReady(signal)` 等待必需依赖。启动失败不会定时无限重试；显式 `retry()` 或提供者变更会重新尝试。订阅者自己的异常不能阻断提供者更新。

这些接口用于已加载、受信任的宿主插件。owner id 是生命周期归属声明，不是对恶意插件的安全认证；宿主插件本来就能执行 Node 代码。低层声明也不是用户批准记录，产品插件应通过 `useMcpRequirement` 接入持久化授权。

依赖的官方 MCP Client 在隔离的 tools 服务中登记私有工具，不自动发布到全局。消费者声明所需原始工具名 `tools`（省略为空），在已注入 tools 的目标 DSH 作用域中调用 `lease.expose(ctx)`。投影保留官方 ToolRuntime 的执行与结果管线，增加输入校验和租约取消；作用域 mask 与单调 guard 防止其他全局使用者扩大该插件的工具范围。普通智能体通过需求的 `audience: "ordinary-agents"` 明确标识，也只发布批准的确切工具清单。释放租约撤销该使用方的投影，共用实例中其他租约仍可使用。

## 共享与版本

默认 isolated：每次申请独立实例。shared 必须同时获得服务定义许可，并使用同一 connectionId、同一服务版本。两个连接即使凭据相同也不按内容猜测合并；不同账号不能靠同名服务合并。使用者支持版本与定义必须精确相等，当前不做 semver 范围求解或自动升级。

共享是运行资源的复用，不是权限合并。提供者只有在服务没有跨消费者污染的会话/工作目录状态时才声明 shareable。飞书的固定 `preset.light` 使用同一个应用身份和固定工具集，明确选择共享；需要其他身份或配置时建立另一连接。

实例名由 Manager 内部生成，UI 展示服务/连接名称，不显示实例键。凭据、env、headers、底层错误正文不进入依赖列表。列表给出提供方、使用者、实例数及按需/使用中/启动失败状态。

## 生命周期与失败

登记连接不会启动 MCP。第一次 acquire 启动，后续 shared acquire 增加租约；最后一次 release 才关闭。release 可重复调用，并等待退出完成。注册、申请、更新与撤销串行执行，启动失败不保留使用者或半注册实例，允许重试。

required MCP 启动采用官方 failOnStartupError；acquire 失败时消费插件不能继续宣称依赖就绪。可选功能可在调用方捕获稳定错误码后展示不可用，不应吞掉错误后执行不完整流程。必需插件在 apply 阶段 await acquire 并让失败阻断挂载。

更新连接只有配置所有者可以执行。更新先中止现有 lease.signal、释放实例，再替换私有配置。绑定自动获取同一身份的新租约并重新安装功能。绑定在首次就绪后固定账号身份；同一连接引用更换身份会报 identity_mismatch，不自动继承授权。调用者也可从已批准的配置传入 identity，在首次启动之前就固定身份。插件作用域绑定在 Manager 重载后仍保留身份约束。注销连接或最后一个服务注册同样撤销全部相关租约，不删除业务配置。

进程重启不恢复旧内存租约：提供者从自己的持久化配置重建服务/连接，消费者重新声明需求，Manager 按已保存批准恢复绑定。暂缺提供者时绑定等待其登记。底层 acquire 仍然在缺失依赖时返回 unavailable；使用它的调用方自行承担生命周期。完整验收证据见 `mcp-completion-checklist.md`。

停用或 Cordis 重载后，保留的批准显示为「未运行 · 保留批准」，仍可逐项撤销。当前 DSH 插件清单是只读投影，Amiba 没有插件包卸载操作，不能将运行时 dispose 当作永久删除。永久删除使用方的宿主入口应调用 `access.forgetOwner(ownerId)`；这会删除该使用方的全部批准并撤销其活动绑定，不影响同连接的其他使用方。手动移除插件代码后，保留批准仍在授权页可见并可删除。

配置提供者通过 `connection.configuration: { ownerId, recordId }` 标识持久化配置归属，删除配置时调用 `forgetConfiguration`。connector-core 已接入此删除钩子，并在 Manager 重载时通过 `retainConfigurations(ownerId, async () => recordIds)` 核对持久化配置；清理过程中在批准队列内读取最新清单，避免对排队期间新增的批准使用过期快照。提供者自己的凭据仍只由提供者删除。

## 内置连接器

飞书声明固定版本 `lark.mcp` 及发布包 preset.light 的 10 项确切能力，钉钉声明固定版本 `dingtalk.mcp` 及 contacts/calendar/tasks 的 19 项能力。两者均包括写入操作，批准页面逐项展示；连接配置不再包含 `mcpEnabled` 或 `enableTools`。机器人收发消息继续使用各自 SDK。

connector-core 通过 `provideMcpConnection` 声明服务、连接和普通智能体需求；Cordis 监听 Manager 晚加载及重载。声明连接不启动 MCP，批准某一使用方后才申请租约。普通智能体需求固定在所属连接，插件需求可选择兼容连接；两者不互相授予权限。

飞书账号身份由 domain + appId 确定，钉钉由 clientId 确定。凭据轮换保留身份，更换应用身份必须重新批准。改名和默认预设更新保留 SDK 监听及 MCP 租约，并原地同步名称；私有配置改变则先撤销旧运行状态再重建。用户未正式发布，不实现旧字段迁移。CLI/Skills 仍是独立能力路径，不属于 MCP 授权。

## 验证

覆盖按需启动、两个消费者共享、默认隔离、不同连接隔离、版本不符、跨所有者修改拒绝、凭据更新撤销旧租约、注销/重新注册、失败重试、最终释放失败重试。UI 检查可读能力、逐插件批准和撤销、保留批准及连接停用/删除影响；打包更新必须验证实际内置运行包。

`useMcpRequirement` 另外报告功能安装状态：连接就绪后安装中的功能显示处理中，`activate` 失败时清理该次功能作用域，界面显示「插件功能启动失败」。`retryAccess` 只重试已有批准的依赖及功能安装，不增加授权，也不重启同一连接上的其他使用方。底层异常正文不会进入界面或批准文件。批准保留，用户仍可撤销；功能状态不持久化，重载后重新安装。

`dependency-runtime.test.ts` 使用真实官方 DSH MCP Client 和本地 stdio MCP 测试进程验证共用进程、独立释放、凭据更新与连接重建后的实际工具调用。`plugin-dependency.test.ts` 使用真实 Cordis 插件作用域验证晚加载、Manager 重载、消费插件卸载及功能资源清理。测试不连接真实飞书账号。
