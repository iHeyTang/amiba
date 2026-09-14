# DSH 0.1.5-rc.1 升级迁移记录

基线：PR #16 已合并，main 提交 `092d11c07b578911eb0e165e0869b1c94a0606e6`。目标是 npm 实际发布的 `@deepseek-ai/dsh@0.1.5-rc.1`，不是固定源码 c291e796，也不是 next 的 rc.2。

## 当前状态：迁移中，不可合并

当前分支已开始更新运行时声明、依赖 catalog 和客户端类型引用，但尚未完成安装锁、补丁和运行行为迁移。不得将版本声明变更解读为可运行升级，不得发布此分支。

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

## 本轮探测结果

- npm 已确认目标主包存在。尝试所有官方包统一升级时，安装明确因不存在的 dsh-client-runtime@0.1.5-rc.1 失败。
- 为识别后续编译差异，探测性安装暂留旧 dsh-client-runtime。该混合状态不是最终架构，最终必须移除。
- 对独立服务的首轮类型引用迁移后，ui-shell 类型检查仍报告 118 条诊断（含测试和共享 UI，不等于 118 个独立故障）；保留在本地 `/tmp/amiba-dsh-015-types2.log`，后续改动后需要重新验证。
- 尚未通过完整构建或实际桌面验收；上一 PR 的通过结果不能用于本升级分支。

## 收口要求

1. 移除旧客户端 runtime 引用和其 Context 声明，补齐新版服务装配及模块外部依赖。
2. 按实际发布包处理 Session、Conversation、图片、输入与设置契约；保留现有功能，不以删除断言、any 或关闭检查作为修复。
3. 完成逐补丁取舍，移除失效旧补丁和硬编码版本测试，重新生成 workspace、Host 与各插件/平台分发锁。
4. 通过类型检查、受影响模块测试、完整桌面构建、runtime verify / smoke、实际桌面插件与文件输入回归。
5. 新 PR 的三平台检查全部成功后才可转为待合并；没有自动合并授权。
