# DSH 官方插槽兼容维护台账

用于决定官方插槽应当**接入、补齐、保留还是退役**。本文件是项目唯一持续更新的插槽台账；版本升级和兼容代码变更应在同一 PR 更新这里。

[当前结论](#current) · [待办](#actions) · [目标版本插槽](#target) · [历史旧槽](#legacy) · [后续新增槽](#future) · [Amiba 私有槽](#private) · [维护规则](#maintenance) · [证据与记录](#evidence)

<a id="current"></a>

## 1. 当前结论

| 项目 | 结论 |
|---|---|
| 兼容目标 | **DSH `0.1.5-rc.2`** |
| 对照版本 | `0.1.5-rc.2`、`0.1.5-rc.3`、`0.1.7-alpha.2`；固定发布快照，不代表实时最新版或同一条升级线 |
| 入口覆盖 | 目标版本 61 项中，60 个可扩展槽均已接入；`root` 由宿主占用 |
| 行为兼容 | **尚不能认定全部完全兼容**；专项验证、待验收、条件支持和宿主限制见逐项表 |
| 已完成退役 | `conversation.details.tool` 及 3 个私有槽已在分支移除；迁移说明见第 6 节，尚未发布 |
| 后续新增槽 | 26 项不属于目标版本，暂不接入 |
| 实现基线 | 插槽接入 `4d2edf82`；退役清理 `5aca2b07` · [PR #97](https://github.com/iHeyTang/amiba/pull/97)；记录时尚未合并／发布 |
| 最近核验 | 2026-09-23；范围为 91 个官方历史名称及 28 个 Amiba 私有历史名称（25 个保留、3 个已退役） |

维护原则：rc.2 仍有效的槽继续维护，即使 alpha 分支已经移除；仅在后续版本新增的槽，等目标内核升级后重新评估。

<a id="actions"></a>

## 2. 当前待办

| 优先级 | 项目 | 应执行的动作 | 完成条件 |
|---|---|---|---|
| P1 | 输入区域、队列和附件 | 对下方目标版本表中“待专项验收”的真实插件补齐发送失败保留、普通文件、后台输入、Host 队列证据 | 修复确切缺口并逐行升级状态，不以入口数量关闭待办 |
| P1 | 条件支持项 | 在实际支持的桌面／独立 Web 条件下验证目录、工作台、文档、工具、授权与卸载 | 每行记录已测宿主；不支持的宿主列明回退 |
| P2 | 新增替换入口 | 补第三方整组件的会话切换、卸载、异常恢复及服务依赖验收 | 明确到插件／宿主／提交的证据，不宣称任意私有 API 通用兼容 |
| 暂缓 | 26 个后续版本新增名 | 保留存在性记录，不向 rc.2 引入实现 | 只有目标内核升级且新目标仍有效时，才转为接入任务 |

<a id="target"></a>

## 3. 目标版本插槽（61 项）

主表回答“官方还在不在、Amiba 支持到哪一步、接下来做什么”。每组下方可展开查看首次版本、接口契约、限制和证据。

三列版本分别保留，不将 RC 与 alpha 的差异解释为同一条线上的删除再恢复。**有／无只表示该名称是否在官方发布目录中，不表示契约相同。**

| Amiba 状态 | 含义 |
|---|---|
| 已接入·专项验证 | 指定测试通过；不代表全部第三方插件和宿主均通过 |
| 已接入·待专项验收 | 入口存在；还需补当前目标版本的插件行为验收 |
| 条件支持 | 依赖指定服务、视图或宿主；展开明细查看条件 |
| 已接入·宿主限制 | 已接入，但 Amiba 保留部分行为或呈现控制 |
| 宿主占用 | `root` 由 Amiba 持有，不计入可扩展入口覆盖率 |

明细中的“首次核验”是已查发布范围内最早找到的版本，**不等于已证明的引入版本**；“不晚于”表示更早版本未充分排查。`kind/scope` 记录 rc.2 的插槽类型和作用域。

通用验收要求：旧入口的静态审计不能代替完整插件、卸载和异常回退测试；默认替换优先级验证见 V1，组件私有依赖另验。各行明细只补充该槽的特定边界。

### 首页（4 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `conversation.hero.agentPreset`<br>首页智能体预设选择 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.hero.brand.mark`<br>首页品牌标识 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.hero.workspace`<br>首页工作区选择 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.hero.workspace.directoryFlow`<br>首页目录选择流 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |

<details>
<summary>首页：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `conversation.hero.agentPreset` | 不晚于 0.0.1-rc.3 | single/root | 读取获选 AgentPresetSeatInjected 的插件自有状态；忙碌／删除／卸载保护、提交版本消费。未公开的私有状态不能推断。V1、V2 升级注意：0.1.7-alpha.2 改为 single/session-maybe。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.hero.brand.mark` | 0.1.0-rc.8 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.hero.workspace` | 不晚于 0.0.1-rc.3 | single/root | 真实按钮锚点与 WorkspaceId → 路径；关闭、删除、原生异步返回保护。V2 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.hero.workspace.directoryFlow` | 不晚于 0.0.1-rc.3 | single/root | 依赖目录服务；桌面与独立 Web 的取消、不可用及回退需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 输入器与附件（10 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `conversation.composer`<br>完整输入区域替换 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.composer.bar`<br>输入器主体 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.composer.dock`<br>输入器下方附加区 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补输入验收 |
| `conversation.input.attachments`<br>附件呈现与拖放区域 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.input.dock`<br>输入框上方附加区 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补输入验收 |
| `conversation.input.left`<br>输入工具栏左侧 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补输入验收 |
| `conversation.input.model`<br>当前会话模型选择 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.input.overlay`<br>触发菜单与弹层 | 有 | 有 | 有 | 已接入·宿主限制 | 保留；补键盘验收 |
| `conversation.input.plan`<br>计划模式控件 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.input.right`<br>输入工具栏右侧 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补输入验收 |

<details>
<summary>输入器与附件：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `conversation.composer` | 不晚于 0.0.1-rc.3 | chain/session | 官方 pendingInteraction 选举；临时接管保留草稿 DOM，仅在有效会话派发。V1 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.composer.bar` | 不晚于 0.0.1-rc.3 | single/session-maybe | 首页／会话 owner 和标准输入接口；替换会卸载编辑器 DOM，package-private 注入操作另计。V1 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.composer.dock` | 不晚于 0.0.1-rc.3 | list/session | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.attachments` | 0.1.0-rc.8 | single/session-maybe | 首页／会话均派发真实草稿、文件上传及增删重试操作。V1 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.input.dock` | 不晚于 0.0.1-rc.3 | list/session | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.left` | 不晚于 0.0.1-rc.3 | list/session | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.model` | 不晚于 0.0.1-rc.3 | single/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.overlay` | 不晚于 0.0.1-rc.3 | list/session | slash-menu/command-popup 同 ID 使用原有低优先级 shadow；键盘仲裁与呈现由 Amiba 实现。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.plan` | 不晚于 0.0.1-rc.3 | single/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.right` | 不晚于 0.0.1-rc.3 | list/session | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 会话与消息（14 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `conversation.approval.detail`<br>审批工具详情 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.chat.assistant-actions`<br>完成回复后的操作 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.chat.commandview`<br>按命令名渲染结果 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.chat.node`<br>按聊天节点类型渲染 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.chat.turnTail`<br>回合尾部附加内容 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；验收 rc.2 |
| `conversation.message.images`<br>消息图片组 | 有 | 有 | 有 | 已接入·宿主限制 | 保留；补附件验收 |
| `conversation.session`<br>会话正文容器 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.session.header`<br>会话标题容器 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `conversation.session.header.actions`<br>标题旁操作 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.session.header.corner`<br>标题最右角控件 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.session.header.lineage`<br>会话祖先标题 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.session.header.utilities`<br>标题右侧工具 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `conversation.trajectory.images`<br>轨迹图片组 | 有 | 有 | 有 | 条件支持 | 保留 |
| `conversation.view`<br>会话视图 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；验收 rc.2 |

<details>
<summary>会话与消息：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `conversation.approval.detail` | 0.1.2-alpha.2 | single/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `conversation.chat.assistant-actions` | 不晚于 0.0.1-rc.3 | list/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.commandview` | 不晚于 0.0.1-rc.3 | keyed/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.node` | 不晚于 0.0.1-rc.3 | keyed/session | 有节点贡献时使用 rc.2 ChatView；共享 viewport、阅读位置及会话隔离；排版不同不保证文字行相同。V1、V3 [源码](plugins/dsh-plugin-ui-shell/src/client/official-chat-presentation.ts) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.turnTail` | 不晚于 0.0.1-rc.3 | chain/session | rc.2/rc.3 为 chain；alpha.2 为 list。升级至 alpha.2 时需调整契约。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.message.images` | 0.1.0-rc.8 | single/session | 整组图片及授权 loader；原默认占用 priority=-1，替换需更低值；无 durable ref 的乐观图片走原生瓦片。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.session` | 不晚于 0.0.1-rc.3 | single/session | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header` | 不晚于 0.0.1-rc.3 | single/session | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header.actions` | 不晚于 0.0.1-rc.3 | list/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header.corner` | 0.1.5-alpha.1 | single/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `conversation.session.header.lineage` | 0.1.1-rc.1 | single/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.1-rc.1/lib/client.js) |
| `conversation.session.header.utilities` | 不晚于 0.0.1-rc.3 | list/session | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.trajectory.images` | 0.1.2-alpha.2 | single/session | 仅在官方 trajectory 视图派发；不能当作主聊天图片入口。 [官方 rc.2 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-trajectory/src/client/index.ts) · [装配](bundles/dsh-bundle-amiba-web/cordis.patch.yml) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `conversation.view` | 不晚于 0.0.1-rc.3 | list/session | 以可选视图接入；viewRequest/openView/completeViewRequest 已传入。后续版本 owner 增量不可自动视为兼容。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 主布局与右栏（5 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `main`<br>按键选择主面板 | 有 | 有 | 有 | 已接入·宿主限制 | 保留限制 |
| `main.conversation`<br>主聊天入口 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `rightbar`<br>右侧栏整体 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `rightbar.session`<br>右侧栏会话正文 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `root`<br>应用根 | 有 | 有 | 有 | 宿主占用 | 保留宿主占用 |

<details>
<summary>主布局与右栏：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `main` | 0.1.5-alpha.2 | keyed/root | 第三方 key 可开全局面板；conversation 是原生聊天保留键，不能据同名注册替换聊天。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `main.conversation` | 0.1.5-alpha.2 | single/session-maybe | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `rightbar` | 0.1.5-alpha.1 | single/root | 按实际左栏占用计算；面板最低 300、中栏 400、上限 70%；默认布局与官方产品不同。V1、V3 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `rightbar.session` | 0.1.5-alpha.2 | single/session | 有效会话派发，切换会话重建，首页不派发；卸载恢复原工作台。V1、V3 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `root` | 不晚于 0.0.1-rc.3 | single/root | 应用根由 Amiba 持有，不计入普通可替换插槽覆盖率。 [根注册](plugins/dsh-plugin-ui-shell/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 设置（11 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `settings.action`<br>设置页头操作 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.close`<br>设置关闭按钮标签 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.general.item`<br>通用设置行 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.header`<br>设置标题 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.models.footer`<br>模型设置页脚 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.models.provider-card`<br>模型提供方卡片扩展 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.onboarding`<br>官方设置引导步骤 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.plugin.item`<br>旧版插件配置卡 | 有 | 有 | 无 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.plugins.tab`<br>插件设置标签页 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.section`<br>设置分区 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `settings.trigger`<br>设置启动按钮内容 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |

<details>
<summary>设置：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `settings.action` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.close` | 不晚于 0.0.1-rc.3 | single/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.general.item` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.header` | 不晚于 0.0.1-rc.3 | single/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.models.footer` | 0.1.2-alpha.2 | list/root | [源码](plugins/dsh-plugin-model-plane/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `settings.models.provider-card` | 0.1.2-alpha.2 | keyed/root | [源码](plugins/dsh-plugin-model-plane/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `settings.onboarding` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.plugin.item` | 不晚于 0.0.1-rc.3 | keyed/root | 开发线从 0.1.6-alpha.2 已无此名，但 rc.2/rc.3 仍保留，当前禁止因此退役。 [源码](plugins/dsh-plugin-runtime-inventory/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.plugins.tab` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-runtime-inventory/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.section` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.trigger` | 不晚于 0.0.1-rc.3 | single/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 侧栏与窗口（14 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `shell.overlay`<br>全局浮动层 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `sidebar`<br>完整侧栏 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `sidebar.brand.mark`<br>侧栏品牌图标 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `sidebar.brand.name`<br>侧栏品牌名称 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `sidebar.footer.action`<br>侧栏底部操作 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；补 rc.2 验收 |
| `sidebar.panellist`<br>全局面板导航图标 | 有 | 有 | 有 | 已接入·宿主限制 | 保留限制 |
| `sidebar.right.pane.tab`<br>右栏标签正文 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |
| `sidebar.right.pane.tab.title`<br>右栏动态标题 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |
| `sidebar.right.tab.document`<br>文档正文 renderer | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |
| `sidebar.right.tab.guide`<br>右栏引导页 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |
| `sidebar.right.tab.menu.item`<br>右栏标签菜单项 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |
| `sidebar.settings`<br>侧栏设置整体区域 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `sidebar.workspaces`<br>工作区/会话浏览区域 | 有 | 有 | 有 | 已接入·专项验证 | 保留 |
| `sidebar.workspaces.directoryFlow`<br>侧栏目录选择流 | 有 | 有 | 有 | 条件支持 | 保留；补宿主验收 |

<details>
<summary>侧栏与窗口：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `shell.overlay` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/dev/surfaces.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar` | 不晚于 0.0.1-rc.3 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.brand.mark` | 0.1.0-rc.8 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `sidebar.brand.name` | 0.1.0-rc.8 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `sidebar.footer.action` | 不晚于 0.0.1-rc.3 | list/root | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.panellist` | 0.1.5-alpha.2 | list/root | 面板导航已接入；conversation 保留键及原生导航布局由 Amiba 控制。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `sidebar.right.pane.tab` | 0.1.5-alpha.1 | keyed/session | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/sidebar-right/tab-info.ts) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.pane.tab.title` | 0.1.5-alpha.1 | keyed/session | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/sidebar-right/native-seat.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.tab.document` | 0.1.5-alpha.2 | keyed/session | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/document-preview/TextPreview.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `sidebar.right.tab.guide` | 0.1.5-alpha.1 | chain/session | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/sidebar-right/tabs/guide/GuideBody.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.tab.menu.item` | 0.1.5-alpha.1 | list/session | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/sidebar-right/native-seat.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.settings` | 不晚于 0.0.1-rc.3 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.workspaces` | 不晚于 0.0.1-rc.3 | single/root | 默认优先级 1；普通插件默认 0 可接管。V1；私有依赖另验。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.workspaces.directoryFlow` | 不晚于 0.0.1-rc.3 | single/root | 依赖目录服务；桌面与独立 Web 的取消、不可用及回退需分别验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

### 工具（3 项）

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `tool.call.images`<br>工具输出图片 | 有 | 有 | 有 | 条件支持 | 保留；补工具路径验收 |
| `tool.call.toolview`<br>按工具名渲染调用 | 有 | 有 | 有 | 已接入·待专项验收 | 保留；验收 rc.2 |
| `tool.view.cordis`<br>动态插件业务内容 | 有 | 有 | 有 | 条件支持 | 保留 |

<details>
<summary>工具：版本来源、契约与兼容明细</summary>

| 插槽 | 首次核验 | rc.2 kind/scope | 边界与证据 |
| --- | --- | --- | --- |
| `tool.call.images` | 0.1.3-alpha.2 | single/session | 依赖真实工具结果和授权 loader；外部打开工具、第三方整树接管路径需单独验收。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.3-alpha.2/lib/client.js) |
| `tool.call.toolview` | 不晚于 0.0.1-rc.3 | keyed/session | 按 wire name 分派 callId/block/openFile/loadImage/inspect，自有工具行参与呈现。alpha 的 useDisclosure 增量不算 rc.2 缺口。 [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `tool.view.cordis` | 不晚于 0.0.1-rc.3 | keyed/session | 由启用的 ui-cordis 工具视图派发，需匹配实际 activeRun／pluginRunId。 [官方 rc.2 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/extensions/ui-cordis/src/client/index.ts) · [装配](bundles/dsh-bundle-amiba-web/cordis.patch.yml) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

<a id="legacy"></a>

## 4. 历史旧槽（4 项）

这 4 个名称在三个对照版本中均不存在。保留记录用于防止重复接入；其中旧工具详情桥已在 `5aca2b07` 移除。

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `conversation`<br>旧对话整体区域 | 无 | 无 | 无 | 未找到同名派发 | 不恢复兼容 |
| `conversation.details.tool`<br>旧工具详情页 | 无 | 无 | 无 | 已退役（未发布） | 使用 `tool.call.toolview`；需适配契约 |
| `conversation.session.header.leading`<br>旧会话级头部导航 | 无 | 无 | 无 | 未接入 | 不恢复兼容 |
| `details`<br>旧详情区域 | 无 | 无 | 无 | 未找到同名派发 | 不恢复兼容 |

<details>
<summary>首次版本、生命周期与来源</summary>

| 插槽 | 已核验的版本历史 | 迁移说明／证据 |
| --- | --- | --- |
| `conversation` | 不晚于 0.0.1-rc.3；到 0.1.5-alpha.2 的目录已没有此名 | 不恢复兼容；采用目标版本现存入口。conversation 名称不要与 main 的 conversation key 混淆。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.details.tool` | 不晚于 0.0.1-rc.3；0.1.5-alpha.1 起的已核验开发线目录没有此名 | `5aca2b07` 已删除旧声明、派发、订阅、SDK owner 和旧详情面板；仓库未发现注册使用者。外部插件需适配 `tool.call.toolview` 的 owner 与工具行位置。[源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header.leading` | 0.1.6-alpha.2；到 0.1.7-alpha.1 已移除，已核验仅存续一个 alpha | 不接入旧名；后续目标升级再评估 conversation.header.leading（session → root，不能直接别名）。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `details` | 不晚于 0.0.1-rc.3；到 0.1.5-alpha.1 的目录已没有此名 | 不恢复兼容；采用目标版本现存入口。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

</details>

<a id="future"></a>

## 5. 后续版本新增槽（26 项）

这些名称出现在后续 alpha 发布中，rc.2 和 rc.3 均不存在。当前统一暂不接入；升级目标内核时再核对是否保留，以及 kind、scope、owner 是否变化。

| 插槽／用途 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议 |
| --- | --- | --- | --- | --- | --- |
| `conversation.header`<br>无会话也驻留的头部 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `conversation.header.leading`<br>头部全局导航 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `conversation.input.activity`<br>输入工具栏活动控件 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `conversation.input.permission`<br>输入栏权限控件 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `conversation.plan-review.actions`<br>计划评审操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `deliverables.file.actions`<br>产出文件操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `deliverables.review.file.actions`<br>评审文件操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.bundle.activation`<br>bundle 启用后引导 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.bundle.config`<br>bundle 配置 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.detail.actions`<br>插件详情操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.detail.badge`<br>插件详情徽标 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.detail.section`<br>插件详情附加区域 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.item`<br>官方插件配置页面 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `plugins.row.config`<br>bundle 单行插件配置 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `settings.launcher`<br>账户/设置启动入口 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `settings.models.sign-in`<br>模型账户登录入口 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `shell.leading`<br>隐藏侧栏后的窗口左上控件 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.chat.conversation`<br>右栏子会话聊天 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.right.tab.document.action`<br>按 renderer 的工具栏操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.right.tab.document.actions`<br>文件通用操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.right.tab.document.office.pdf`<br>Office 转换后 PDF 呈现 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.right.tab.document.unpreviewable`<br>不可预览文件操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.right.tab.guide.entry`<br>单个引导卡片 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.toggle.badge`<br>侧栏展开按钮徽标 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.workspaces.session.menu.item`<br>会话菜单 UI 行 | 无 | 无 | 有 | 未接入 | 暂不接入 |
| `sidebar.workspaces.session.row.action`<br>会话行悬停操作 | 无 | 无 | 有 | 未接入 | 暂不接入 |

<details>
<summary>首次版本、生命周期与来源</summary>

| 插槽 | 已核验的版本历史 | 迁移说明／证据 |
| --- | --- | --- |
| `conversation.header` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.header.leading` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.input.activity` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.input.permission` | 0.1.6-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.1/lib/client.js) |
| `conversation.plan-review.actions` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `deliverables.file.actions` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `deliverables.review.file.actions` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.bundle.activation` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.bundle.config` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `plugins.detail.actions` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.detail.badge` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.detail.section` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.item` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `plugins.row.config` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `settings.launcher` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `settings.models.sign-in` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `shell.leading` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.chat.conversation` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.right.tab.document.action` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.document.actions` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.document.office.pdf` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.right.tab.document.unpreviewable` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.guide.entry` | 0.1.6-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.1/lib/client.js) |
| `sidebar.toggle.badge` | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.workspaces.session.menu.item` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.workspaces.session.row.action` | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |

</details>

<a id="private"></a>

## 6. Amiba 私有槽（25 项保留，3 项已退役）

私有槽不计入官方覆盖率。官方无同名不是退役理由；保留项修改时须验证注册、卸载和宿主行为，与官方能力重叠时先明确迁移方案。

保留项仅核实源码引用，专项运行验收待补。以下 3 项已移除；保留历史行用于追溯，不计入当前可用私有槽。

### 已退役（3 项，尚未发布）

| 私有插槽 | 状态 | 迁移方向 |
|---|---|---|
| `amiba.conversation.progress` | `5aca2b07` 已移除声明和派发 | 会话继续使用原生进度提示；无同语义官方槽可直接改名替换 |
| `amiba.tool.activity` | `5aca2b07` 已移除声明和派发 | 工具附加状态并入 `tool.call.toolview` 的对应工具展示 |
| `amiba.tool.execution` | `5aca2b07` 已移除声明及工具行包装 | 按工具 wire name 注册 `tool.call.toolview`；旧 `fallback` 包装参数不再提供 |

### 本次退役记录（含 1 个官方旧名）

- **最后保留代码**：`09656bd6`；对应已发布 Amiba 版本尚未核验，不将分支提交冒充发行版本。
- **移除提交**：`5aca2b07`。4 个旧名称均已从运行时声明、派发和相关 SDK 类型中移除；旧详情面板及其专属测试删除。
- **使用者核验**：仓库代码未发现这 4 项的注册使用者，后台任务插件测试也确认不注册旧执行／进度槽；未能核验外部已安装插件。仍使用旧名称的外部插件需迁移，不再兼容。
- **迁移说明**：[SDK 工具展示说明](packages/extension-sdk/README.md)。`conversation.details.tool` 的旧详情页改为工具调用行，需适配 `ToolCallToolviewOwnerProps`，不能仅改名称。
- **回归证据 V6**：UI Shell 72 项、工具行／消息／会话 UI 110 项、后台任务 7 项，共 189 项通过；SDK 类型与契约检查、UI Shell 生产 TypeScript 检查通过。未进行外部旧插件或安装包端到端验收。
- **发布状态**：原 PR #97 内，尚未合并／发布。发布时补充首个不再支持旧名称的 Amiba 版本。

### 继续保留（25 项）

| 私有插槽 | 源码证据 | 维护建议 |
| --- | --- | --- |
| `amiba.agentPreset.section` | [源码](plugins/dsh-plugin-agent-preset/src/client/index.tsx) | 保留产品能力 |
| `amiba.chat.content.overlay` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.composer.modelPicker` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.connection.access` | [源码](plugins/dsh-plugin-connector-core/src/client/index.tsx) | 保留产品能力 |
| `amiba.conversation.notice` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.conversation.question` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.emptyState.visual` | [源码](plugins/dsh-plugin-ui-shell/src/client/surface-provider.tsx) | 保留产品能力 |
| `amiba.filePreview.renderer` | [源码](plugins/dsh-plugin-file-preview/src/client/index.tsx) | 保留产品能力 |
| `amiba.markdown.extension` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.message.source` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.models.extension` | [源码](plugins/dsh-plugin-model-plane/src/client/index.tsx) | 保留产品能力 |
| `amiba.navigation.after` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.navigation.before` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.onboarding.companion` | [源码](plugins/dsh-plugin-onboarding/src/client/Guide.tsx) | 保留产品能力 |
| `amiba.onboarding.step` | [源码](plugins/dsh-plugin-onboarding/src/client/Guide.tsx) | 保留产品能力 |
| `amiba.session.observer` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.sessions.item.menu` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.sessions.list.group` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.settings.content.overlay` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.workbench.panel` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.workbench.shell` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.workbench.summary` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.workbench.view` | [源码](plugins/dsh-plugin-ui-shell/src/client/index.tsx) | 保留产品能力 |
| `amiba.workspace.navigation` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |
| `amiba.workspace.view` | [源码](plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) | 保留产品能力 |

<a id="maintenance"></a>

## 7. 如何维护这份台账

修改 DSH 依赖、SlotMap、派发入口或兼容桥的 PR 作者负责更新；评审者核查证据及退役条件。直接更新对应行，不另建日期或版本命名的当前状态报告。

1. **固定版本**：记录精确版本、发布线、发布产物 URL／integrity 和对应源码 tag／commit。不要把会移动的 latest、next 或 main 当唯一依据；保留已有版本列，新增对照列时说明范围。
2. **比对契约**：逐行核对名称、kind、scope、owner、公共注入、数据来源和生命周期。查清首次出现、目标版本是否仍在及中间是否移除；明确同线变化还是分支差异。
3. **核对 Amiba**：查声明、实际 renderSlot/renderSlotChain、默认占用、注册使用者、相关服务和 fallback。只有类型声明不算接入；没有同名不等于同类功能也没有。
4. **逐行决策**：目标版本有效且未接入 → 接入；已有入口但有缺口 → 补齐；目标无效且仍有旧桥 → 迁移后退役；后续版本才有 → 暂不接入。历史行不删除，改状态并保留替代方向。
5. **验收后更新**：记录实现提交、测试文件／命令、真实插件和宿主范围、失败与未测项。single/list/keyed/chain 的接管、卸载、异常回退及 session 切换分别核验。维护 PR 不能仅改百分比。
6. **合并与发布**：将文首实现基线换成合并提交；发布后补 Amiba 版本。未发布前不要把分支能力写成已发布能力。评审同时检查 README 入口、本表、代码和测试是否一致。

新增一行至少填写：名称／用途、首次核验版本、各固定版本存在性、目标 kind/scope、Amiba 支持程度、维护建议、限制、代码与测试证据。退役还须填写最后支持版本、替代入口、使用者迁移、移除提交。证据失效时先降级为“待核验”，不要沿用旧的“已验证”。

“准备退役”只表示决策；使用者迁移、代码移除和回归通过后才能填写“已退役”。证据不足时写“待核验”，不得推断成“无”或“已兼容”。

<a id="evidence"></a>

## 8. 证据与变更记录

<details>
<summary>官方发布目录、归档完整性与版本判断规则</summary>

存在性取自官方发布包中的插槽目录。官方发布版 runner 包中的目录是本次名称／kind／scope 来源；owner、公共注入及生命周期还需核对对应版本的声明和实现。不能只从本地安装包搜出字符串就断言“已支持”。

| 固定发布版本 | 目录 | 发布归档完整性（npm integrity，记录于 2026-09-23） |
|---|---|---|
| `0.1.5-rc.2` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.5-rc.2.tgz) | `sha512-RFzivtNX2Zx5wTR+9XnawzoxDViti44QoGEamhLP5+Jc0X8BMPVemYB9755UL3YRqgASNQ2x0IrJgBoc813jAg==` |
| `0.1.5-rc.3` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.3/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.5-rc.3.tgz) | `sha512-u1aBmmY634WYdM5j/vCnwSe08m5Yu4aOadOcEpakXl2rYgkE0gqWUMpH9rbCn++Nk8xnmFn5lU8vlQzSOIVl2Q==` |
| `0.1.7-alpha.2` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.2/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.7-alpha.2.tgz) | `sha512-BaoeDGAALyYgAOtfF6b7DZBPsPnJXfYwvuUdhnsEMv8XPcLaRBLCwHRJyVoDrnsniiPELbkpPaB0/8S/KSHDEg==` |

历史首次出现／移除仅代表已核验发布范围；RC 与 alpha 可能分叉。“alpha 移除、RC 仍有”不自动表示同一条线先删除又加回。需要确认真正的重新引入时，记录同一发布线的相邻版本证据。



</details>

### 验证依据

| 证据编号 | 范围与可复跑入口 | 已确认／未确认 |
|---|---|---|
| V1 | [真实 rc.2 renderer 替换测试](plugins/dsh-plugin-ui-shell/src/client/official-replacements.test.tsx)、[composer 交互选举](plugins/dsh-plugin-ui-shell/src/client/composer-region.test.tsx) | 默认优先级、owner、null、异常退让、卸载与草稿保留；不能替代全部插件端到端 |
| V2 | [预设状态](plugins/dsh-plugin-ui-shell/src/client/hero-preset.test.ts)、[获选预设读取](plugins/dsh-plugin-ui-shell/src/client/hero-preset-entry.test.ts)、[工作区 owner](plugins/dsh-plugin-ui-shell/src/client/hero-workspace.test.tsx)、[Home 交接](packages/ui/src/home/HomeView.test.tsx) | 选择准备、提交版本、错误保留、工作区锚点和取消；本地状态测试替代了 observable transport |
| V3 | [右栏尺寸](packages/ui/src/chat/__tests__/RightbarRegion.test.tsx)、[会话边界](packages/ui/src/chat/__tests__/FullScreenChatView.test.tsx)、[滚动交接](packages/ui/src/chat/__tests__/transcript-scroll-position.test.ts)、[滚动跟随](packages/ui/src/chat/__tests__/use-conversation-auto-scroll.test.tsx) | 实际几何、会话切换、阅读位置；不同排版不保证逐文字行定位 |
| V4 | [发布包控制器验证脚本](scripts/verify-rc2-preset-handoff.mjs) | 真实 rc.2 apply／预设控制器 → 私有暂存 → Amiba 读取 → 会话消费 → 默认恢复 → 卸载；远程／会话及 observable transport 为替身 |
| V5 | `pnpm runtime:prepare`、`pnpm runtime:verify`、`pnpm runtime:smoke` | 4d2edf82 对应代码的最终构建、完整性和运行时集成通过，DSH rc.2 / Node 22.22.0；不是三平台安装包或全部第三方浏览器验收 |
| V6 | [工具展示](plugins/dsh-plugin-ui-shell/src/client/official-toolviews.test.tsx)、[官方工具行入口](packages/ui/src/chat/__tests__/ToolCallToolviewSeat.test.tsx)、[消息渲染](packages/ui/src/chat/__tests__/MessageChrome.test.tsx)、[会话](packages/ui/src/chat/__tests__/FullScreenChatView.test.tsx)、[后台任务](plugins/dsh-plugin-background-jobs/src/client/activity.test.tsx) | `5aca2b07` 退役后相关 189 项通过；SDK 类型及 UI Shell 生产 TypeScript 通过。运行 Node 22.17.0，有低于仓库要求的 engine 警告；未重跑运行时打包或外部插件端到端 |

实现基线 `4d2edf82` 的相关 UI 58 项、renderer／SlotCore／数据源 31 项，共 89 项通过；生产 TypeScript、V4、V5 通过。已有全量 UI-shell／架构检查基线失败并未标为全绿。入口覆盖、专项测试、完整插件、安装包、发布是不同证据层级。

复跑预设发布包验证：

```sh
pnpm --filter @amiba/dsh-plugin-ui-shell build
node scripts/verify-rc2-preset-handoff.mjs
```

<details>
<summary>变更记录与历史材料</summary>

| 日期 | 依据 | 对台账的影响 |
|---|---|---|
| 2026-09-23 | a3560301 历史审计、官方三版发布目录 | 形成 91 个官方历史名称及 28 个私有槽的比较范围 |
| 2026-09-23 | 3e125b2b、2185bfd8、1d444b5e、91eb6b23 | rc.2 内核升级及 17 个新增入口，目标可扩展入口 60/60 |
| 2026-09-23 | ac9018a9、4d2edf82，PR #97 | 修正优先级、预设业务交接、工作区异步边界、聊天滚动和右栏几何，补发布包验证 |
| 2026-09-23 | 本文件入库，沿用 PR #97 | 统一根目录台账；按结论、待办、功能分组及可展开证据维护，停止维护版本化临时台账 |
| 2026-09-23 | `5aca2b07` | 退役官方旧名 `conversation.details.tool` 和 3 个私有槽；保留迁移、使用者范围和 V6 回归证据 |

`dsh-rc2-slot-coverage.md` 仅保留迁移入口，原重复 JSON 已移除（历史可从 Git 查找）。早期 `dsh-extension-*`、`dsh-main-sync-*` 和升级审计文档保留其历史／服务设计内容，其中插槽当前状态以本文件为准。会话附件中的日期报告不再作为项目维护依据。本文件不依赖 `/tmp`、个人目录或会话附件才能阅读和复核。

</details>
