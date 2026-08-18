# Personal Managed Extensions（已退役）

该方案依赖 Amiba 自有 Extension Host、manifest、MCP subprocess runtime、WebView
bridge 与 registry，已在 DSH 原生迁移中删除，不再是实现依据。

后续可编程扩展全部采用独立 `dsh-plugin-*` 项目：Host 能力运行在 DSH/Cordis，UI
通过 DSH Client Slots 注入；Electron 只执行窄化 OS 操作。当前架构见
`docs/2026-08-15-dsh-native-architecture.md`，分发边界见
`docs/marketplace-bootstrap.md`。
