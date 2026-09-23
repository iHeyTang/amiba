# DSH 0.1.5-rc.2 升级与插槽覆盖

目标版本固定为 `0.1.5-rc.2`，包括工作区依赖、托管运行时、插件发行清单和锁文件。后续 RC／alpha 不作为本次实现契约。

| 统计口径 | 升级前 a3560301 | 本分支 |
|---|---:|---:|
| rc.2 官方插槽（含 root） | 61 | 61 |
| 有实际派发，包含部分／条件支持 | 43（70.5%） | 60（98.4%） |
| 未接入／仅声明 | 17 | 0 |
| root 宿主占用，单独统计 | 1 | 1 |

这是入口覆盖率，不是完美兼容率。原有部分／条件支持不会因升级自动变成完全兼容。Amiba 私有槽、历史废弃名称、alpha 新增槽和工厂入口不计入。

## 新入口的运行规则

- 本次新增的 15 个 single 槽默认界面使用 priority=1；普通插件不写 priority（官方默认 0）即可接管。原有图片／触发菜单的同 cell shadow 规则单独保留，不能套用到所有新入口。
- 插件返回 null 表示有意不显示。卸载或渲染异常退让后恢复默认界面。
- 严格 session 槽在首页不派发；main.conversation 和附件使用 session-maybe。
- 附件入口传递实际浏览器草稿（含文件）、上传状态和添加／删除／重试动作，覆盖首页与会话输入框。
- 整块替换会卸载该块原组件；不是透明装饰器。侧栏保留 Amiba 的完全收起模式，没有另行实现官方紧凑栏。

## 输入器接管的兼容边界

- `conversation.composer` 使用官方 `useSessionPendingInteraction` 的会话级选举结果和真实 Session 快照。通过 `overlay: true` 保留原输入器挂载；交互结束、插件卸载后恢复草稿。仅在有效会话派发，拒绝导航期间不匹配的快照。
- `conversation.composer.bar` 覆盖首页与会话输入器，传递实际 `variant`、`disabled`、`placeholder`。Amiba 没有官方首页“必须先选工作区”的禁用模式，因此不虚构 `blocked` 或 `workspacePickerOpen`；本地工作区控件留在原输入器中。
- bar 插件替换的是整块界面，会卸载原编辑器 DOM。Composer 层的输入动作／附件服务和上层草稿保留，第三方插件仍需实现自己的编辑界面；这不等于原官方 ComposerBar 的私有注入操作可以无改动复用。
- 实际 rc.2 renderer 的 chain 测试验证临时接管期间草稿 DOM 不变、选举撤销／卸载后恢复；数据源测试覆盖交互更新、会话切换和订阅释放。

## 最后 5 项的实现与兼容边界

60 个可扩展插槽均已有入口（60/60）；以原先含 root 的 61 项口径计算为 98.4%。root 仍由宿主占用，不作为普通可替换入口。没有剩余未接入项；这仍是入口覆盖，不是全部第三方插件无改动兼容率。

| 插槽 | 实现 | 使用建议与边界 |
|---|---|---|
| `conversation.chat.node` | 当有非默认节点注册生效时，聊天记录切换到发布版 rc.2 ChatView 和节点渲染器，使用真实节点、回合数据、附件及文件操作；卸载后恢复原消息视图 | 可使用。默认节点 priority=1，插件 priority=0 即可覆盖。切换的是整段聊天记录渲染方式，视觉仍采用官方渲染器；共用滚动容器，切入时交接阅读位置，退出时按实际位置恢复跟随，输入器保留。不同排版的同一像素位置不保证对应同一文字行。不是把 Amiba 消息行伪装成官方节点 |
| `conversation.hero.agentPreset` | 发送前读取当前获选插件声明的 `AgentPresetSeatInjected`，否则使用原选择器和 `ctx.heroAgentPreset` 的共享暂存状态；提交成功后按提交版本消费本地选择 | 建议接入。使用官方 `AgentPresetSeatInjected` 的插件可保留自己的 store，无须改接 Amiba 服务；忙碌、预设删除或读取时插件卸载均不会提交旧选择。完全未暴露该业务接口的私有状态不能由宿主猜测 |
| `conversation.hero.workspace` | 保留工作区触发按钮；选择器取得官方 selectedId/open/onPick/onClose，依据实时 workspace 列表把 ID 映射为真实路径并送入新会话 | 可使用。真实按钮 anchorRef 可定位菜单；旧回调按最新工作区列表检查，关闭后不再接受选择。原生回退避免 StrictMode 重复打开，卸载后忽略迟到结果 |
| `rightbar` | 在工作台外层派发，随窗口和左栏变化提供 width/viewportWidth/canShow；没有插件时保留原工作台结构 | 可使用。width/canShow 保留官方 300px 面板、400px 中栏、70% 宽度上限，按 Amiba 左栏实际占用计算，不再虚构左栏已收起。窄屏插件仍需处理自身的全屏呈现；默认工作台沿用 Amiba 布局 |
| `rightbar.session` | 会话级右栏内容接管，切换会话重建替换组件，首页不派发；卸载恢复原工作台 | 可使用。整块替换会卸载原呈现组件，替换插件应承担自己的右栏界面；不把原工作台的内部实现当成官方私有注入接口 |

官方 Chat 默认渲染器借用根入口已经拥有的图片／命令／回合尾部插槽，避免重复声明导致启动失败。Chat 业务投影与 `useChat` 来源仍保持单一，未重复注册。

`settings.plugin.item` 在 rc.2 中有效且已有使用者，继续保留；后续 alpha 移除不影响本次兼容。后续建议转向真实第三方插件端到端兼容验收，而不是继续添加不属于 rc.2 的名称。

## 行为兼容复核（2026-09-23）

| 已确认问题 | 本次修复 | 验证依据 |
|---|---|---|
| 新入口必须使用 Amiba 特定负优先级才能生效 | 15 个新增 single 默认占用退至 1，插件默认 0 可接管 | 发布版 rc.2 renderer 验证注册、owner、空输出、异常退让、卸载 |
| 插件独立的预设 store 未进入新会话参数 | 读取获选 root 注册的公开业务注入接口，并将 profileId 送入 queueChatPrompt | 真 SlotCore 的选举／卸载／异常退让，加 Home 提交参数测试 |
| 预设未加载、提交过程中改选或预设删除 | 发送前准备；只消费已提交的选择版本；错误保留草稿及附件并显示提示 | 默认加载、移除、读取失败、并发改选、拒绝提交测试 |
| 工作区弹层缺锚点、异步返回覆盖新界面 | 真实 anchorRef、最新工作区查找、关闭／卸载取消、原生对话框去重 | 菜单 owner 与 Home StrictMode／替换测试 |
| 聊天节点启用时重建滚动容器、双滚动控制器 | 共享 viewport，交接 rc.2 chatScroll，官方视图显示时暂停原跟随写入 | 真实 renderer 注入交接、阅读／跟随状态测试 |
| 右栏假定左栏会自动让位 | 基于真实左栏占用计算宽度及可展示性 | 窄屏、最小宽度、70% 上限、窗口变化测试 |

这些验证覆盖已列出的公共插槽行为；没有把单元测试写成“所有第三方插件端到端通过”。官方 `ComposerBarInjected` 在 rc.2 源码中明确属于 package-private，不能与 SlotMap 的 owner／标准 session props 混为一谈。整块 single 替换卸载原组件是替换语义，本身不等于兼容缺陷。Amiba 的外观和默认布局不要求与官方产品逐像素一致。

## 验证边界与追溯

- 15 个新增 single 入口使用实际 rc.2 React 渲染器测试默认优先级注册接管、owner 传递、返回 null、异常退让和卸载回退。
- UI 测试覆盖附件操作、禁用状态和原侧栏／输入布局。app-runtime 全量测试通过。
- UI-shell 全量套件与未修改的 rc.1 checkout 对照，失败用例集合一致；不将全量套件报告为通过。
- 三平台安装包、真实第三方插件端到端验收尚未完成；构建、启动及 CI 结果见本次 PR。
- 官方目录：[rc.2 发布产物](https://unpkg.com/@deepseek-ai/dsh-cordis-client-runner@0.1.5-rc.2/lib/client.js)。
- 新入口声明和默认占用：`plugins/dsh-plugin-ui-shell/src/client/official-replacements.tsx`；派发：同目录 `product-shell.tsx`。
- 实际页面边界：`packages/ui/src/chat/FullScreenChatView.tsx`、`Sidebar.tsx`、`Composer.tsx` 和 `home/HomeView.tsx`。
- 下表中的“已有入口，静态对齐”沿用升级前审计，并不等于已完成 rc.2 的全面兼容验收。后续应记录变更提交和验收范围。

## rc.2 全部插槽台账

| 插槽 | 用途 | 升级前 | 本分支状态 |
|---|---|---|---|
| `conversation.approval.detail` | 审批工具详情 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.chat.assistant-actions` | 完成回复后的操作 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.chat.commandview` | 按命令名渲染结果 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.chat.node` | 按聊天节点类型渲染 | 未接入 | 新增条件入口；插件启用时使用 rc.2 官方节点渲染链 |
| `conversation.chat.turnTail` | 回合尾部附加内容 | 部分兼容 | 部分兼容 |
| `conversation.composer` | 完整输入区域替换 | 未接入 | 新增实际入口；官方交互选举、草稿保留与会话隔离测试通过 |
| `conversation.composer.bar` | 输入器主体 | 未接入 | 新增实际入口；首页／会话输入器 owner 与回退测试通过，整块替换仍有兼容边界 |
| `conversation.composer.dock` | 输入器下方附加区 | 部分兼容 | 部分兼容 |
| `conversation.hero.agentPreset` | 首页智能体预设选择 | 未接入 | 公开业务注入状态自动接入新会话；本地暂存／失败／并发消费验证通过 |
| `conversation.hero.brand.mark` | 首页品牌标识 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `conversation.hero.workspace` | 首页工作区选择 | 未接入 | 真实按钮锚点及 WorkspaceId 映射；关闭／移除／异步返回保护验证通过 |
| `conversation.hero.workspace.directoryFlow` | 首页目录选择流 | 条件支持 | 条件支持 |
| `conversation.input.attachments` | 附件呈现与拖放区域 | 仅声明 | 新增实际入口；基础渲染测试通过 |
| `conversation.input.dock` | 输入框上方附加区 | 部分兼容 | 部分兼容 |
| `conversation.input.left` | 输入工具栏左侧 | 部分兼容 | 部分兼容 |
| `conversation.input.model` | 当前会话模型选择 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.input.overlay` | 触发菜单与弹层 | 部分兼容 | 部分兼容 |
| `conversation.input.plan` | 计划模式控件 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.input.right` | 输入工具栏右侧 | 部分兼容 | 部分兼容 |
| `conversation.message.images` | 消息图片组 | 部分兼容 | 部分兼容 |
| `conversation.session` | 会话正文容器 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `conversation.session.header` | 会话标题容器 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `conversation.session.header.actions` | 标题旁操作 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.session.header.corner` | 标题最右角控件 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.session.header.lineage` | 会话祖先标题 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.session.header.utilities` | 标题右侧工具 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `conversation.trajectory.images` | 轨迹图片组 | 条件支持 | 条件支持 |
| `conversation.view` | 会话视图 | 部分兼容 | 部分兼容 |
| `main` | 按键选择主面板 | 部分兼容 | 部分兼容 |
| `main.conversation` | 主聊天入口 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `rightbar` | 右侧栏整体 | 未接入 | 新增实际入口；窗口尺寸与替换生命周期测试通过 |
| `rightbar.session` | 右侧栏会话正文 | 未接入 | 新增实际入口；会话切换和首页不派发测试通过 |
| `root` | 应用根 | 宿主占用 | 宿主占用 |
| `settings.action` | 设置页头操作 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.close` | 设置关闭按钮标签 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.general.item` | 通用设置行 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.header` | 设置标题 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.models.footer` | 模型设置页脚 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.models.provider-card` | 模型提供方卡片扩展 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.onboarding` | 官方设置引导步骤 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.plugin.item` | 旧版插件配置卡 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.plugins.tab` | 插件设置标签页 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.section` | 设置分区 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `settings.trigger` | 设置启动按钮内容 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `shell.overlay` | 全局浮动层 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `sidebar` | 完整侧栏 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `sidebar.brand.mark` | 侧栏品牌图标 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `sidebar.brand.name` | 侧栏品牌名称 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `sidebar.footer.action` | 侧栏底部操作 | 已有入口，静态对齐 | 已有入口，静态对齐 |
| `sidebar.panellist` | 全局面板导航图标 | 部分兼容 | 部分兼容 |
| `sidebar.right.pane.tab` | 右栏标签正文 | 条件支持 | 条件支持 |
| `sidebar.right.pane.tab.title` | 右栏动态标题 | 条件支持 | 条件支持 |
| `sidebar.right.tab.document` | 文档正文 renderer | 条件支持 | 条件支持 |
| `sidebar.right.tab.guide` | 右栏引导页 | 条件支持 | 条件支持 |
| `sidebar.right.tab.menu.item` | 右栏标签菜单项 | 条件支持 | 条件支持 |
| `sidebar.settings` | 侧栏设置整体区域 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `sidebar.workspaces` | 工作区/会话浏览区域 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `sidebar.workspaces.directoryFlow` | 侧栏目录选择流 | 条件支持 | 条件支持 |
| `tool.call.images` | 工具输出图片 | 条件支持 | 条件支持 |
| `tool.call.toolview` | 按工具名渲染调用 | 部分兼容 | 部分兼容 |
| `tool.view.cordis` | 动态插件业务内容 | 条件支持 | 条件支持 |
