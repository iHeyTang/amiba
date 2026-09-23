# DSH 官方插槽兼容维护台账

本文件是 **Amiba 官方插槽同步、接入和退役决策的唯一维护入口**。更新现有行，不为每次升级另建一份当前状态文档。历史报告只保留取证用途；发生冲突时先核对代码和发布产物，再修订本文件。

快速定位：[目标版本 61 项](#目标版本插槽61-项) · [历史及后续 30 项](#非目标版本与历史旧名30-项) · [Amiba 私有槽](#amiba-私有扩展28-项) · [决策队列](#决策队列) · [升级维护流程](#每次升级或退役的更新流程)

## 维护基线

| 项目 | 当前记录 |
|---|---|
| Amiba 目标内核 | `0.1.5-rc.2` |
| 官方对照版本（固定快照，非实时 latest） | `0.1.5-rc.2` → `0.1.5-rc.3` → `0.1.7-alpha.2`；顺序仅用于比较，不表示同一条升级线 |
| 实现复核基线 | `4d2edf82`，[PR #97](https://github.com/iHeyTang/amiba/pull/97)；本次维护入库时尚未合并／发布 |
| 版本目录核验／最近维护日期 | 2026-09-23 |
| 维护责任 | 修改 DSH 依赖、SlotMap、派发入口或兼容桥的 PR 作者同步更新；评审者核查证据和退役条件 |
| 当前入口覆盖 | rc.2 有 61 个普通槽名，其中 root 为宿主占用；60/60 可扩展槽已有入口。不是 100% 行为兼容率 |
| 台账范围 | 91 个历史官方槽名（目标 61、非目标 30）；另列 28 个既有 Amiba 私有槽，不混入官方覆盖率 |

目前策略：目标版本有效的插槽应接入并维护；只在后续版本新增的暂不接入。不能因为 alpha 删除了 rc.2 仍有效的槽而提前删除。未来修改目标内核时，先更新本节，再重新决策每一行。

## 如何读表

- **有／无**：该精确发布版本的目录是否包含名称；不表示参数或行为兼容。`kind` 表示 single/list/keyed/chain，`scope` 表示 root/session/session-maybe。
- **首次核验**：历史发布包审计范围内首次找到该名称的版本，不把最早已查到的版本冒充绝对引入版本。“不晚于”表示更早版本尚未充分排查。
- **已接入·专项验证**：有真实派发且指定测试通过，仍不代表全部插件、宿主或私有依赖已验收。**已接入·待专项验收**：已有入口，不能升级为“完全兼容”。
- **条件支持／宿主限制**：有明确运行条件或宿主保留语义；条件和缺口在每行记录。**未接入**是实现状态；**暂不接入／准备退役**是维护决策，二者不可混用。
- **已退役**只能在调用方迁移、代码移除和回归通过后填写；官方目录无此名，不等于 Amiba 已删除旧桥。没有证据时写“待核验”，不得写“无”或“已兼容”。

## 目标版本插槽（61 项）

三列存在性分别固定为下列精确版本。每行的契约和 Amiba 结论均以 rc.2 为准；后续版本仅作升级预警。

| 插槽／用途 | 首次核验 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | rc.2 kind／scope | Amiba 支持程度 | 维护建议 | 兼容边界、证据及待办 |
|---|---|---|---|---|---|---|---|---|
| `conversation.approval.detail`<br>审批工具详情 | 0.1.2-alpha.2 | 有 | 有 | 有 | single/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `conversation.chat.assistant-actions`<br>完成回复后的操作 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.commandview`<br>按命令名渲染结果 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | keyed/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.node`<br>按聊天节点类型渲染 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | keyed/session | 已接入·专项验证 | 保留 | 有节点贡献时使用 rc.2 ChatView；共享 viewport、阅读位置及会话隔离；排版不同不保证文字行相同。V1、V3 [源码](../plugins/dsh-plugin-ui-shell/src/client/official-chat-presentation.ts) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.chat.turnTail`<br>回合尾部附加内容 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | chain/session | 已接入·待专项验收 | 保留；验收 rc.2 | rc.2/rc.3 为 chain；alpha.2 为 list。这是升级风险，不应记成 rc.2 的 kind 缺口。 升级注意：0.1.7-alpha.2 改为 list/session。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.composer`<br>完整输入区域替换 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | chain/session | 已接入·专项验证 | 保留 | 官方 pendingInteraction 选举；临时接管保留草稿 DOM，仅在有效会话派发。V1 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.composer.bar`<br>输入器主体 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/session-maybe | 已接入·专项验证 | 保留 | 首页／会话 owner 和标准输入接口；替换会卸载编辑器 DOM，package-private 注入操作另计。V1 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.composer.dock`<br>输入器下方附加区 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补输入验收 | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.hero.agentPreset`<br>首页智能体预设选择 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 读取获选 AgentPresetSeatInjected 的插件自有状态；忙碌／删除／卸载保护、提交版本消费。未公开的私有状态不能推断。V1、V2 升级注意：0.1.7-alpha.2 改为 single/session-maybe。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.hero.brand.mark`<br>首页品牌标识 | 0.1.0-rc.8 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.hero.workspace`<br>首页工作区选择 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 真实按钮锚点与 WorkspaceId → 路径；关闭、删除、原生异步返回保护。V2 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.hero.workspace.directoryFlow`<br>首页目录选择流 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 条件支持 | 保留；补宿主验收 | 依赖目录服务；桌面与独立 Web 的取消、不可用及回退需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.attachments`<br>附件呈现与拖放区域 | 0.1.0-rc.8 | 有 | 有 | 有 | single/session-maybe | 已接入·专项验证 | 保留 | 首页／会话均派发真实草稿、文件上传及增删重试操作。V1 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.input.dock`<br>输入框上方附加区 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补输入验收 | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.left`<br>输入工具栏左侧 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补输入验收 | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.model`<br>当前会话模型选择 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.overlay`<br>触发菜单与弹层 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·宿主限制 | 保留；补键盘验收 | slash-menu/command-popup 同 ID 使用原有低优先级 shadow；键盘仲裁与呈现由 Amiba 实现。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.plan`<br>计划模式控件 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.input.right`<br>输入工具栏右侧 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补输入验收 | InputRegion 派发真实 session/input；普通文件、原生／Host 队列及后台提交仍须按 rc.2 单独验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.message.images`<br>消息图片组 | 0.1.0-rc.8 | 有 | 有 | 有 | single/session | 已接入·宿主限制 | 保留；补附件验收 | 整组图片及授权 loader；原默认占用 priority=-1，替换需更低值；无 durable ref 的乐观图片走原生瓦片。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `conversation.session`<br>会话正文容器 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/session | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header`<br>会话标题容器 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/session | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header.actions`<br>标题旁操作 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.session.header.corner`<br>标题最右角控件 | 0.1.5-alpha.1 | 有 | 有 | 有 | single/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `conversation.session.header.lineage`<br>会话祖先标题 | 0.1.1-rc.1 | 有 | 有 | 有 | single/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.1-rc.1/lib/client.js) |
| `conversation.session.header.utilities`<br>标题右侧工具 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.trajectory.images`<br>轨迹图片组 | 0.1.2-alpha.2 | 有 | 有 | 有 | single/session | 条件支持 | 保留 | 仅在官方 trajectory 视图派发；不能当作主聊天图片入口。 [官方 rc.2 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-trajectory/src/client/index.ts) · [装配](../bundles/dsh-bundle-amiba-web/cordis.patch.yml) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `conversation.view`<br>会话视图 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/session | 已接入·待专项验收 | 保留；验收 rc.2 | 以可选视图接入；viewRequest/openView/completeViewRequest 已传入。后续版本 owner 增量不可自动视为兼容。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `main`<br>按键选择主面板 | 0.1.5-alpha.2 | 有 | 有 | 有 | keyed/root | 已接入·宿主限制 | 保留限制 | 第三方 key 可开全局面板；conversation 是原生聊天保留键，不能据同名注册替换聊天。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `main.conversation`<br>主聊天入口 | 0.1.5-alpha.2 | 有 | 有 | 有 | single/session-maybe | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `rightbar`<br>右侧栏整体 | 0.1.5-alpha.1 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 按实际左栏占用计算；面板最低 300、中栏 400、上限 70%；默认布局与官方产品不同。V1、V3 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `rightbar.session`<br>右侧栏会话正文 | 0.1.5-alpha.2 | 有 | 有 | 有 | single/session | 已接入·专项验证 | 保留 | 有效会话派发，切换会话重建，首页不派发；卸载恢复原工作台。V1、V3 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `root`<br>应用根 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 宿主占用 | 保留宿主占用 | 应用根由 Amiba 持有，不计入普通可替换插槽覆盖率。 [根注册](../plugins/dsh-plugin-ui-shell/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.action`<br>设置页头操作 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.close`<br>设置关闭按钮标签 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.general.item`<br>通用设置行 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.header`<br>设置标题 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.models.footer`<br>模型设置页脚 | 0.1.2-alpha.2 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-model-plane/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `settings.models.provider-card`<br>模型提供方卡片扩展 | 0.1.2-alpha.2 | 有 | 有 | 有 | keyed/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-model-plane/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.2/lib/client.js) |
| `settings.onboarding`<br>官方设置引导步骤 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.plugin.item`<br>旧版插件配置卡 | 不晚于 0.0.1-rc.3 | 有 | 有 | 无 | keyed/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 开发线从 0.1.6-alpha.2 已无此名，但 rc.2/rc.3 仍保留，当前禁止因此退役。 [源码](../plugins/dsh-plugin-runtime-inventory/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.plugins.tab`<br>插件设置标签页 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-runtime-inventory/src/client/index.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.section`<br>设置分区 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `settings.trigger`<br>设置启动按钮内容 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `shell.overlay`<br>全局浮动层 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/dev/surfaces.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar`<br>完整侧栏 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.brand.mark`<br>侧栏品牌图标 | 0.1.0-rc.8 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `sidebar.brand.name`<br>侧栏品牌名称 | 0.1.0-rc.8 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.0-rc.8/lib/client.js) |
| `sidebar.footer.action`<br>侧栏底部操作 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | list/root | 已接入·待专项验收 | 保留；补 rc.2 验收 | 已有入口；早期静态审计不能代替本目标版本的完整插件、卸载与错误回退验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.panellist`<br>全局面板导航图标 | 0.1.5-alpha.2 | 有 | 有 | 有 | list/root | 已接入·宿主限制 | 保留限制 | 面板导航已接入；conversation 保留键及原生导航布局由 Amiba 控制。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `sidebar.right.pane.tab`<br>右栏标签正文 | 0.1.5-alpha.1 | 有 | 有 | 有 | keyed/session | 条件支持 | 保留；补宿主验收 | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/sidebar-right/tab-info.ts) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.pane.tab.title`<br>右栏动态标题 | 0.1.5-alpha.1 | 有 | 有 | 有 | keyed/session | 条件支持 | 保留；补宿主验收 | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/sidebar-right/native-seat.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.tab.document`<br>文档正文 renderer | 0.1.5-alpha.2 | 有 | 有 | 有 | keyed/session | 条件支持 | 保留；补宿主验收 | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/document-preview/TextPreview.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.2/lib/client.js) |
| `sidebar.right.tab.guide`<br>右栏引导页 | 0.1.5-alpha.1 | 有 | 有 | 有 | chain/session | 条件支持 | 保留；补宿主验收 | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/sidebar-right/tabs/guide/GuideBody.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.right.tab.menu.item`<br>右栏标签菜单项 | 0.1.5-alpha.1 | 有 | 有 | 有 | list/session | 条件支持 | 保留；补宿主验收 | 依赖 Amiba 工作台及 sidebarRight/resources/tabInfo 适配服务；独立 Web、跨会话和卸载需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/sidebar-right/native-seat.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-alpha.1/lib/client.js) |
| `sidebar.settings`<br>侧栏设置整体区域 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.workspaces`<br>工作区/会话浏览区域 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 已接入·专项验证 | 保留 | 默认占用 priority=1，普通 priority=0 可接管；owner、空输出、异常退让及卸载已测。V1；组件私有依赖另验。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `sidebar.workspaces.directoryFlow`<br>侧栏目录选择流 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | single/root | 条件支持 | 保留；补宿主验收 | 依赖目录服务；桌面与独立 Web 的取消、不可用及回退需分别验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `tool.call.images`<br>工具输出图片 | 0.1.3-alpha.2 | 有 | 有 | 有 | single/session | 条件支持 | 保留；补工具路径验收 | 依赖真实工具结果和授权 loader；外部打开工具、第三方整树接管路径需单独验收。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.3-alpha.2/lib/client.js) |
| `tool.call.toolview`<br>按工具名渲染调用 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | keyed/session | 已接入·待专项验收 | 保留；验收 rc.2 | 按 wire name 分派 callId/block/openFile/loadImage/inspect，自有工具行参与呈现。alpha 的 useDisclosure 增量不算 rc.2 缺口。 [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `tool.view.cordis`<br>动态插件业务内容 | 不晚于 0.0.1-rc.3 | 有 | 有 | 有 | keyed/session | 条件支持 | 保留 | 由启用的 ui-cordis 工具视图派发，需匹配实际 activeRun／pluginRunId。 [官方 rc.2 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/extensions/ui-cordis/src/client/index.ts) · [装配](../bundles/dsh-bundle-amiba-web/cordis.patch.yml) · [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |

## 非目标版本与历史旧名（30 项）

这些行继续保留，以防以后重复引入短命接口或误删旧兼容。它们不计入 rc.2 覆盖率。

| 插槽／用途 | 首次核验及已确认生命周期 | 0.1.5-rc.2 | 0.1.5-rc.3 | 0.1.7-alpha.2 | Amiba 支持程度 | 维护建议及替代方向 |
|---|---|---|---|---|---|---|
| `conversation`<br>旧对话整体区域 | 不晚于 0.0.1-rc.3；到 0.1.5-alpha.2 的目录已没有此名 | 无 | 无 | 无 | 未找到同名派发 | 不恢复兼容；采用目标版本现存入口。conversation 名称不要与 main 的 conversation key 混淆。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.details.tool`<br>旧工具详情页 | 不晚于 0.0.1-rc.3；0.1.5-alpha.1 起的已核验开发线目录没有此名 | 无 | 无 | 无 | 旧兼容桥仍在 | 准备退役；迁移到 tool.call.toolview，清点注册方、派发和 SDK 类型后删除；当前未删除。[源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx) [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `conversation.header`<br>无会话也驻留的头部 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.header.leading`<br>头部全局导航 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.input.activity`<br>输入工具栏活动控件 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `conversation.input.permission`<br>输入栏权限控件 | 0.1.6-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.1/lib/client.js) |
| `conversation.plan-review.actions`<br>计划评审操作 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `conversation.session.header.leading`<br>旧会话级头部导航 | 0.1.6-alpha.2；到 0.1.7-alpha.1 已移除，已核验仅存续一个 alpha | 无 | 无 | 无 | 未接入 | 不接入旧名；后续目标升级再评估 conversation.header.leading（session → root，不能直接别名）。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `deliverables.file.actions`<br>产出文件操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `deliverables.review.file.actions`<br>评审文件操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `details`<br>旧详情区域 | 不晚于 0.0.1-rc.3；到 0.1.5-alpha.1 的目录已没有此名 | 无 | 无 | 无 | 未找到同名派发 | 不恢复兼容；采用目标版本现存入口。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.0.1-rc.3/lib/client.js) |
| `plugins.bundle.activation`<br>bundle 启用后引导 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.bundle.config`<br>bundle 配置 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `plugins.detail.actions`<br>插件详情操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.detail.badge`<br>插件详情徽标 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.detail.section`<br>插件详情附加区域 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `plugins.item`<br>官方插件配置页面 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `plugins.row.config`<br>bundle 单行插件配置 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `settings.launcher`<br>账户/设置启动入口 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `settings.models.sign-in`<br>模型账户登录入口 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `shell.leading`<br>隐藏侧栏后的窗口左上控件 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.chat.conversation`<br>右栏子会话聊天 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.right.tab.document.action`<br>按 renderer 的工具栏操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.document.actions`<br>文件通用操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.document.office.pdf`<br>Office 转换后 PDF 呈现 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.right.tab.document.unpreviewable`<br>不可预览文件操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.right.tab.guide.entry`<br>单个引导卡片 | 0.1.6-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.1/lib/client.js) |
| `sidebar.toggle.badge`<br>侧栏展开按钮徽标 | 0.1.6-alpha.2；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.6-alpha.2/lib/client.js) |
| `sidebar.workspaces.session.menu.item`<br>会话菜单 UI 行 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |
| `sidebar.workspaces.session.row.action`<br>会话行悬停操作 | 0.1.7-alpha.1；0.1.7-alpha.2 仍有此名 | 无 | 无 | 有 | 未接入 | 暂不接入；rc.2 没有此槽。未来目标升级时重新检查是否仍在、kind/scope/owner 是否变化。 [首次发布包](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.1/lib/client.js) |

## Amiba 私有扩展（28 项）

官方没有同名并非退役理由。以下来自既有私有槽清单，源码链接复核至本次实现基线；运行验收不能由有引用直接推断。每次增删私有槽仍应更新本节，避免把私有能力误算成官方覆盖。

| 私有插槽 | 当前证据 | 维护建议 |
|---|---|---|
| `amiba.agentPreset.section` | [源码](../plugins/dsh-plugin-agent-preset/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.chat.content.overlay` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.composer.modelPicker` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.connection.access` | [源码](../plugins/dsh-plugin-connector-core/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.conversation.notice` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.conversation.progress` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 退役候选；曾未发现内置注册使用者。先重新清点外部插件及调用方，不能仅凭仓库无使用者直接删除。 |
| `amiba.conversation.question` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.emptyState.visual` | [源码](../plugins/dsh-plugin-ui-shell/src/client/surface-provider.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.filePreview.renderer` | [源码](../plugins/dsh-plugin-file-preview/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.markdown.extension` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.message.source` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.models.extension` | [源码](../plugins/dsh-plugin-model-plane/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.navigation.after` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.navigation.before` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.onboarding.companion` | [源码](../plugins/dsh-plugin-onboarding/src/client/Guide.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.onboarding.step` | [源码](../plugins/dsh-plugin-onboarding/src/client/Guide.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.session.observer` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.sessions.item.menu` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.sessions.list.group` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.settings.content.overlay` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.tool.activity` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 退役候选；曾未发现内置注册使用者。先重新清点外部插件及调用方，不能仅凭仓库无使用者直接删除。 |
| `amiba.tool.execution` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 退役候选；曾未发现内置注册使用者。先重新清点外部插件及调用方，不能仅凭仓库无使用者直接删除。 |
| `amiba.workbench.panel` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.workbench.shell` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.workbench.summary` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.workbench.view` | [源码](../plugins/dsh-plugin-ui-shell/src/client/index.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.workspace.navigation` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |
| `amiba.workspace.view` | [源码](../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx)；专项运行验收待补 | 保留；产品专用能力。修改时验证注册、卸载及所属宿主；未来与官方重叠时先明确迁移方案。 |

## 决策队列

| 优先级 | 项目 | 应执行的动作 | 完成条件 |
|---|---|---|---|
| P1 | `conversation.details.tool` 旧桥 | 清点内置与已支持外部使用者，迁移到 `tool.call.toolview` 后删除声明／派发／SDK 旧类型 | 本表改为“已退役”，填移除提交及原功能回归证据；本次只整理文档，尚未删除代码 |
| P1 | 输入区域、队列和附件 | 对目标表中“待专项验收”的真实插件补齐发送失败保留、普通文件、后台输入、Host 队列证据 | 修复确切缺口并逐行升级状态，不以入口数量关闭待办 |
| P1 | 条件支持项 | 在实际支持的桌面／独立 Web 条件下验证目录、工作台、文档、工具、授权与卸载 | 每行记录已测宿主；不支持的宿主列明回退 |
| P2 | 新增替换入口 | 补第三方整组件的会话切换、卸载、异常恢复及服务依赖验收 | 明确到插件／宿主／提交的证据，不宣称任意私有 API 通用兼容 |
| P2 | 三个无内置消费端的私有槽 | 复查 `amiba.tool.execution`、`amiba.tool.activity`、`amiba.conversation.progress` 的实际用户与替代能力 | 再决定保留或进入弃用周期，不能直接标“无用” |
| 暂缓 | 26 个后续版本新增名 | 保留存在性记录，不向 rc.2 引入实现 | 只有目标内核升级且新目标仍有效时，才转为接入任务 |

## 可复核证据

### 官方目录

存在性来自官方发布包，不是臆造的官方说明书。官方发布版 runner 包中的目录是本次名称／kind／scope 来源；owner、公共注入及生命周期还需核对对应版本的声明和实现。不能只从本地安装包搜出字符串就断言“已支持”。

| 固定发布版本 | 目录 | 发布归档完整性（npm integrity，记录于 2026-09-23） |
|---|---|---|
| `0.1.5-rc.2` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.5-rc.2.tgz) | `sha512-RFzivtNX2Zx5wTR+9XnawzoxDViti44QoGEamhLP5+Jc0X8BMPVemYB9755UL3YRqgASNQ2x0IrJgBoc813jAg==` |
| `0.1.5-rc.3` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.3/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.5-rc.3.tgz) | `sha512-u1aBmmY634WYdM5j/vCnwSe08m5Yu4aOadOcEpakXl2rYgkE0gqWUMpH9rbCn++Nk8xnmFn5lU8vlQzSOIVl2Q==` |
| `0.1.7-alpha.2` | [发布目录](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.7-alpha.2/lib/client.js) · [tarball](https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.7-alpha.2.tgz) | `sha512-BaoeDGAALyYgAOtfF6b7DZBPsPnJXfYwvuUdhnsEMv8XPcLaRBLCwHRJyVoDrnsniiPELbkpPaB0/8S/KSHDEg==` |

历史首次出现／移除仅代表已核验发布范围；RC 与 alpha 可能分叉。“alpha 移除、RC 仍有”不自动表示同一条线先删除又加回。需要确认真正的重新引入时，记录同一发布线的相邻版本证据。

### 实现与验证

| 证据编号 | 范围与可复跑入口 | 已确认／未确认 |
|---|---|---|
| V1 | [真实 rc.2 renderer 替换测试](../plugins/dsh-plugin-ui-shell/src/client/official-replacements.test.tsx)、[composer 交互选举](../plugins/dsh-plugin-ui-shell/src/client/composer-region.test.tsx) | 默认优先级、owner、null、异常退让、卸载与草稿保留；不能替代全部插件端到端 |
| V2 | [预设状态](../plugins/dsh-plugin-ui-shell/src/client/hero-preset.test.ts)、[获选预设读取](../plugins/dsh-plugin-ui-shell/src/client/hero-preset-entry.test.ts)、[工作区 owner](../plugins/dsh-plugin-ui-shell/src/client/hero-workspace.test.tsx)、[Home 交接](../packages/ui/src/home/HomeView.test.tsx) | 选择准备、提交版本、错误保留、工作区锚点和取消；本地状态测试替代了 observable transport |
| V3 | [右栏尺寸](../packages/ui/src/chat/__tests__/RightbarRegion.test.tsx)、[会话边界](../packages/ui/src/chat/__tests__/FullScreenChatView.test.tsx)、[滚动交接](../packages/ui/src/chat/__tests__/transcript-scroll-position.test.ts)、[滚动跟随](../packages/ui/src/chat/__tests__/use-conversation-auto-scroll.test.tsx) | 实际几何、会话切换、阅读位置；不同排版不保证逐文字行定位 |
| V4 | [发布包控制器验证脚本](../scripts/verify-rc2-preset-handoff.mjs) | 真实 rc.2 apply／预设控制器 → 私有暂存 → Amiba 读取 → 会话消费 → 默认恢复 → 卸载；远程／会话及 observable transport 为替身 |
| V5 | `pnpm runtime:prepare`、`pnpm runtime:verify`、`pnpm runtime:smoke` | 4d2edf82 对应代码的最终构建、完整性和运行时集成通过，DSH rc.2 / Node 22.22.0；不是三平台安装包或全部第三方浏览器验收 |

本轮相关 UI 58 项、renderer／SlotCore／数据源 31 项，共 89 项通过；生产 TypeScript、V4、V5 通过。已有全量 UI-shell／架构检查基线失败并未标为全绿。入口覆盖、专项测试、完整插件、安装包、发布是不同证据层级。

复跑预设发布包验证：

```sh
pnpm --filter @amiba/dsh-plugin-ui-shell build
node scripts/verify-rc2-preset-handoff.mjs
```

## 每次升级或退役的更新流程

1. **固定版本**：记录精确版本、发布线、发布产物 URL／integrity 和对应源码 tag／commit。不要把会移动的 latest、next 或 main 当唯一依据；保留已有版本列，新增对照列时说明范围。
2. **比对契约**：逐行核对名称、kind、scope、owner、公共注入、数据来源和生命周期。查清首次出现、目标版本是否仍在及中间是否移除；明确同线变化还是分支差异。
3. **核对 Amiba**：查声明、实际 renderSlot/renderSlotChain、默认占用、注册使用者、相关服务和 fallback。只有类型声明不算接入；没有同名不等于同类功能也没有。
4. **逐行决策**：目标版本有效且未接入 → 接入；已有入口但有缺口 → 补齐；目标无效且仍有旧桥 → 迁移后退役；后续版本才有 → 暂不接入。历史行不删除，改状态并保留替代方向。
5. **验收后更新**：记录实现提交、测试文件／命令、真实插件和宿主范围、失败与未测项。single/list/keyed/chain 的接管、卸载、异常回退及 session 切换分别核验。维护 PR 不能仅改百分比。
6. **合并与发布**：将本节实现基线换成合并提交；发布后补 Amiba 版本。未发布前不要把分支能力写成已发布能力。评审同时检查 README 入口、本表、代码和测试是否一致。

新增一行至少填写：名称／用途、首次核验版本、各固定版本存在性、目标 kind/scope、Amiba 支持程度、维护建议、限制、代码与测试证据。退役还须填写最后支持版本、替代入口、使用者迁移、移除提交。证据失效时先降级为“待核验”，不要沿用旧的“已验证”。

## 变更记录与历史材料

| 日期 | 依据 | 对台账的影响 |
|---|---|---|
| 2026-09-23 | a3560301 历史审计、官方三版发布目录 | 形成 91 个官方历史名称及 28 个私有槽的比较范围 |
| 2026-09-23 | 3e125b2b、2185bfd8、1d444b5e、91eb6b23 | rc.2 内核升级及 17 个新增入口，目标可扩展入口 60/60 |
| 2026-09-23 | ac9018a9、4d2edf82，PR #97 | 修正优先级、预设业务交接、工作区异步边界、聊天滚动和右栏几何，补发布包验证 |
| 2026-09-23 | 本文件入库，沿用 PR #97 | 合并版本存在性、实施状态、退役候选与维护流程；停止维护版本化临时台账 |

`dsh-rc2-slot-coverage.md` 仅保留迁移入口，原重复 JSON 已移除（历史可从 Git 查找）。早期 `dsh-extension-*`、`dsh-main-sync-*` 和升级审计文档保留其历史／服务设计内容，其中插槽当前状态以本文件为准。会话附件中的日期报告不再作为项目维护依据。本文件不依赖 `/tmp`、个人目录或会话附件才能阅读和复核。
