# Amiba

[DSH 官方插槽兼容维护台账](DSH-SLOT-COMPATIBILITY.md) — 官方版本对照、Amiba 支持程度、接入与退役决策的长期维护入口。

**以 DSH 为唯一智能体内核的桌面工作台。** · [English](./README.md)

Amiba 是一个构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）
之上的桌面 Agent 工作台。智能体、会话、事件流、上下文组装、模型、Preset、工具、审批、
提问、Skills、MCP Client 和调度都由 DSH 作为**唯一真源**管理；Amiba 在其上增加了一个桌面应用、
一层边界清晰的本地能力桥接，以及一批需要进入智能体生命周期的产品能力——每一项都作为
Cordis 插件运行在 DSH 内部。

仓库现在只有一条运行路径：不保留兼容网关、Python sidecar、浏览器扩展运行时、旧会话回退或
双写迁移层。

## 界面截图

<p align="center">
  <img src="docs/screenshots/workspace-overview.webp" width="720" alt="Amiba 工作台总览" />
</p>
<p align="center"><em>以对话驱动的工作台：左侧是工作空间、定时任务、外部消息与任务历史，中间是会话。</em></p>

|  |  |
|:---:|:---:|
| <img src="docs/screenshots/embedded-browser.webp" width="380" alt="内嵌浏览器与联网搜索" /> | <img src="docs/screenshots/settings-models.webp" width="380" alt="模型与服务设置" /> |
| *内嵌浏览器 + 联网检索* | *模型分配与能力路由* |
| <img src="docs/screenshots/settings-connections.webp" width="380" alt="连接设置" /> | <img src="docs/screenshots/settings-usage.webp" width="380" alt="用量分析" /> |
| *连接器：飞书、钉钉、微信、Webhook* | *用量：Token、活跃度热力图、按模型拆分* |

## Amiba 在 DSH 之上额外做了什么

Amiba **不是** DSH 内核的分叉——智能体运行时被原样使用。区别在于它周边的一切，全部以
独立的 `dsh-plugin-*` 工程交付。

| 层面 | 官方 DSH | Amiba（本仓库） |
| --- | --- | --- |
| 智能体运行时 | 拥有会话、事件、上下文、工具、Skills、MCP、调度、审批 | 原样使用 |
| 产品界面 | Web Shell、CLI | **+ 原生桌面应用**（Electron）：窗口、通知、文件系统、PTY 终端、可见内嵌浏览器、屏幕截取、外部收件箱、Workspace Checkpoint |
| 模型与凭据 | Preset + 执行 | **+ Model Plane**：Provider/模型发现、凭据、能力路由（默认 + 推理、视觉、图片/视频/语音/音乐生成）、费用确认阈值 |
| 集成 | MCP、Web 工具 | **+ 一等连接器**：飞书、钉钉、微信、Webhook，带外部收件箱与会话持久化 |
| 记忆 | 会话内上下文 | **+ 跨会话长期记忆**（memos） |
| 可观测性 | — | **+ 用量分析**：Token/轮次统计、活跃度热力图、按模型拆分 |
| 助手能力 | — | **+ 视觉**（可为纯文本 Agent 指派）、**媒体生成**路由、**定时任务**、**桌面宠物** |
| 界面 | 官方 Web Shell slot | **+ 完整桌面 UI**（`@amiba/ui` + `dsh-plugin-ui-shell`），采纳官方 slot 但自带像素 |
| 扩展开发 | Host/Client 插件 API | **+ Extension SDK**（`@amiba/extension-sdk`）与 `amiba plugin create` |

每一项 Amiba 能力都是独立、按功能版本化的 Cordis 插件；Bundle 只负责把它们装配起来。
职责边界与能力归属见
[`docs/2026-08-15-dsh-native-architecture.md`](docs/2026-08-15-dsh-native-architecture.md)。

## 架构

Core 与插件统一数据升级约定：[data-upgrades.md](docs/data-upgrades.md)（设计阶段，未发版数据不做历史迁移）。

```text
React UI
   │ 类型化 PlatformAdapter / ChatEngineClient
Electron main
   ├─ 受管 DSH 进程 ── DSH 官方 HTTP + WebSocket API
   │     ├─ 原生会话、工具、模型、Preset、Skills、MCP、调度
   │     └─ @amiba/dsh-bundle-amiba（只负责装配）
   │           ├─ @amiba/dsh-plugin-model-plane（独立真源 + DSH 投影）
   │           ├─ @amiba/dsh-plugin-memory-memos
   │           ├─ @amiba/dsh-plugin-messaging-core
   │           ├─ @amiba/dsh-plugin-connector-webhook
   │           ├─ @amiba/dsh-plugin-attachments
   │           ├─ @amiba/dsh-plugin-mcp-manager
   │           ├─ @amiba/dsh-plugin-runtime-inventory
   │           ├─ @amiba/dsh-plugin-browser-core
   │           ├─ @amiba/dsh-plugin-browser-provider-cdp
   │           ├─ @amiba/dsh-plugin-browser-provider-electron
   │           └─ 其他独立 dsh-plugin-* 工程
   ├─ 带鉴权的原生操作网关（不拥有插件或工具目录）
   ├─ DSH 进程级遥测
   └─ 文件系统、窗口、通知、原生图片暂存、可见浏览器、终端、外部收件箱、
      屏幕截取与 Workspace Checkpoint
```

完整的职责边界、能力取舍、记忆设计、安全模型和迁移方案见
[`docs/2026-08-15-dsh-native-architecture.md`](docs/2026-08-15-dsh-native-architecture.md)。
应用运行时的物理收敛映射与验收证据见
[`docs/2026-08-15-app-runtime-consolidation.md`](docs/2026-08-15-app-runtime-consolidation.md)。

## 工作区

- `apps/desktop`：消费公共 App Runtime 的 Electron 交互层。
- `apps/cli`：通过同一个受管 Runtime 执行任务、启动 Web 和开发 DSH Plugin 的 CLI。
- `packages/app-runtime`：跨客户端共享的领域类型、Platform 契约、协议、DSH Client、
  DSH Distribution 组合契约、CLI/Web/Electron 共用的固定版本 Node/DSH Runtime 与
  Model Plane 纯领域模块；其中 `dsh-runtime` 子模块负责准备、校验、Profile 路径和
  真实集成冒烟，耐久存储和 DSH 投影属于 `dsh-plugin-model-plane`。
- `plugins/dsh-plugin-*`：按功能模块独立版本化的 Cordis 插件工程；每个工程拥有
  自己的 DSH Service/Tool，并显式声明插件间依赖。
- `bundles/dsh-bundle-amiba-*`：只负责顺序与配置，把独立插件装配成 Amiba DSH Profile。
- `packages/ui`：保留现有视觉实现、改接 DSH 契约的界面。
- `packages/extension-sdk`：提供给 DSH Plugin 作者使用的 Amiba 公共契约。

## 受管运行时

CLI、Web 与 Electron 不发现系统 DSH，也不使用系统 Node 执行 DSH；公共 Runtime 固定为：

- DSH `0.1.5-rc.1`
- Node.js `22.22.0`
- Amiba 插件修订 `2026-08-16.2`
- 插件安装器 pnpm `9.12.0`（随受管运行时打包）

真源位于
[`packages/app-runtime/dsh-runtime-manifest.json`](packages/app-runtime/dsh-runtime-manifest.json)，
生成的 `packages/app-runtime/resources/dsh-runtime/` 不进入 Git。Desktop 打包时只把
这一公共 Runtime 复制进应用资源，不再拥有另一份 Runtime。

设置中的“插件”页面直接展示 DSH Loader inventory，并支持安装 npm 包或 CLI 生成的
`dsh-plugin.tgz`。安装、更新和移除统一调用官方
`dsh plugin --profile web`，完成后重启并重新读取 Host/Client graph；Electron 不保存
第二份插件 registry。

## 开发

需要 Node.js `^22.19.0` 或 `>=24.0.0` 与 pnpm 9；干净用户态沙箱脚本目前仅支持 macOS。

```bash
pnpm install
pnpm runtime:prepare
pnpm dev:desktop
```

`pnpm dev:desktop` 会持续监听工作区内所有带 Client 入口的 Amiba 插件。
保存 UI/插件源码后，仅增量重建受影响的 Client bundle，并通过 DSH 重建通道自动
刷新当前窗口；通常不需要重新执行 `runtime:rebuild` 或重启桌面应用。
Host 插件、依赖清单和 Cordis patch 等运行时结构变更仍需要重启开发进程。

CLI/Web 需要浏览器执行时，为一个已启用 remote debugging 的 Chrome/Chromium 设置
`AMIBA_BROWSER_CDP_URL=http://127.0.0.1:9222`。未配置 endpoint 时，CDP provider 不注册，
浏览器工具也不会错误地出现在该运行时的有效工具目录；Electron 则自动注册优先级更高的
可见内嵌浏览器 provider。

完整验收命令：

```bash
pnpm runtime:verify
pnpm runtime:smoke
pnpm verify:architecture
pnpm -r typecheck
pnpm -r --if-present test
pnpm build:desktop
```

隔离的首次启动环境：

```bash
pnpm dev:desktop:fresh
pnpm dev:desktop:fresh:keep
```

## 明确砍掉的能力

不适合 DSH 原生生命周期的旧实现已经删除：Python 服务面、独立浏览器扩展目标、
语音/STT、看板/任务中心投影、虚拟模型编排、旧运行时插件管理、旧会话导入/回退，
以及一等 MCP Resources/Prompts。若重新引入 Agent 能力，必须创建独立的
`dsh-plugin-*` 工程；OS 执行仅保留职责明确、可测试的窄平台操作，不能拥有或发布
DSH Tool 定义，也不能重新形成第二套智能体内核。
