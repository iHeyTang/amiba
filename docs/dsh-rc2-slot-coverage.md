# DSH 0.1.5-rc.2 升级与插槽覆盖

目标版本固定为 `0.1.5-rc.2`，包括工作区依赖、托管运行时、插件发行清单和锁文件。后续 RC／alpha 不作为本次实现契约。

| 统计口径 | 升级前 a3560301 | 本分支 |
|---|---:|---:|
| rc.2 官方普通插槽 | 61 | 61 |
| 有实际派发，包含部分／条件支持 | 43（70.5%） | 53（86.9%） |
| 未接入／仅声明 | 17 | 7 |
| root 宿主占用，单独统计 | 1 | 1 |

这是入口覆盖率，不是完美兼容率。原有部分／条件支持不会因升级自动变成完全兼容。Amiba 私有槽、历史废弃名称、alpha 新增槽和工厂入口不计入。

## 新入口的运行规则

- 默认界面作为 priority=-1 的占用组件；插件用更小的优先级（如 -2）接管，沿用现有图片槽的规则。
- 插件返回 null 表示有意不显示。卸载或渲染异常退让后恢复默认界面。
- 严格 session 槽在首页不派发；main.conversation 和附件使用 session-maybe。
- 附件入口传递实际浏览器草稿（含文件）、上传状态和添加／删除／重试动作，覆盖首页与会话输入框。
- 整块替换会卸载该块原组件；不是透明装饰器。侧栏保留 Amiba 的完全收起模式，没有另行实现官方紧凑栏。

## 未接入的 7 项

| 插槽 | 仍需补齐的工作 |
|---|---|
| conversation.chat.node | 官方 Chat 节点与 Amiba 消息投影逐类对齐，不能把消息行冒充节点 |
| conversation.composer | pendingInteraction、chain 选举与草稿生命周期 |
| conversation.composer.bar | 统一输入状态、文件服务及工作区／禁用语义 |
| conversation.hero.agentPreset | 首页预设暂存与官方服务同步 |
| conversation.hero.workspace | 本地目录与官方 WorkspaceId 选择映射 |
| rightbar | 官方宽度／全屏／打开条件与工作台协调 |
| rightbar.session | 会话级右栏状态与工作台生命周期 |

这些都仍在 rc.2 中，后续应继续接入。`settings.plugin.item` 在 rc.2 中有效且已有使用者，本次保留；后续 alpha 移除不影响本次兼容。

## 验证边界与追溯

- 10 个新增入口使用实际 rc.2 React 渲染器测试注册接管、owner 传递、返回 null、异常退让和卸载回退。
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
| `conversation.chat.node` | 按聊天节点类型渲染 | 未接入 | 未接入 |
| `conversation.chat.turnTail` | 回合尾部附加内容 | 部分兼容 | 部分兼容 |
| `conversation.composer` | 完整输入区域替换 | 未接入 | 未接入 |
| `conversation.composer.bar` | 输入器主体 | 未接入 | 未接入 |
| `conversation.composer.dock` | 输入器下方附加区 | 部分兼容 | 部分兼容 |
| `conversation.hero.agentPreset` | 首页智能体预设选择 | 未接入 | 未接入 |
| `conversation.hero.brand.mark` | 首页品牌标识 | 未接入 | 新增实际入口；基础渲染测试通过 |
| `conversation.hero.workspace` | 首页工作区选择 | 未接入 | 未接入 |
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
| `rightbar` | 右侧栏整体 | 未接入 | 未接入 |
| `rightbar.session` | 右侧栏会话正文 | 未接入 | 未接入 |
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
