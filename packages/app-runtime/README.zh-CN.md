# @amiba/app-runtime

[English](./README.md)

Amiba 各渲染面（桌面端与 DSH Web Shell）及 Electron 主进程共用的应用域代码。
平台契约、产品协议、DSH 客户端与分发机制都由这一个包持有——任何界面都通过它
与智能体运行时对话，而无需关心自己运行在哪个宿主里。

## 组成结构

每个公开子路径对应 `src/` 下的一个模块：

| 子路径 | 模块 | 职责 |
| --- | --- | --- |
| `./platform` | `src/platform` | `PlatformAdapter` 契约：与运行时无关的能力面（storage、shell、引擎原生的 session/model/preset/settings/credential/permission 投影、桌面端专属的 workspace 桥）。各应用在启动时经 `setPlatform()` 安装自己的实现。**只含机制与引擎原生形状**——域 adapter（记忆、技能、MCP、消息、定时任务、用量、model plane 等）全部住在各自的 `dsh-plugin-*` 包里，由 `scripts/verify-pluginization.mjs` 机器把关。 |
| `./protocol` | `src/protocol` | Amiba 界面与所选智能体运行时之间的稳定产品协议（chat 角色、message/turn/step 形状）。刻意不含任何 adapter 实现类型；运行时 adapter 在此边界翻译各自的原生事件流。 |
| `./core` | `src/core` | UI 消费的共享应用状态与服务：会话与会话历史投影、chat-engine 客户端协议、智能体预设与上下文、附件、定时运行、运行时权限、配置、渠道、壁纸。 |
| `./dsh-client` | `src/dsh-client` | DSH API 客户端及其粘合层：`DshApiClient`（RPC + events.mux）、Amiba 事件桥、chat-engine 适配器、`createDshPlatformAdapters`（把引擎原生的平台面接到客户端上），以及官方 Web Shell 使用的 web-platform 组合。 |
| `./dsh-distribution` | `src/dsh-distribution` | Core/Web/Desktop 三种 Profile 的契约：bundle 身份（`@amiba/dsh-bundle-amiba-{core,web,desktop}`）、Profile 名称与 manifest 组合。纯数据，以预构建的 `.js`/`.d.ts` 发布，浏览器侧消费者永远不会加载 Node 代码。 |
| `./dsh-runtime` | `src/dsh-runtime` | 仅限 Node：管理钉版的 Node/DSH 制品——staging 的准备与校验、Profile 生命周期、应用打包路径。读取 `dsh-runtime-manifest.json`；从 `dist/` 构建产物导出。 |
| `./dsh-runtime-manifest` | `dsh-runtime-manifest.json` | 钉版清单（DSH 版本、Node 版本、bundle 集合），供 staging 与打包消费。 |
| `./utils` | `src/utils` | 不依赖平台与 DSH 的纯工具函数。 |

`dsh-distribution` 与 `dsh-runtime` 刻意分开：前者是浏览器安全的 Profile
契约，后者持有 Node 侧的制品——二者描述同一套分发，只是站在进程边界的两侧。

顶层配套路径：

- `resources/dsh-runtime/` —— staged 的受管运行时（gitignore 的构建产物；
  用 `pnpm runtime:rebuild` 刷新，然后完全重启应用）。
- `scripts/` —— staging、校验与 bundle 组成冒烟脚本
  （`scripts/dsh-runtime/smoke.mjs`，因为校验的是随包发运的 bundle，允许
  按名引用插件包）。
- `dist/` —— 仅限 Node 的 `dsh-runtime` 子路径的构建输出。

## 刻意不在此包的内容

插件加载、model plane（供应商/凭证/模型发现与 composer 模型选择器）、模型
工具、MCP Provider、定时任务、技能、记忆、用量计量、消息以及 UI slot 生命
周期都不在这里实现。这些能力住在各自独立的 `dsh-plugin-*` 包里，由独立的
`@amiba/dsh-bundle-amiba-core`、`-web`、`-desktop` 三层组合。

此包同样不含 Extension Host、受管扩展运行时、WebView 桥或 MCP 子进程宿主。
