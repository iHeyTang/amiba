# 扩展独立分发 + API 版本闸门设计（WS1 + WS2 地基）

- 日期：2026-06-05
- 范围：`packages/extension-api`、`packages/extension-host`、`apps/extension-cli`、`apps/desktop`（host 版本暴露）、`packages/{ui,tailwind-preset}`（打包）；**不动** `extensions/*` 现有 3 个扩展的 `workspace:*`（它们留作 monorepo 内开发示例，真正抽取是 WS3）。
- 一句话：让每个扩展**能独立成仓库、独立版本管理与发布**，并落实**"扩展声明所支持的最低 host API 版本"并强制校验**。

## 0. 背景与现状（关键：目标已 ~80% 就绪）

探查现有扩展系统得到的事实（含文件引用），决定了本次真实工作量：

- **运行时加载是"路径 + 注册表"驱动，不绑定 monorepo**：扩展装在 `<userData>/extensions/<id>/`，由 `extensions-registry.json` 索引。`RegistryEntry` 已有 `source: "marketplace"|"local"`、`version`、`sha256`、`installedAt`、`disabled`（`packages/extension-host/src/main/registry-store.ts:7-16`）。runner 用**绝对路径** fork `main.cjs`（`runner-controller.ts:109-123`、`index.ts:164-183`）。
- **marketplace 安装流程已实现**：GitHub Releases 后端、索引仓库 `iHeyTang/hermes-x-marketplace` 的 `community-plugins.json`、`installFromRelease()`（下载 `extension.tgz`→校验 sha256→解压进 userData，`marketplace.ts:113-193`）、IPC（`marketplace:list/install`、`extensions:add-local/reload/uninstall/show-picker`，`ipc-router.ts:202-414`）、CLI（`hermes-x-ext install owner/repo@tag`，`apps/extension-cli/src/commands/install.ts`）。
- **`docs/marketplace-bootstrap.md` 已写好"每扩展一个独立 repo + `gh release` 发布"的流程**；`docs/community-plugins.sample.json` 已引用 `iHeyTang/hermes-x-ext-knowledge-base` 这类独立仓库名。
- **运行时产物本就自包含**：UI bundle 把 `@hermes-x/ui` 全打进 `dist/ui`；`main.cjs` 里 `@hermes-x/extension-api` 是纯类型（编译期擦除）。一个 `.tgz` 装到别的机器能直接跑。

**真正缺的两块（= 本 spec）：**
1. **WS1 版本闸门**：`manifest.engines.hermes-x` 声明了但**全仓库无任何代码校验**（`discover.ts` / `registry.ts` / `runner-controller.ts` / `marketplace.ts` 均无），无 semver 库，host 版本（`apps/desktop/package.json` `0.1.0`）未暴露给加载器。
2. **WS2 可消费 SDK**：扩展靠 `workspace:*` 依赖 `@hermes-x/{extension-api, ui, extension-cli, tailwind-preset}`，四者全 `"private": true`、未发布、依赖 workspace TS 源 → 独立仓库**构建期**装不到。（运行时不是问题。）

## 1. 目标与非目标

### 目标
- **WS1**：定义一个独立于 desktop 营销版本的 **host 扩展 API 契约版本（整数 level）**，作为单一真相源，运行时暴露给加载器与扩展；新增 manifest 字段声明扩展要求的**最低 API level**；在 **discover / marketplace-install / activate** 三处强制校验，不兼容时优雅标记（不崩溃）并在 UI 给出原因。
- **WS2**：把 `@hermes-x/{extension-api, extension-cli, tailwind-preset}` 改造为**可被外部独立消费**（正确的 `exports`/构建产物，不依赖 workspace-only TS path；`@hermes-x/ui` 推迟，见范围修订 §4.1）；用 **GitHub Release tarball** 作为暂时的（无公网 registry）分发渠道；修订现有 `hermes-x-ext create` **scaffold** 使其生成的独立 repo 骨架指向 tarball 依赖、用原生 React+Tailwind preset；CI 验证"无 registry 端到端消费"。

### 非目标（本 spec 不做）
- ❌ 发布到公共 npm / GitHub Packages（明确暂缓；tarball 起步，URL→版本范围的迁移留待将来）。
- ❌ 把现有 3 个扩展真正抽取到独立 repo（= WS3，largely mechanical，单独 spec）。
- ❌ `@hermes-x/ui` 的外部消费（依赖 5 个内部 workspace 包，成本过高）——WS2 不处理；外部扩展 v1 用原生 React + Tailwind preset 写 UI，共享组件库作后续专项。
- ❌ permissions 运行时强制（与本次无关，维持现状）。
- ❌ 改变 marketplace 后端（仍 GitHub Releases）。

## 2. 决策汇总（已与用户确认）
1. **版本语义** = 专门的"扩展 API 契约版本"，与 desktop 营销版本解耦。
2. **作者定位** = 现在 first-party，架构预留社区口子，不为陌生人过度打磨。
3. **首个 spec 范围** = WS1 + WS2 合成地基；WS3 抽取作后续。
4. **分发目标** = 暂不发公网，先用 git/tarball；后续迁 npm 是 URL→范围的替换。
5. **契约版本表示** = 单调递增的**整数 API level**（非 semver 区间），免 semver 依赖。
6. **tarball 分发** = GitHub Release 资产 + URL 依赖（备选 `file:` 本地并排）。
7. **WS2 范围修订**（实现期确认）= 仅 `extension-api`/`tailwind-preset`/`extension-cli` 三个包可消费 + scaffold；`@hermes-x/ui` 推迟。

## 3. WS1 — 版本闸门

### 3.1 契约版本：整数 API level
- 语义：能力单调累加，扩展声明"要求 host API level ≥ N"。比较即 `host.apiVersion >= ext.apiVersion`，**无需 semver 库**。
- 与 desktop 营销版本（`apps/desktop` `0.1.0`）完全解耦。

### 3.2 单一真相源 + 暴露
- `@hermes-x/extension-api` 新增导出 `export const API_VERSION = 1`（这版 SDK 对应的契约 level）。
- host 侧（`@hermes-x/extension-host`）内嵌它**实现**的 level：`export const HOST_API_VERSION = 1`，发版时与 SDK 同步 bump。校验时以 `HOST_API_VERSION` 为准。
- 运行时透给扩展，供优雅降级：
  - main 侧：`host.hostInfo.apiVersion: number`（扩展 `MainHost` 接口新增 `hostInfo`）。
  - webview 侧：`window.hermes.apiVersion: number`（`WebViewHostAPI` 新增只读字段；preload 注入）。
- bump 规则（写入文档）：任何对 **host API（`MainHost`）/ webview API（`WebViewHostAPI`）/ manifest schema** 的破坏性变更 → `API_VERSION++` 且 `HOST_API_VERSION++`。

### 3.3 manifest 字段
- 新增**顶层** `apiVersion?: number` —— 该扩展要求的最低 host API level（缺省视为 `1`，向后兼容现有扩展）。
- 现有 `engines.hermes-x`（semver）**保留为可选、不强制的 desktop-app 提示**，避免与 `apiVersion` 语义混淆。
- 更新 `manifest.schema.json`（加 `apiVersion: integer ≥ 1`）与 `ExtensionManifest`（`manifest.ts`）。

### 3.4 三处强制校验（不兼容 = 标记 + 原因，绝不崩溃）
- **discover**（`discover-registry.ts` / `discover.ts`）：解析 manifest 后，`apiVersion > HOST_API_VERSION` → 不激活，registry 写 `status/incompatible` + reason。
- **marketplace install**（`marketplace.ts` / `ipc-router.ts: marketplace:install`）：解压后、注册前比对；不兼容则**拒绝安装**并返回结构化错误（`需要 host API ≥ N，当前 M`）。
- **activate**（`extension-host/src/main/index.ts: activateOne`）：兜底再查；不兼容跳过激活。
- 新增比较工具 `isCompatible(extApiVersion, hostApiVersion): boolean`（纯函数，`extension-host` 内，整数比较，无依赖）。

### 3.5 状态与 UI
- `RegistryEntry` / registry 状态枚举新增 `"incompatible"`（带 `reason` 字段）。
- Settings → Extensions 列表：不兼容项显示禁用态 + "需要更新 desktop（要求 API ≥ N）"。复用既有 `extensions:*` IPC，载荷加 `incompatible/reason`。

## 4. WS2 — 可消费 SDK + tarball 分发 + scaffold

### 4.1 让 3 个包"可独立消费"（核心工作）

> **范围修订（基于实现期 ground truth）**：所有 `@hermes-x/*` 包当前都以**原始 TS 源**经 pnpm workspace 软链消费（`main`/`exports` 指向 `src/*.ts`，无 build）。且 `workspace:*` 的包间依赖**无法随 tarball 外带**（`pnpm pack` 会把 `workspace:*` 替换成不存在的 registry 版本）。`@hermes-x/ui` 依赖 5 个内部 workspace 包（`core/extension-host/i18n/platform/utils`），独立消费成本过高——**WS2 不处理 ui**，留作后续专项（见 §7）。WS2 只覆盖以下 3 个：

对 `@hermes-x/{extension-api, tailwind-preset, extension-cli}`：
- **`extension-api`**：加 build（tsc/tsup → `dist` 的 JS + `.d.ts`），`main`/`types`/`exports` 指向 `dist`，`files: ["dist", "manifest.schema.json"]`，`prepare`/`prepack` 触发 build（与 `extension-cli` 既有 `"prepare": "tsc"` 一致，保证 monorepo dev 与 tarball 两端都可 import）。它**无 `@hermes-x/*` 依赖**，react 为 optional peer → tarball 自包含。
- **`tailwind-preset`**：已是预构建、零依赖的单文件 `index.js`，基本即用；仅确认 `files` 含 `index.js`。
- **`extension-cli`**：已 build 到 `dist/` 且 `files` 含 `dist + src/template`。唯一阻碍是它对 `@hermes-x/extension-api` 的依赖——CLI 仅按**类型**使用它（读/校验 manifest），故把该依赖移到 `devDependencies`（类型在 build 期擦除），使发布出的 CLI tarball **无任何 `@hermes-x/*` 运行时依赖**、完全自包含。
- 三者保留 `"private": true`（防误 `npm publish`）；用 `pnpm pack` 产出 `.tgz`。

### 4.2 分发：GitHub Release tarball
- monorepo 新增脚本 `pnpm sdk:pack`：打出 3 个 `.tgz`，发布到 release tag `sdk-vN`（N = 当前 API level）。
- 独立 repo 依赖写法（注意：`extension-api` 是类型依赖，归 devDependencies 即可；运行时不需要它）：
  ```jsonc
  "devDependencies": {
    "@hermes-x/extension-api":   "https://github.com/iHeyTang/hermes-x/releases/download/sdk-v1/hermes-x-extension-api-0.1.0.tgz",
    "@hermes-x/extension-cli":   "https://github.com/iHeyTang/hermes-x/releases/download/sdk-v1/hermes-x-extension-cli-0.1.0.tgz",
    "@hermes-x/tailwind-preset": "https://github.com/iHeyTang/hermes-x/releases/download/sdk-v1/hermes-x-tailwind-preset-0.1.0.tgz"
  }
  ```
- npm/pnpm 原生支持 http tarball 依赖：写进 lockfile、可缓存。
- **`sdk-vN` 的 N 与契约 API level 对齐** → 装 `sdk-v1` 的扩展天然 `apiVersion: 1`。
- 备选（文档列出）：本地并排开发用 `file:../hermes-x/packages/*`。
- 将来迁 npm：把 URL 换成 `^x.y.z` 即可，无其他返工。

### 4.3 scaffold：`hermes-x-ext create <name>`（**修订现有命令**，非新增）
`create` 子命令 + `src/template/` 模板树**已存在**（`{{NAME}}`/`{{ID}}`/`{{AUTHOR}}` 占位 + `.tpl` 后缀）。它当前内置了 monorepo 假设，需修订为"独立 repo 可用"：
- **生成的 `package.json`**：把 `@hermes-x/*` 从 `"*"` 通配改为 `sdk-vN` 的 **tarball-URL**（`extension-api`/`extension-cli`/`tailwind-preset` 三个，均归 `devDependencies`；运行时不需要 `@hermes-x/*`）。
- **生成的 `tailwind.config.cjs`**：去掉硬编码的 `../../packages/ui/src/**` content 路径（那是 monorepo 路径）；content 仅扫描扩展自身 `src/**`。
- **模板 UI 用原生 React + Tailwind preset**：模板的 `src/ui/**/App.tsx` 等**不依赖 `@hermes-x/ui`**（用普通 JSX + `@hermes-x/tailwind-preset` 提供的 token）。若现有模板引用了 `@hermes-x/ui`，改写为自包含 JSX。
- **`manifest.json` 模板**：用顶层 `apiVersion`（与 `sdk-vN` 对齐），`$schema` 指向 raw GitHub schema（已有）。
- 补 `README.md` + `.github/workflows/release.yml`（`pnpm install` → `pnpm build` → `hermes-x-ext pack` → `gh release` 传 `extension.tgz`）。

### 4.4 验证 & 边界
- **CI/自检**：`hermes-x-ext create demo` 到隔离目录 → 指向**本地打出的 tarball** `install` → `build`（vite main+ui）→ `pack` 出 `extension.tgz`，全程 exit=0，证明无 registry 端到端可消费。
- monorepo 内 3 个扩展**继续用 `workspace:*`**（开发示例），本 spec 不改它们的依赖。
- **`@hermes-x/ui` 不在 WS2 范围**：外部扩展 v1 用原生 React + Tailwind preset 写 UI；共享组件库的外部消费（需把 ui 及其 5 个内部 workspace 依赖打成自包含 dist）作为后续专项。

## 5. 交付物 / 受影响文件
- `packages/extension-api/`：导出 `API_VERSION`；`MainHost` 加 `hostInfo.apiVersion`；`WebViewHostAPI` 加 `apiVersion`；`ExtensionManifest` 加 `apiVersion`；`manifest.schema.json` 同步；`package.json` `exports/files`。
- `packages/extension-host/`：`HOST_API_VERSION` 常量；`isCompatible()` 纯函数；discover/activate 校验；registry `incompatible` 状态；preload 注入 `apiVersion`；runner 暴露 `host.hostInfo`。
- `packages/extension-host/src/main/marketplace.ts` + `ipc-router.ts`：install 前校验 + 结构化错误。
- `apps/desktop/`：把 `HOST_API_VERSION` 接到 host 启动；Settings→Extensions UI 显示 incompatible。
- `apps/extension-cli/`：`create` 子命令 + 模板；（可选）`pack` 校验 manifest 有 `apiVersion`。
- monorepo 根：`sdk:pack` 脚本（打 3 个包的 `.tgz`）+ （可选）`.github/workflows` 发 `sdk-vN`。
- `packages/extension-api`：加 build（`dist` JS+`.d.ts`）+ `prepare` + `exports/files` 指向 dist。`packages/tailwind-preset`：确认 `files`。`apps/extension-cli`：`extension-api` 依赖移到 devDeps（自包含）+ 修订 `create` 模板（tarball 依赖、去 monorepo 路径、原生 UI）。
- 文档：更新 `docs/marketplace-bootstrap.md`（apiVersion + tarball 依赖写法）。

## 6. 测试与验收
- **纯函数单测（vitest）**：`isCompatible()`（边界：相等/低于/高于/缺省=1）；manifest 解析对 `apiVersion` 的读取与默认。
- **集成/构建自检**：
  - 全包 `tsc --noEmit` exit=0。
  - `pnpm sdk:pack` 产出 3 个 `.tgz`（extension-api / tailwind-preset / extension-cli）。
  - `hermes-x-ext create demo` → 在隔离目录 `install`（指向本地打出的 tarball）→ `build` → `pack` 出 `extension.tgz`，exit=0。
  - 把该 `extension.tgz` `extensions:add-local`/install 到 desktop，能加载（兼容）。
  - 构造一个 `apiVersion` 高于 `HOST_API_VERSION` 的 manifest → discover/install 均标记 incompatible 且不激活、不崩溃。
- **人工验收**：Settings→Extensions 正确显示兼容/不兼容态与原因。

## 7. 后续：WS3 — 抽取到独立 repo（largely mechanical，另立 spec）
per-extension：`git filter-repo` 拆历史（或新建仓库）→ 依赖改 tarball-URL → 加 `release.yml` → 登记到 `iHeyTang/hermes-x-marketplace` 索引。届时验证：从 GitHub Release 安装 = 与本地 `add-local` 行为一致。

## 8. 风险与开放问题
- **`@hermes-x/ui` 独立消费推迟到后续**（见 §4.1/§4.4/§7）：其依赖 `core/extension-host/i18n/platform/utils` 五个内部 workspace 包，且 `extension-host` 作为 *UI* 依赖语义可疑；要么把它们 inline 成自包含 dist、要么整树 build+tarball，成本与 WS2 的"first-party 起步"不匹配。
- **`extension-api` 需要真实 build**：当前 `exports` 指向 `src/*.ts`（原始 TS），tarball 装进外部 repo 无法直接 import。WS2 给它加 `dist`（JS + `.d.ts`）+ `prepare` build。需验证此改动不破坏 monorepo 内消费者（extension-host / desktop runner，后者已确认会 bundle extension-api）与 WS1 的 `tsc`/测试。
- **`workspace:*` 不随 tarball 外带**：`pnpm pack` 会把 `workspace:*` 替换成不存在的 registry 版本。故任何要外发的包都不能保留 `@hermes-x/*` 运行时依赖——`extension-cli` 的 `extension-api` 依赖移到 devDeps（类型擦除）解决；`tailwind-preset`/`extension-api` 本就无 `@hermes-x/*` 运行时依赖。
- **tarball URL 的 release 前置**：独立 repo CI 依赖 `sdk-vN` release 已存在；需先发 SDK release 再发扩展。文档需点明顺序。

> **状态**：§3（WS1）已实现并通过最终评审（分支 `feat/extension-sdk-versioning`，7 个提交）；§4（WS2）为下一步，本节修订即据其实现期 ground truth。
- 整数 API level 与现有 `engines.hermes-x: "^0.1.0"` 并存的认知成本：靠文档 + scaffold 默认只写 `apiVersion` 来降低。
