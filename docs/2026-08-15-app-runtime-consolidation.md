# Amiba App Runtime 收敛

更新：2026-08-16。

`@amiba/app-runtime` 是应用侧共享领域包，当前只包含：

- `core`
- `platform`
- `protocol`
- `dsh-client`
- `dsh-distribution`
- `model-plane`
- `model-plane-dsh`
- `utils`

它不再包含 MCP subprocess host、Managed Extensions 或 Extension Host。上述旧目录及
package exports 已删除；Electron 也不再构建 extension runner 和 WebView bridge preload。

独立保留的边界：

- `@amiba/ui`：现有产品 UI；
- `@amiba/extension-sdk`：公开的 DSH plugin/slot 作者契约；
- `@amiba/app-runtime/dsh-runtime`：公共 Node/DSH 可执行分发与 Profile 生命周期；
- `@amiba/dsh-plugin-ui-shell`：可发布的 Amiba root/children slot plugin；
- `@amiba/dsh-bundle-amiba`：纯装配；
- 每个 `@amiba/dsh-plugin-*`：独立功能域、配置与生命周期。

Model Plane 虽与应用领域代码共处一个物理 Workspace package，依赖方向仍严格独立：
`model-plane` 不 import DSH/Electron/adapter；`model-plane-dsh` 只负责执行投影。

原独立 `@amiba/dsh-distribution` 已合并为 `@amiba/app-runtime/dsh-distribution`。它只定义
Core/Web/Desktop 的 Bundle/Profile 组合，不下载或启动进程；可执行职责属于
`@amiba/app-runtime/dsh-runtime`。

Electron 与 DSH 的唯一特权连接是本地鉴权 native gateway。它没有 plugin/tool catalog，
不能注册 Agent 能力；调用它的 DSH plugin 才拥有 schema、provenance 和 lifecycle。
