# Desktop 扩展系统设计

- 日期：2026-06-03
- 范围：apps/desktop + packages/*
- 第一阶段交付物：可加载的扩展宿主 + 从 core 抽离的"知识库（gbrain）扩展"

## 1. 目标与非目标

### 目标

- 给 desktop 加一个**扩展点系统**：核心 desktop 不再硬编码任何业务功能（Knowledge / gbrain / brain-install / activityBar 中的 knowledge 项 / settings 中的 Knowledge tab / HomeView 的 brain hint 全部下沉到扩展）。
- 扩展形态：一个目录 = manifest + main 入口 + renderer 入口 + i18n。每个扩展能贡献：activityBar item / sidebar view / settings tab / composer hint，能在 main 进程里挂 IPC handler 和后台任务，能调用 hermes-agent 工具。
- 接口**为第三方分发预留口子**（manifest 字段、permissions、ipc namespace），但第一阶段只交付"内置加载器"——所有扩展和 desktop 一起编译/发版，不做运行时安装。
- 第一阶段同时完成 `extensions/knowledge-base/`，把现有 gbrain/知识库能力 1:1 迁过去；core desktop grep 不到 `gbrain` / `brain` / `knowledge`（除 extension id 的字面意义外）。

### 非目标（明确不做）

- ❌ 第三方扩展安装 / 卸载 / 升级 UI（二期）
- ❌ 运行时沙箱、子进程或 iframe 隔离（二期，C 方案）
- ❌ 热卸载 / 热替换扩展（重启即可）
- ❌ 自动安装 manifest 声明的 hermes-plugin（一阶段仅检测 + 提示）
- ❌ permission prompt UI（permissions 字段定义、但运行时不拦截）
- ❌ 扩展商店 / 签名 / 版本兼容矩阵

## 2. 架构总览

```
                    ┌──────────────────────────────────────────────┐
                    │              apps/desktop (Electron)         │
                    │                                              │
   main 进程         │  ┌─────────────────────────────────────────┐ │
   ┌──────────┐     │  │  packages/extension-host (main side)    │ │
   │ index.ts │────▶│  │   - scan manifests                      │ │
   │          │     │  │   - dependency-sort + activate(host)    │ │
   │          │     │  │   - ipc router  ext.<id>.<channel>      │ │
   │          │     │  │   - background-boot orchestration       │ │
   └──────────┘     │  └─────────────────────────────────────────┘ │
                    │                                              │
   preload          │  ┌─────────────────────────────────────────┐ │
   ┌──────────┐     │  │  packages/extension-host (preload)      │ │
   │ index.ts │────▶│  │   exposes window.hermes.extensions.*    │ │
   └──────────┘     │  └─────────────────────────────────────────┘ │
                    │                                              │
   renderer         │  ┌─────────────────────────────────────────┐ │
   ┌──────────┐     │  │  packages/extension-host (renderer)     │ │
   │ App.tsx  │────▶│  │   - load renderer entries via import()  │ │
   │          │     │  │   - slot registry / commands / settings │ │
   │          │     │  │   - <SlotOutlet name="..."/>            │ │
   └──────────┘     │  └─────────────────────────────────────────┘ │
                    └──────────────────────────────────────────────┘
                                         │
                            extensions/<id>/
                            ├── manifest.json
                            ├── src/main/index.ts
                            ├── src/renderer/index.ts
                            └── src/i18n/{zh-CN,en}.json
```

核心想法：把"加载器 / 注册表 / slot 协议"做成一个独立包 `@hermes-x/extension-host`（main / preload / renderer 三个 entry），desktop 仅负责挂载 SlotOutlet 和把生命周期接到 Electron 的启动顺序上。

## 3. 扩展目录结构与 manifest

### 3.1 目录

```
extensions/<id>/
├── package.json              # @hermes-x/ext-<id>，仅 build / 类型依赖
├── manifest.json             # 静态贡献声明，loader 在不执行扩展代码前提下可读
├── src/
│   ├── main/index.ts         # export activate(host): void | Promise<void>
│   │                         # export deactivate?(): void | Promise<void>
│   ├── renderer/
│   │   ├── index.ts          # export activate(host): void
│   │   └── views/...         # React 组件
│   └── i18n/{zh-CN,en}.json  # 扁平 key → 文案
└── dist/                     # 由扩展的 build 脚本产出
    ├── main.cjs              # Electron main 进程 CJS bundle
    ├── renderer.js           # ESM bundle，loader 用 import() 加载
    ├── i18n/zh-CN.json
    └── i18n/en.json
```

### 3.2 manifest.json schema

```jsonc
{
  "$schema": "@hermes-x/extension-host/manifest.schema.json",
  "id": "io.hermes.knowledge-base",   // 反向域名；ipc / settings / storage 全用它做 namespace
  "name": "Knowledge Base",
  "version": "0.1.0",
  "engines": { "hermes-x": "^0.1.0" }, // 一阶段只读不强制

  "entries": {
    "main":     "dist/main.cjs",
    "renderer": "dist/renderer.js"
  },

  "i18n": {
    "zh-CN": "dist/i18n/zh-CN.json",
    "en":    "dist/i18n/en.json"
  },

  "contributes": {
    "activityBar": [
      { "id": "knowledge", "iconKey": "ext.<id>.activityBar.icon",
        "labelKey": "ext.<id>.activityBar.label", "order": 200 }
    ],
    "sidebarViews": [
      { "id": "knowledge", "anchor": "activityBar:knowledge" }
    ],
    "settingsTabs": [
      { "id": "knowledge", "labelKey": "ext.<id>.settings.knowledge.label",
        "order": 100 }
    ],
    "composerHints": [
      { "id": "brain-disconnected" }
    ]
  },

  "hermesPlugins": [
    { "id": "gbrain", "version": "^0.x", "required": false }
  ],

  "permissions": [
    "ipc", "settings", "storage", "i18n", "lifecycle.boot", "hermes.callTool"
  ]
}
```

**关键设计约束（一旦确定，整条流水线随之展开）**：

1. **manifest 必须是静态 JSON**，禁止 `.js`/`.ts`。Loader 在不 `require()` 扩展代码前就能拿到所有贡献点，"加载失败的扩展"也能把它的 activityBar item 灰显出来，方便排错。
2. **双入口可选**：纯 renderer 扩展可以没有 `entries.main`；纯后台扩展可以没有 `entries.renderer`。
3. **i18n 文件是 JSON**，加载器在 desktop 启动早期就把它合并进 `@hermes-x/i18n` 的运行时表，所有 key 自动加 `ext.<id>.` 前缀（manifest 里写"完整 key"以保持引用一致性）。
4. **`permissions` 第一阶段只声明不强制**。这是给二期 prompt 留口的字段。
5. **`hermesPlugins.required: true` 时**，扩展激活前 host 检测到缺失会直接禁用该扩展（标记 failed）；`required: false` 时只发出一次 `host.notify` 提醒。

## 4. Host API

`@hermes-x/extension-host` 暴露给扩展两个对象：`MainHost`（传给 `src/main/index.ts` 的 `activate`）、`RendererHost`（传给 `src/renderer/index.ts` 的 `activate`）。两者共享部分语义，但作用域不同。

### 4.1 MainHost (main 进程)

```ts
interface MainHost {
  readonly id: string                                  // 当前扩展 id
  logger: Logger                                       // 命名空间日志
  ipc: {
    expose<TArgs, TRet>(
      channel: string,
      handler: (args: TArgs, ctx: IpcContext) => Promise<TRet>
    ): Disposable                                       // 实际 channel 是 `ext.<id>.<channel>`
  }
  lifecycle: {
    onBootBackground(handler: () => Promise<void>): Disposable
    onShutdown(handler: () => Promise<void>): Disposable
  }
  settings: {
    get<T>(key: string, fallback: T): Promise<T>        // 键自动加 `ext.<id>.`
    set<T>(key: string, value: T): Promise<void>
  }
  storage: {                                            // 文件存储，独立目录
    get<T>(key: string, fallback: T): Promise<T>
    set<T>(key: string, value: T): Promise<void>
  }
  hermes: {
    callTool<TArgs, TRet>(tool: string, args: TArgs): Promise<TRet>
  }
}
```

### 4.2 RendererHost (renderer)

```ts
interface RendererHost {
  readonly id: string
  logger: Logger
  slots: {
    // factory 返回 React 组件类型；options 控制可见性、props
    register<P = unknown>(
      slot: SlotName,
      factory: (slotCtx: SlotContext) => SlotEntry<P>
    ): Disposable
  }
  commands: {
    register(commandId: string, handler: CommandHandler): Disposable
    invoke(commandId: string, args?: unknown): Promise<unknown>
  }
  settings: {
    define(schema: SettingsSchema): Disposable          // 声明 settings tab 的 schema
    get<T>(key: string, fallback: T): Promise<T>
    set<T>(key: string, value: T): Promise<void>
    watch<T>(key: string, cb: (v: T) => void): Disposable
  }
  storage: { get; set; watch }                          // renderer 端 scoped storage
  ipc: {
    invoke<TArgs, TRet>(channel: string, args: TArgs): Promise<TRet>
  }
  i18n: {
    t(key: string, params?: Record<string, unknown>): string  // 自动展开 `ext.<id>.`
  }
  hermes: {
    callTool(tool: string, args: unknown): Promise<unknown>
  }
  notify(kind: "info" | "warn" | "error", message: string): void
}
```

### 4.3 命名 / 隔离规则

| 资源 | 实际 key 前缀 | 由谁加 |
|---|---|---|
| ipc channel | `ext.<id>.<channel>` | host 包装 expose / invoke |
| settings key | `ext.<id>.<key>` | host 透明改写 |
| storage 路径 | `<userData>/extensions-storage/<id>/<key>` | host |
| i18n key | `ext.<id>.<key>` | host 自动 prefix |
| command id | `<id>:<command>`（扩展自己写带冒号的） | 扩展 |

扩展之间禁止互相调对方的 ipc / command（host 不暴露列表）。一阶段不做扩展间通信。

## 5. Slot 协议（core 提供的扩展点）

Core desktop 第一阶段提供以下 slot anchor，扩展通过 manifest 的 `contributes` 静态声明 + RendererHost.slots.register 动态注入组件：

| Slot | 位置 | 多实例 | 说明 |
|---|---|---|---|
| `activityBar.item` | 左侧 ActivityBar | 多 | 每个扩展贡献的图标 + label + 跳转 sidebar view |
| `sidebar.view` | 左侧栏页面级 view | 单（按 activityBar 选中 id） | 替代 `sidebarView === "knowledge"` 那一段 |
| `settings.tab` | SettingsView 的 tab 列表 | 多 | 每个扩展自己的设置面板 |
| `composer.hint` | HomeView/Composer 顶部 hint pill | 多 | 取代当前 brain hint 的硬编码 |

注：当前 `FullScreenChatView` 的 `slots.emptyState`（由 desktop 注入 HomeView）一阶段**保持不动**，HomeView 仍由 core 提供。需要替换主面板的扩展能力（如 `mainPanel.view`）放到二期，避免一阶段过度抽象。

**Slot 解析顺序**：core 注册 SlotOutlet，extension-host 维护 `Map<slotId, RegisteredEntry[]>`。Outlet 按 `(extension.order, entry.order)` 排序渲染所有匹配项；single-slot（如 `sidebar.view`）按 activityBar 当前选中的 id 选 entry。

**ActivityBar 当前选中状态**：这是 core 的状态而非扩展状态（扩展不能"跨扩展"知道别人选中了什么）。core 维护 `selectedActivityId: string | null`，扩展通过 RendererHost.slots 注册的 sidebar.view 拿到 `anchor` 信息后由 host 决定何时挂载。

**关闭/单一 slot 切换**：扩展贡献的 ActivityBar item 被点击 → core 更新 `selectedActivityId` → host 卸载旧 sidebar.view、挂载新 sidebar.view。Core 永远不知道具体是 knowledge 还是别的。

## 6. 生命周期

### 6.1 启动顺序（Electron）

```
1. desktop main/index.ts: app.whenReady()
2. extensionHost.main.discover()        // 扫描 extensions/* 的 manifest
3. extensionHost.main.validateAndSort() // 校验 manifest + 处理 hermesPlugins 依赖
4. for each extension (按 manifest order):
     await extension.main.activate(MainHost)   // 注册 IPC、挂 lifecycle hook
5. await extensionHost.main.fireBootBackground()  // 并发 fire 所有 onBootBackground
6. createWindow()  → loads renderer
7. renderer 端 App.tsx mount 时：
     await extensionHost.renderer.discover()    // 拉取 manifest 列表（IPC）
     await extensionHost.renderer.loadAll()     // 并发 import() 所有 renderer 入口
     for each: extension.renderer.activate(RendererHost)
8. SessionsProvider 包裹下，<App/> 通过 <SlotOutlet/> 渲染扩展贡献
```

### 6.2 失败隔离

- 任一扩展 `activate` 抛错 → 标记为 `failed`，记录 error stack，继续加载其他扩展。
- Settings 加一个 **"Extensions"** tab（core 提供，非扩展本身）列出 `loaded` / `failed`，失败项可展开看 stack。
- 失败的扩展贡献的 manifest 静态部分（activityBar item / settings tab）依然显示，但点击时弹窗"该扩展加载失败"。这是为了让"知识库消失了"这种问题立刻可见，而不是"安静地不见了"。

### 6.3 卸载

- 第一阶段不支持运行时卸载。扩展 `disabled` 字段（在 Extensions tab 里切换）会写到 settings，**下次重启** desktop 才生效。
- `deactivate()` hook 定义了但只在 desktop 退出时调用（Electron `before-quit`）。

## 7. Hermes Plugin 关系

- Manifest `hermesPlugins[]` 一阶段语义：**声明 + 启动检查 + 提示**，不自动安装。
- 检查逻辑（MainHost.activate 阶段执行）：调 `hermes-agent` 的 plugins list API（已有），比对扩展声明：
  - `required: true` 且未装 → 扩展标记 failed，不进 activate；
  - `required: false` 且未装 → `host.notify("warn", ...)` 在 renderer 提示"知识库扩展需要 gbrain 插件，去 Settings → Extensions 查看"。
- **不**调 `hermes plugins install <id>`。装的事情交给现有 OnboardingWizard / 用户命令行。
- 二期再做自动装。

## 8. 加载器：第一阶段 vs 二期

| 维度 | 第一阶段（compile-time glob） | 二期（runtime FS） |
|---|---|---|
| manifest 来源 | `import.meta.glob("extensions/*/manifest.json")` (renderer) + `require` 同样路径 (main) | 扫 `<userData>/extensions/*/manifest.json` |
| renderer 入口 | `import.meta.glob("extensions/*/dist/renderer.js")` 静态映射 | 运行时 `import(file://...)` |
| main 入口 | desktop build 时一并打到 desktop main bundle | 运行时 `require(absolutePath)` |
| 卸载/安装 UI | 仅 enable/disable | 增加 install/uninstall/update |
| 沙箱 | 无 | （仍同进程，但加 permission prompt） |

`@hermes-x/extension-host` 的对外 API 在两阶段间保持一致 —— 二期只换 discover() 内部实现。

## 9. 知识库扩展迁移（具体清单）

### 9.1 新建 `extensions/knowledge-base/`

| 来源（core） | 去处（扩展） | 备注 |
|---|---|---|
| `apps/desktop/src/main/gbrain/{cli,client,launcher,provider-env,recipe-schema}.ts` | `extensions/knowledge-base/src/main/lib/*` | 原样复制，import 改 |
| `apps/desktop/src/main/gbrain/ipc.ts` | `extensions/knowledge-base/src/main/index.ts` | 改写：每个 `ipcMain.handle("gbrain:xxx", ...)` 改成 `host.ipc.expose("xxx", ...)` |
| `autoStartGBrainServeHttp` | 同上扩展 `host.lifecycle.onBootBackground(...)` | |
| `packages/ui/src/settings/SettingsBrain.tsx` | `extensions/knowledge-base/src/renderer/views/KnowledgePanel.tsx` | 改为注册到 `sidebar.view` |
| `packages/ui/src/settings/SettingsBrainConfig.tsx` | `extensions/knowledge-base/src/renderer/views/SettingsKnowledge.tsx` | 改为注册到 `settings.tab` |
| `packages/ui/src/settings/brain-install.ts` + HomeView 里的 brain hint | `extensions/knowledge-base/src/renderer/views/BrainDisconnectedHint.tsx` | 注册到 `composer.hint` |
| `packages/core/src/config.ts` 的 `BRAIN_URL_STORAGE_KEY` / `BRAIN_TOKEN_STORAGE_KEY` | 扩展内部 storage key（不再用全局 settings key） | 通过 `host.settings.get("brain.url", ...)` 拿，实际 key 是 `ext.io.hermes.knowledge-base.brain.url` |
| `packages/i18n/src/{zh-CN,en}.ts` 的 `options.brain.*` / `options.brainConfig.*` / `options.nav.brain` 全家桶 | `extensions/knowledge-base/src/i18n/{zh-CN,en}.json` | i18n key 前缀变 `ext.io.hermes.knowledge-base.*` |

### 9.2 Core 删除清单（grep 干净）

- `apps/desktop/src/main/index.ts` 删除 `registerGBrainHandlers` / `autoStartGBrainServeHttp` 引用。
- `apps/desktop/src/preload/index.ts` 删除 `gbrain` namespace 整段。改为只 expose `window.hermes.extensions.*` 通用桥（详见 §10）。
- `apps/desktop/src/renderer/global.d.ts` 删除 `gbrain` 类型字段。
- `apps/desktop/src/renderer/App.tsx` 不再 import `SettingsBrain` / `HomeView` 的 brain 相关代码；HomeView 的 brain hint 走 slot。
- `packages/core/src/config.ts` 删除 `BRAIN_URL_STORAGE_KEY` / `BRAIN_TOKEN_STORAGE_KEY` 常量定义。
- `packages/ui/src/`：删除 `settings/SettingsBrain.tsx` / `settings/SettingsBrainConfig.tsx` / `settings/brain-install.ts`。
- `packages/ui/src/chat/FullScreenChatView.tsx`：删除 `import SettingsBrain`、删除 `sidebarView === "knowledge"` 分支（改为 `<SlotOutlet name="sidebar.view" activeId={sidebarView} />`）。
- `packages/ui/src/chat/ActivityBar.tsx`：删除硬编码的 `id: "knowledge"` 项；ActivityBar items 改为 `core items + <SlotEntries name="activityBar.item">` 合并。
- `packages/ui/src/home/HomeView.tsx`：删除 `showBrainHint` / `buildBrainInstallPrompt` / `ensureBrainDefaultUrl` / `hasGBrainBridge` 整段逻辑；composer 上方改为 `<SlotOutlet name="composer.hint" />`。
- `packages/i18n/src/{zh-CN,en}.ts`：删除所有 `options.brain.*` / `options.brainConfig.*` / `options.nav.brain` key。

**验收**（在 `apps/desktop/src` 和 `packages/{core,ui,i18n,platform,utils}/src` 下）：

- `grep -rn '\bgbrain\b\|\bknowledge\b\|\bKnowledge\b\|GBrain\|BRAIN_' .` 返回 0 行。
- `\bbrain\b`（单词边界）也应返回 0 行；不用 `brain` 子串扫描，避免误匹配 `Acknowledge` / `breaking` 等。

## 10. Preload 桥

旧 `window.hermes.gbrain.*` 删除。新增通用桥 `window.hermes.extensions`：

```ts
window.hermes.extensions = {
  listManifests: () => Promise<ExtensionManifest[]>,
  invoke: (extensionId, channel, args) => Promise<unknown>,
  // 用 extensionId 而不是直接传完整 channel，避免渲染层伪造别的扩展 id
  rendererBundleUrl: (extensionId) => Promise<string>,
  i18nResources: (extensionId, locale) => Promise<Record<string, string>>,
}
```

renderer 侧的 RendererHost 把这层包成扩展自己的 API：`host.ipc.invoke(channel, args)` → `extensions.invoke(this.id, channel, args)`。

## 11. 新增 / 调整的包

| 包 | 类型 | 内容 |
|---|---|---|
| `packages/extension-host` | 新增 | main / preload / renderer 三个 sub-entry，包含 loader、registry、SlotOutlet、host 实现 |
| `packages/extension-api` | 新增 | 仅类型定义（`MainHost` / `RendererHost` / `SlotContext` / `SettingsSchema` / `ExtensionManifest` / `manifest.schema.json`），扩展实现作者 `import type` |
| `extensions/knowledge-base` | 新增 | 第一个扩展，完成 §9 的迁移 |
| `packages/ui` | 调整 | 把 ActivityBar / SettingsView / FullScreenChatView / HomeView 改为 SlotOutlet 风格 |
| `packages/i18n` | 调整 | 删 brain key；i18n 运行时支持外部表合并 + `ext.*` 前缀 |
| `packages/core` | 调整 | 删 `BRAIN_URL_STORAGE_KEY` / `BRAIN_TOKEN_STORAGE_KEY` 两个常量（其它文件如 `chat-engine-client.ts` 出现的 "brain" 是 `Acknowledge` 子串的误匹配，无需处理）|
| `apps/desktop` | 调整 | main / preload / renderer 接入 extension-host |

## 12. 测试策略

- `packages/extension-host` 单元测试：manifest 校验、依赖排序、failure isolation、slot registry 顺序。
- `extensions/knowledge-base` 集成测试：起 desktop dev 模式，验证：
  - ActivityBar 出现 Knowledge 图标；
  - 点击 → sidebar.view 是原 SettingsBrain 内容；
  - SettingsView 有 Knowledge tab；
  - Composer hint 在 gbrain 未连接时出现；
  - main 进程后台启动 `gbrain serve --http`，状态在 30s 内变 ready。
- Regression：CI 加 lint 规则（基于 §9.2 验收的 grep）禁止 `apps/desktop/src` 和 `packages/{core,ui,i18n,platform,utils}/src` 再次引入 `\bgbrain\b` / `\bknowledge\b` / `\bbrain\b` / `GBrain` / `BRAIN_` 字面量。

## 13. 错误处理 / 边界条件

- **扩展 main 端 activate 超时（>10s）**：标记 failed，记录 timeout。
- **renderer import() 失败**：UI 显示该扩展 failed，其余扩展正常加载。
- **i18n 文件缺失某语言**：fallback 到 en，缺 en 再 fallback 到 key 字面量。
- **IPC channel 冲突**：host 在 expose 时检测重复（同一扩展同 channel 重复 expose 抛错）。
- **slot 注册时 anchor 未在 manifest 声明**：开发期 warn，不阻塞。
- **未声明 permission 调对应 API**：开发期 warn，运行期允许（一阶段）；二期改为拒绝。

## 14. 实施阶段拆解

1. **阶段 0**：新建 `packages/extension-api`（仅类型）+ manifest JSON Schema，跑通 tsc。
2. **阶段 1**：新建 `packages/extension-host`，三入口的最小骨架（manifest 扫描 + 加载 + activate + IPC 路由 + SlotOutlet）。Desktop 接 host，但暂无任何扩展。
3. **阶段 2**：core 注入 SlotOutlet（ActivityBar / sidebar.view / settings.tab / composer.hint 四个 anchor），ActivityBar items 改为 "core items + extensions" 合并；其它视图（HomeView / chat）保持现状。
4. **阶段 3**：新建 `extensions/knowledge-base`，按 §9.1 迁移；core 按 §9.2 清理；i18n 切割；preload 桥替换。
5. **阶段 4**：Settings 加 "Extensions" tab（loaded/failed 列表，enable/disable toggle）。
6. **阶段 5**：跑通 E2E + regression lint，回归 onboarding 流程。

每阶段产物可独立合并、独立验证。

## 15. 后续二期入口

- 文件系统加载器（`<userData>/extensions/`）
- 扩展安装/卸载/升级 UI
- 自动安装声明的 hermes-plugin
- Permission prompt 模型
- 扩展间通信（如需要）
- 沙箱（iframe / utility process）
