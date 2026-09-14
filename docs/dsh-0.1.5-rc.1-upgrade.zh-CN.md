# DSH 0.1.5-rc.1 升级迁移记录

基线：PR #16 已合并，main 提交 `092d11c07b578911eb0e165e0869b1c94a0606e6`。目标是 npm 实际发布的 `@deepseek-ai/dsh@0.1.5-rc.1`，不是固定源码 c291e796，也不是 next 的 rc.2。

## 当前状态：运行时已通过集成检查，PR 仍待完整验收

依赖、安装锁和运行时补丁已迁移至 0.1.5-rc.1，旧客户端 runtime 依赖已移除。完整运行时准备和集成 smoke 已通过，包含官方附件上传、会话隔离、消息持久化和后台任务重启恢复。桌面已实际启动，并验证官方附件草稿上传和发送凭证。

附件方案已按用户决定简化：整个 `amiba-attachments` 插件退役，不迁移旧数据，不内置 PDF 提取工具。具体范围见 [附件退役说明](attachment-plugin-retirement.zh-CN.md)。

这不代表升级 PR 的所有检查已通过；当前仍需完整 CI 和剩余桌面场景验收，不可自动合并。

## 已核实的发布差异

| 部分 | 发布包证据 | 迁移要求 |
| --- | --- | --- |
| 原客户端运行时 | `@deepseek-ai/dsh-client-runtime` 没有 0.1.5-rc.1 发布版本；最新 next 仍是 0.1.1-rc.2 | 不能批量给所有包替换版本号；必须移除旧运行时依赖并转到独立服务 |
| 客户端 Context | 新客户端包向 `@deepseek-ai/cordis` 的 Context 合并服务声明 | 将原 ClientContext 引用改到官方 Context；消除旧 runtime 的冲突声明 |
| Session 服务 | 新 `dsh-api-session-controller/client` 提供 ISessions、SessionFace、SessionListState | 更新会话绑定、标准 props 供给和插件依赖装配 |
| Workspace 服务 | 新 `dsh-api-workspace-controller/client` 持有工作区服务 | 迁移工作区列表和选择桥接 |
| Store | `dsh-client-store` 提供 defineStore、EngineStoreHandle、ObservableSnapshot | 更换状态存储的导入与浏览器模块外部依赖 |
| 设置 | SettingsScope 来自 `dsh-client-ui-settings/client`；`dsh-api-settings-controller` 只有 Host/Remote 出口，没有 client 出口 | 区分设置领域 Remote 与界面作用域，不能用同名猜测替代路径 |
| Conversation | 新 ConversationSnapshot 只有 views、activeTargets，Session 生命周期独立；旧 nodes/runningCalls 不能直接读取 | 更新命令行、工具详情、回合尾部和聊天数据投影 |
| 文件和输入 | 新附件 owner 使用 onAddFiles/onRemoveAttachment/uploads；图片提交需要 type:image，命令和触发器契约也有变化 | 保留 Amiba 原输入交互，按新版真实协议连接，不能通过类型断言掩盖差异 |
| 插槽渲染 | 新 renderer 采用 scope adapter / standard source binding | 原 ctx.sessions.provide 等接线需要迁移到新版机制 |
| 补丁 | 旧的 0.1.1-rc.2 补丁不能直接应用到新版；Cordis HMR 依赖也由 1.0.16 变化为 ^1.0.17 | 逐项确认上游已覆盖的内容、仍需的 Amiba 修正及真实打包位置 |

## 已验证与剩余验证

- 管理运行时完整 smoke 通过：官方文件上传与跨会话凭证隔离、消息持久化、资源、插件卸载、后台任务重启恢复。
- 附件相关运行时 51 项、UI 12 项测试通过；运行时及桌面生产类型检查、插件构建、架构检查通过。
- 实际 Electron 启动与官方附件上传成功；输入框实际选择文件可显示附件。补齐新版严格会话槽空会话处理，避免首页启动失败。
- 尚未宣称通过：整个仓库的全部测试、PR 三平台 CI、真实模型完整应答、所有桌面插件交互场景。部分旧测试仍需按新版契约更新。

## 收口要求

1. 移除旧客户端 runtime 引用和其 Context 声明，补齐新版服务装配及模块外部依赖。
2. 按实际发布包处理 Session、Conversation、图片、输入与设置契约；保留现有功能，不以删除断言、any 或关闭检查作为修复。
3. 完成逐补丁取舍，移除失效旧补丁和硬编码版本测试，重新生成 workspace、Host 与各插件/平台分发锁。
4. 通过类型检查、受影响模块测试、完整桌面构建、runtime verify / smoke、实际桌面插件与文件输入回归。
5. 新 PR 的三平台检查全部成功后才可转为待合并；没有自动合并授权。
