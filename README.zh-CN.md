# Amiba

[English](README.md) | [简体中文](README.zh-CN.md)

Amiba 是一个基于 [Hermes Agent](https://github.com/NousResearch/hermes-agent)
构建的桌面客户端和浏览器扩展。本仓库采用 pnpm monorepo，多个应用共享核心逻辑、UI、
设置、主题、国际化和平台抽象。

本地 Hermes 源码仓库是可选的，可以放在任意位置。只有开发者显式指定时，Amiba 才会在
本地联调中使用它。

## 工作区

```text
amiba/
├── apps/
│   ├── browser-extension/ # 浏览器扩展
│   ├── cli/               # 扩展开发命令行工具
│   └── desktop/           # Electron 桌面端
├── backend/               # Amiba 本地后端
├── packages/              # 多端共享包
├── package.json
└── pnpm-workspace.yaml
```

三个应用分别是：

- `apps/browser-extension`：浏览器扩展。
- `apps/desktop`：Electron 桌面客户端。
- `apps/cli`：`amiba` 命令，用来创建、开发、打包和安装 Amiba Desktop 扩展及
  mention source。

主要共享包：

- `packages/core`：聊天协议、Hermes 客户端和业务逻辑。
- `packages/chat-ui`：共享聊天界面。
- `packages/settings-ui`：共享设置界面。
- `packages/platform`：浏览器和 Electron 的平台能力抽象。
- `packages/ui`、`packages/theme`、`packages/i18n`：基础 UI、主题和国际化。

## 环境要求和安装

- Node.js 20 或更高版本
- pnpm 9 或更高版本

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
```

## 本地开发

启动浏览器扩展：

```bash
pnpm dev:browser-extension
```

首次运行桌面端前，先准备一次托管 Hermes Runtime：

```bash
pnpm runtime:prepare
pnpm dev:desktop
```

日常修改 Amiba UI 或桌面端代码时，不需要重复构建 Hermes Runtime。

## 托管 Hermes Runtime

Amiba Desktop 自带并运行自己的 Hermes Runtime，不使用系统安装的 Hermes、Python 或
Node，也不会修改开发者的本地 Hermes 源码仓库。

```text
Runtime 构建清单
      ↓ runtime:prepare
工程或安装包内的完整只读 Runtime
      ↓
直接运行 Hermes

Amiba 用户数据目录
      ↓
只保存可写的 HERMES_HOME
```

其中有三个重要位置：

- `apps/desktop/hermes-runtime-manifest.json` 是纳入版本管理的构建声明，固定 Hermes
  commit、Python、Node 和 Amiba 补丁。
- `apps/desktop/resources/hermes-runtime` 是生成的完整 Runtime，也是桌面安装包要携带
  并直接执行的 Runtime。
- Amiba 用户数据目录只在私有 `HERMES_HOME` 中保存配置、会话、日志、技能和缓存。

系统安装的 Hermes 和额外的本地 Hermes 源码仓库都不在默认启动链路中。

### 查看内置版本

```bash
# 打印当前准备好的 Runtime 摘要
pnpm runtime:info

# 验证已生成的 Runtime 是否与声明一致
pnpm runtime:verify
```

### 升级内置 Hermes

1. 修改 `apps/desktop/hermes-runtime-manifest.json` 中的完整 `commit` 和 `version`。
2. 运行 `pnpm runtime:prepare`。
3. 运行 `pnpm runtime:verify`。
4. 使用 `pnpm dev:desktop` 启动并验证升级结果。

准备 Runtime 时，构建器会自动判断每个下游补丁：

- `apply`：上游仍缺少对应能力，自动应用并验证补丁。
- `retire`：能力已经进入上游，停止构建并提示移除过期补丁。
- `conflict`：能力仍然缺失，但补丁已经无法应用，需要手动 rebase。

如果构建清单没有变化，但需要强制完整重建：

```bash
pnpm runtime:rebuild
```

### Runtime 使用模式

| 模式                        | 用途                       | 实际执行的源码                                          | 补丁和验证               |
| --------------------------- | -------------------------- | ------------------------------------------------------- | ------------------------ |
| 内置固定版本（默认推荐）    | 日常开发、测试和正式发布   | `resources/hermes-runtime` 中由 manifest 固定的源码副本 | 自动执行                 |
| 本地源码生成的 Runtime 副本 | 联调本地 Hermes 的主动修改 | `resources/hermes-runtime` 中的 Amiba 暂存副本          | 自动执行                 |
| 直接源码覆盖（高级）        | 快速、临时地修改源码       | 原始源码目录                                            | 跳过，由开发者保证兼容性 |

除非正在修改 Hermes 本身，否则应该使用内置固定版本。正常流程是先运行
`pnpm runtime:prepare`，然后运行 `pnpm dev:desktop`。

### 可选：调试本地 Hermes 源码

需要测试任意本地 Hermes 仓库时，必须显式传入它的路径：

```bash
pnpm runtime:prepare:local -- --source /absolute/path/to/hermes-agent
pnpm dev:desktop
```

Amiba 会复制源码并在自己的临时副本上应用补丁，原始工作区保持不变。`dev:desktop`
始终使用最近一次准备好的 Runtime。修改所选 Hermes 源码后，需要使用相同路径重新运行
准备命令。这种方式比直接覆盖安全，但只用于 Hermes 本地开发，不是 Amiba 的默认流程。

需要长期保存个人的直接源码配置时，先复制示例文件：

```bash
cp .amiba.local.example.ts .amiba.local.ts
```

然后在 `.amiba.local.ts` 中填写本机源码路径：

```ts
import { defineAmibaConfig } from "./apps/desktop/scripts/desktop-local-config.mjs";

export default defineAmibaConfig({
  hermes: {
    mode: "direct-source",
    source: "/absolute/path/to/hermes-agent",
  },
});
```

`.amiba.local.ts` 已被 Git 忽略，不能提交。删除该文件或将 `hermes.mode` 改成
`built-in`，即可恢复默认内置 Runtime。`defineAmibaConfig` 会直接提供字段补全、模式选项、
说明和实时类型错误。需要单次临时覆盖时，环境变量优先级最高：

```bash
AMIBA_HERMES_DEV_SOURCE=/absolute/path/to/hermes-agent pnpm dev:desktop
```

这种方式仍然使用 prepared Runtime 中的 Python、Node 和 Backplane，但会跳过源码复制、
Amiba 补丁应用和行为验证，因此依赖及协议兼容性由开发者负责。

实现细节见
[托管 Runtime 文档](apps/desktop/docs/managed-hermes-runtime.md)。

## 构建和打包

```bash
pnpm build:browser-extension
pnpm build:desktop
pnpm package:desktop
```

桌面端打包会自动运行 `runtime:prepare`，并将完整 Hermes Runtime 放进安装包。用户不需要
另外下载或安装 Hermes。

## 架构

```text
共享 UI 和业务逻辑
         │
         ▼
 PlatformAdapter
         │
    ┌────┴────┐
    ▼         ▼
浏览器 API  Electron IPC
```

- 浏览器扩展使用浏览器 API 实现平台能力。
- 桌面端通过 Electron IPC 和主进程实现平台能力。
- 两端共享聊天、会话、设置、主题和国际化。
- 桌面端主进程管理内置 Hermes Runtime，并通过 `/v1/runs` 与 Gateway 通信。

## 更多文档

- [托管 Hermes Runtime](apps/desktop/docs/managed-hermes-runtime.md)
- [本地后端](backend/README.md)
- [浏览器扩展](apps/browser-extension/README.zh-CN.md)
