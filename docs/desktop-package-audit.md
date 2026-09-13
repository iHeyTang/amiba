# 桌面安装包体积审计与分发边界

日期：2026-09-13。审计对象：本地已有 macOS ARM 安装产物及当前打包/运行时代码。体积来自文件目录和 ASAR 索引，均为未压缩 MiB 近似值；不代表最新云端构建逐字节一致。WorkBuddy 的 400 多 MB 是用户提供的下载体积，未独立测量其安装内容。

## 结论

当前包体积存在明确的打包污染和重复资源，不能把整个 1.3GB 运行时目录都当作 Agent 的必要成本。应先修复无功能影响的冗余，再设计可选功能的组件分发；不以删除现有功能换取安装包数字。

比较口径：本地 Amiba DMG 约 737 MiB，更新 ZIP 约 752 MiB，Actions 合集约 1.5 GiB；安装后约 2.1 GiB。1.3 GiB 是其中 DSH 运行时展开后的目录。

## 实测发现

- app.asar 约 599 MiB；其中 @amiba/app-runtime 约 398.2 MiB。
- ASAR 中 app-runtime/.cache 约 233 MiB，是 npm 下载缓存，不应分发。
- ASAR 中 app-runtime/resources 约 164.6 MiB，包括一份约 106.5 MiB 的 Node；DSH 运行时已经通过 extraResources 单独放置，应消除这份重复路径。
- ASAR 的 source map 共约 82.4 MiB；DSH runtime 的 source map 共约 171 MiB。应上传到内部诊断制品，按构建 SHA 保留，不随普通安装包分发。
- DSH runtime 的 onnxruntime-node 约 210 MiB，其中 darwin/arm64 约 35 MiB、Linux 约 52 MiB、Windows 约 124 MiB。当前 ARM 包无需 Linux/Windows 二进制。
- onnxruntime-web 约 130 MiB。由 Transformers.js 引入；不能未经验证直接删除整个包，需要选择 Node 后端、梳理模块导入，并测试本地 embedding。
- Node 完整发行包约 189 MiB，包括约 64 MiB 的 include。运行基本 Agent 不需要编译头文件；扩展原生模块构建所需的头文件应归开发工具组件。
- runtime 的类型声明共约 67.4 MiB。大部分属于开发用途，但应审计是否有动态 TS 编译/插件开发依赖，不能一刀切删除源码或 .ts 文件。
- 记忆依赖链：@amiba/dsh-plugin-memory-memos -> @memtensor/memos-local-plugin -> @huggingface/transformers -> onnxruntime-node、onnxruntime-web、sharp。
- MemOS LocalEmbeddingProvider 已使用动态 import 加载 Transformers，适合在加载前增加 ensureComponent；当前尚无该组件管理机制。
- UI 依赖及重复分发：ASAR 里还存在 mermaid 约 72.7 MiB、lucide-react 约 19.9 MiB、simple-icons 约 15 MiB 等完整包。桌面 renderer 已打包，但 DSH 插件还有动态模块路径，应分别追踪外部 import 再决定是否删除。

以上分类存在包含关系，不能简单相加作为压缩包节省量。先构建精简产物，再实测压缩大小。

## 应随基础安装包携带

1. Electron 及其当前平台架构的框架资源。
2. 已编译的主进程、preload、renderer、必要静态资源、许可证与第三方声明。
3. DSH 核心、默认会话/工具/权限/持久化所需插件及真正运行时依赖。
4. 一个独立 Node 可执行运行时。当前 DSH 以独立 Node 子进程运行，不依赖用户系统 Node；复用 Electron Node 是另一个架构变更，不作为本轮快速减包手段。
5. 当前 OS/架构及正确 ABI 的 PTY、SQLite、快捷键等原生模块。Electron 与独立 Node 的模块 ABI 不一定相同，不盲目合并 .node 文件。
6. 必需的证书、默认配置、版本/兼容性清单、更新检查与下载管理器。
7. 插件加载器与必要的包安装能力。当前支持 registry 插件安装，先保留实际需要的包管理器，验证调用链后再处理 npm/pnpm 的重叠。

基础聊天、会话历史、文件与终端工具不应因为可选组件下载失败而无法启动。云端模型推理仍需要网络，这与本地基础运行环境的完整性分开验收。

## 不进入基础包，以及替代处理

| 类别 | 处理 |
| --- | --- |
| npm/pnpm 缓存、CI 缓存、临时构建目录 | 仅留构建机或 CI Cache；不需要用户补下载 |
| 重复运行时和已打包 UI 的重复依赖 | 保留实际被加载的一份；依赖闭包和动态 import 测试后清理 |
| 非目标平台/架构二进制 | 构建时剔除；每个平台包只携带对应文件 |
| source map、测试、示例、开发配置 | CI 内部诊断制品；保留法定许可证和被运行时读取的资源 |
| Node 头文件、编译器、插件 HMR/开发依赖 | 按需开发组件或用户开发工具；原生扩展优先 CI 预编译，不在普通用户设备上临时编译 |
| 本地 embedding 引擎及模型 | 首次启用本地记忆/检索时安装对应平台组件；在线 embedding 可作为显式配置选项，不静默上传用户数据 |
| 大型模型、OCR、语音、额外浏览器等功能资源 | 仅在产品提供并启用对应功能时下载；不预装所有后端和所有模型 |
| 非默认集成插件 | 插件中心按需安装；若某功能属于默认承诺，先维持可用，不能直接隐藏或移除 |

## 按需组件的交付机制

- 用户启用功能 -> 检查兼容组件 -> 显示下载大小/进度 -> 下载 -> 校验 -> 解压到暂存目录 -> 运行自检 -> 原子切换 -> 启用功能。
- 清单包含组件 ID、版本、OS/架构、Node 或 Electron ABI、最低/最高支持的宿主或协议版本、字节数、SHA-512、下载源及可信签名。
- CI 在原生 runner 上预编译，上传 GitHub Release 与未来 CDN POST 接口；客户端通过配置的 HTTPS GET 下载地址获取清单和包。POST 仅用于发布者上传。
- 使用用户数据目录，例如 macOS Application Support/Amiba/components、Windows LocalAppData/Amiba/components；模型和组件缓存单独存放，不写入已签名 .app。
- 提供国内 CDN 优先、多源回退、断点续传、下载重试、并发去重、磁盘空间检查；校验成功前不加载。
- 下载或初始化失败时保持主程序可用，明确显示相关功能不可用及重试入口，不假装功能成功。
- 组件版本固定，独立于应用版本；升级主程序时检查兼容性，保留旧组件用于回滚。组件卸载不删除用户记忆和会话数据。
- 提供离线组件包导入，供国内网络受限或离线环境使用。
- Transformers.js 提供 localModelPath/cacheDir 等配置，可用于模型缓存管理；仍需适配 MemOS 当前调用路径。

## 实施顺序与验收

第一阶段：创建干净的 staging 分发目录、明确允许文件和外部依赖；剔除缓存、重复 resources、非目标平台二进制及调试资源。禁止直接对开发环境 node_modules 做破坏性裁剪。

第二阶段：将本地推理和开发工具从基础依赖图拆出；建立组件下载、兼容校验及恢复机制。只从安装包删除依赖而保留静态导入会造成启动失败，必须同时改加载方式。

第三阶段：三平台 CI 输出按目录/包/扩展名的体积报告，分别记录安装包、展开目录和可选组件体积，设置基线增量与绝对上限，防止以后缓存再次进入产物。

验收：新机器启动、会话与历史、文件和终端、原生模块、默认插件、registry 插件安装、记忆启用前后、下载失败与断点恢复、离线导入、组件/主程序更新与回滚、签名完整性。对 Mac 分别验收 Intel/ARM。

可把单平台基础安装包 400 MiB 以内作为优化目标；这是待实测的目标，不是当前已有结果，也不能据未压缩删减量直接推算。

## 参考

- electron-builder 文件收集与额外资源：https://www.electron.build/docs/contents/ （当前网站可能高于项目版本；实现时以项目安装的 25.1.8 为准）
- Transformers.js 模型目录和缓存配置：https://huggingface.co/docs/transformers.js/api/env
- WorkBuddy 官方安装说明：https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide （未提供足以推断其内部组件组成的证据）
