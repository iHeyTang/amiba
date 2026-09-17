# Amiba 桌面分发

发布仓库默认从 Git origin 读取（当前为 `iHeyTang/amiba`），CDN 和签名由发布者配置；没有内置第三方 GitHub 代理。

## 版本管理

产品版本唯一来源是 `apps/desktop/package.json`。UI 设置页和菜单在构建时直接读取该版本，桌面更新桥读取 Electron `app.getVersion()`，安装包、更新清单与 Release 标签使用相同版本。根 package.json 由 worktree 内的升版命令同步；内部 workspace 包有自己的版本，不作为产品版本。

先在独立 worktree 的功能分支执行以下命令，并通过 PR 合并两个版本文件：

```sh
pnpm release:version patch # 0.1.0 -> 0.1.1
pnpm release:version minor # 次版本加一，patch 归零
pnpm release:version major # 主版本加一，其余归零
pnpm release:version:check
```

版本 PR 合并后，在 **Actions → Desktop Release → Run workflow** 选择 `main`，`mac_signing` 默认 `unsigned`。流水线只读已合并的版本和源码，检查配置、并发构建三个平台、检查并回读全部附件、生成更新说明，最后公开 Release。不会创建版本提交或更新 main；当前版本已发布时，必须先通过新的版本 PR 升版。

Actions 软件包直接保留 `Amiba-<版本>-<系统>-<架构>.dmg/.zip/.exe` 文件名，内部校验文件放在 `metadata-<版本>-<平台架构>`。latest 更新清单保持固定名称，供客户端查询。历史 Artifacts 不会自动改名。

产物清单记录版本、源码 SHA、构建编号、模式和工作区是否有未提交内容。正式本地构建要求工作区干净。发布前验证产物来自预期提交；同一 CI 发布的所有平台还必须属于同一运行和重试编号。

正式构建在准备运行时之前查询 GitHub 的全部 Release：版本必须高于所有已发布稳定版本，公开同版本禁止覆盖；同版本草稿和已有标签必须指向本次源码提交。上传时再次检查，避免构建期间发布状态发生变化。旧草稿来自其他提交时必须升版，或显式清理旧草稿后重新发布，脚本不会自动覆盖它。正式构建需要已登录 gh，CI 使用 github.token。

旧构建缺少来源记录，不能通过新的发布校验，需要重新构建；Windows verify 模式仍兼容旧 Artifact 名称用于安装验证。当前 `v0.1.0` 历史草稿属于早期提交，新版本必须先通过版本 PR 合并，不覆盖它。

## 安装包内容与体积检查

发布构建会创建独立的 `.package-resources/dsh-runtime` 副本，排除构建缓存、JS/CSS/TS source map，以及 ONNX 中非目标 OS/架构的二进制；开发运行时不受影响。ASAR 同时排除 workspace 包内重复的 DSH resources。打包完成、签名之前检查实际内容，禁止这些文件再次进入产物。

记忆插件、Transformers、目标平台 ONNX、ONNX Web、npm/pnpm 和 Node 编译头文件保留；本次没有改成按需下载。每次构建保存 `package-footprint.json`，包含裁剪字节数与最终资源目录统计。安装检查还会用内置 Node 执行小型离线 ONNX 图，并加载 Transformers 和 MemOS 适配器，不下载模型。

ONNX 1.24.3 的 npm 包缺少 Darwin x64 原生绑定（上游 microsoft/onnxruntime#27961），因此 Intel Mac 使用单独锁文件，将 Node 推理库固定为 1.22.0；ARM/Windows 保持原依赖。更新依赖锁时需分别运行 `pnpm runtime:lock` 和 `pnpm runtime:lock --lock-target=darwin-x64`，提交宿主与各插件的锁文件及对应 manifest；Intel 的差异锁位于记忆插件的 `distribution/darwin-x64/`，不再位于宿主目录。详见 [插件分发](plugin-distribution.md)。

可以用 `AMIBA_DSH_SMOKE_RUNTIME_DIR=<已打包运行时绝对路径> AMIBA_DSH_SMOKE_CHECK=MemOS node packages/app-runtime/scripts/dsh-runtime/smoke.mjs` 验证成品中的 DSH 启动、插件安装与 MemOS 就绪状态。测试使用独立临时用户目录。

## 本地构建

使用 Git、Node 22.19+ 和 pnpm 9.12；首次运行 `pnpm install`。运行时包含独立 Node 和原生模块，必须在目标操作系统和 Node 架构下准备依赖与构建。

- Apple Silicon：`pnpm release:build darwin-arm64`
- Intel Mac：`pnpm release:build darwin-x64`
- Windows x64：`pnpm release:build win32-x64`

Apple Silicon 上的 Intel 构建可在独立 checkout 中，通过 Rosetta 运行 x64 Node 和 pnpm；不要复用 ARM 的 node_modules、运行时目录或输出目录。Windows 请使用本地 Windows x64 机器或 VM；当前没有验证 Mac 上 Wine 交叉编译原生依赖。

如果只想在配置发布服务前验证本地安装包，可运行 `pnpm release:build <target> --local-only`。此模式禁用更新源与 macOS 签名，产物不可通过发布脚本上传。本地默认正式构建要求签名。使用 `pnpm release:build <target> --allow-unsigned` 可生成未签名发布包：Windows 保留更新功能；Mac 关闭更新源、签名和公证，改为写入用于应用内检测与下载的 `manual.repository`。`--local-only` 仍是不可发布的测试包。未签名 Mac 发布不上传 Mac latest 清单和 blockmap，避免向客户端声明可自动安装的更新。

Rosetta 下使用 Intel Node 的示例（`/path/to/node-darwin-x64` 换为已校验的官方 x64 Node 解压目录，在独立 checkout 内运行）：

```sh
export PATH="/path/to/node-darwin-x64/bin:$PATH"
node -p 'process.arch' # 必须输出 x64
pnpm install --frozen-lockfile
pnpm release:build darwin-x64 --local-only
```

构建前设置环境变量（Windows 使用 PowerShell 的 `$env:NAME='value'`）：

```sh
export AMIBA_GITHUB_REPOSITORY='your-org/amiba'
export AMIBA_UPDATE_URLS='https://your-cdn.example/amiba/stable'
pnpm release:build darwin-arm64
```

`AMIBA_UPDATE_URLS` 支持逗号分隔多个 HTTPS 目录，按顺序优先尝试，最后回退公开 GitHub Releases。该配置写入安装包，终端用户无需配置环境变量。没有 CDN 时可省略，但国内访问体验无法保证。

产物分别位于 `apps/desktop/dist/<platform>-<arch>/`。macOS 生成 DMG、ZIP，Windows 生成 NSIS EXE，同时输出 blockmap 和架构独立的更新清单：

- ARM Mac：`latest-arm64-mac.yml`
- Intel Mac：`latest-x64-mac.yml`
- Windows：`latest-x64.yml`

macOS 自动更新必须签名；面向公开分发还需 Apple Developer ID 和公证。按 electron-builder 25 的环境变量配置 `CSC_LINK`、`CSC_KEY_PASSWORD` 及 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`，或使用其支持的 API key。Windows 配置对应代码签名证书。不要向仓库提交证书或密码。

## GitHub Actions 构建

测试打包 `desktop-build.yml` 和正式发布 `desktop-release.yml` 使用三个原生托管环境：Windows x64 (`windows-2022`)、Mac Intel (`macos-15-intel`)、Mac ARM (`macos-15`)。不需要把当前 Mac 注册为 runner。Node 固定为 22.22.0，Python 固定为 3.11，以兼容现有原生模块工具链。

在 Actions 的 **Desktop Build → Run workflow** 中选择：

- `target=all`、`mode=test`：生成三个架构的未签名测试包，关闭客户端更新，产物保留在 Actions Artifacts 7 天。
- `target=all`（或单个平台）、`mode=verify`、`run_id=<已有构建 ID>`：复用原安装包验证运行，不重新编译、不发布。Windows 静默安装 EXE，Mac 解压更新 ZIP 并检查 DMG。

正式发布使用独立的 **Desktop Release → Run workflow**，固定构建全部三个平台，先通过 CI 检查，再使用已合并版本构建、校验、生成更新说明并公开 Release。`mac_signing=unsigned` 不需要 Apple 凭据；选择 `signed` 时必须先配置 Mac 签名与公证 secrets。

也可在本机触发云端三平台发布构建：

```sh
gh workflow run desktop-release.yml --repo iHeyTang/amiba --ref main \
  -f mac_signing=unsigned
```

手动运行时选择 `main` 分支。首次运行不需要本机 Windows 虚拟机。

PR 和合并到 `main` 后运行 `ci.yml`（保留必需检查名称 `PR checks`）以及 `runtime-dependencies.yml` 的三平台运行时集成验证，不生成安装包、不发布版本。测试安装包仅通过 `desktop-build.yml` 手动构建，目前不配置定时任务。正式发布仅通过 `desktop-release.yml` 手动触发，版本号必须预先通过 PR 合并，流水线不会写入 main。安装包构建和发布仅支持 main，其他分支和标签不会触发自动打包。

构建后校验更新清单的版本、目标架构和 SHA-512，运行内置 Node 与 Electron 原生 PTY。Mac 额外校验 DMG 和 ZIP；Windows 在临时 CI 机器里静默安装 EXE 后检查安装结果。安装包检查通过后保存为独立 Artifacts；运行检查失败时保留 metadata 与日志便于排查；只有全部平台检查通过才允许上传 Release。上传 Release 时先验证所有目标文件，再顺序上传，草稿绑定实际构建提交。CI 上传后再次下载草稿资产，并按原构建记录检查 SHA-512。全部通过后使用 GitHub 自动生成更新说明，将草稿发布并设为 Latest。

仓库 Variables 的 `AMIBA_UPDATE_URLS` 可指定 CDN 下载目录；GitHub 下载源作为兜底。选择 `mac_signing=signed` 时使用 Secrets：Mac 的 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；Windows 可选 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。

发版前检查下载源配置；仅 `mac_signing=signed` 要求五项 Mac Secrets 齐全，缺配置时停止。版本号通过 PR 提前更新；流水线不递增版本、不创建版本提交。构建和发布固定检出本次运行的提交 SHA，避免 main 后续变化混入产物。只有发布作业需要 `contents: write` 以创建 Release 和标签。

失败后优先使用该次运行的 **Re-run failed jobs**，复用本次运行固定的源码提交和产物。如果重新执行 Prepare 时 main 已变化，会停止并要求从当前 main 新建发布运行。新运行仍使用已合并的版本，不自动升版，已发布版本会被预检拒绝。发布作业成功后因网络等原因重试时，只回读验证已有资产，不覆盖公开版本。

## GitHub 和国内 CDN

先执行 `gh auth login`；仓库应为公开发布仓库，客户端不包含 GitHub 凭据。

```sh
pnpm release:build darwin-arm64 --upload
# 也可单独上传已有产物
pnpm release:upload darwin-arm64
```

上传创建或复用版本号对应的草稿 Release。不同机器可以依次上传三个目标，发布前确认全部到齐。已发布版本拒绝覆盖，必须增加 `apps/desktop/package.json` 中的版本。

CDN 暂未选定，已预留 POST 上传适配器 `scripts/release/post-upload.mjs`，不依赖具体云存储 SDK。配置后执行：

```sh
export AMIBA_CDN_UPLOAD_URL='https://your-api.example/releases/upload'
# 可选：AMIBA_CDN_UPLOAD_TOKEN 提供 Bearer token，只在发布机器使用
pnpm release:cdn darwin-arm64
```

预留接口契约：`multipart/form-data` POST，包含 `file`、`name`、`version`、`target`、`sha512`、`kind`；`kind` 为 `artifact` 或 `metadata`。2xx 表示文件已保存并可访问；接口契约确定后只需修改适配器。安装包上传完成后才上传更新清单，任何失败都会停止，不自动重试可能已提交的 POST。

上传接口与客户端下载地址分开：`AMIBA_CDN_UPLOAD_URL` 用于发布机器 POST 上传，`AMIBA_UPDATE_URLS` 用于客户端 GET 清单与安装包。上传凭据不会打进客户端。未配置 CDN 下载源时，客户端使用 GitHub。

CDN 更新清单应采用短缓存或不缓存；版本化安装包可长期缓存。服务需支持 HTTPS、GET、HEAD、Range，并保留原始文件字节。

本地手动发布时，全部平台上传并确认 CDN 可访问后，在 GitHub 发布草稿。GitHub 一键流程当前自动发布到 GitHub；CDN POST 仍是预留的独立适配器，待接口确定后接入。发布后运行 `pnpm release:verify-online <target>`，它会逐个下载 CDN 与 GitHub 上的安装包、blockmap 和清单，并对照本地发布记录校验 SHA-512；该命令会产生完整安装包下载流量。首次分发前应在真实安装环境上完成一次版本 N → N+1 更新：检查每个架构命中正确 ZIP/EXE、网络中断重试、CDN 故障回退、校验失败拒绝安装、应用退出与重启后版本变化。

## 客户端行为

打包版本启动 30 秒后检查，此后每 6 小时检查。发现更新后后台下载，用户从左下角菜单查看进度并选择“重启并安装”。下载完成后不会在后台强制重启。安装前执行应用现有运行时关闭流程。

开发运行或没有内嵌源配置时显示此构建不支持更新。手动检查与后台检查共用任务，避免重复下载；所有源失败后显示错误并允许重试。

## 已完成的云端验证（2026-09-12～13）

| 目标 | 结果 | 运行记录 |
| --- | --- | --- |
| Mac ARM | DMG/ZIP 校验、内置 Node、Electron PTY 通过并上传 Artifacts | [构建任务](https://github.com/iHeyTang/amiba/actions/runs/34700278843/job/103570718220) |
| Mac Intel | DMG/ZIP 校验、内置 Node、Electron PTY 通过并上传 Artifacts | [构建任务](https://github.com/iHeyTang/amiba/actions/runs/34700278843/job/103570718233) |
| Windows x64 | 构建、静默安装、内置 Node、Electron PTY、Release 上传与回读校验通过 | [完整发布验证](https://github.com/iHeyTang/amiba/actions/runs/34703422870) |

Windows `v0.1.0` 已由 Actions 上传为草稿 Release，包含 EXE、blockmap 和 `latest-x64.yml`；源提交为 `bb21937fc78604eede7cc3eb1eca9e97030714b2`。上传后重新下载的所有文件均通过原始构建记录的 SHA-512 校验。

Windows 托管机器上的实际安装约需 6 分半钟，检查允许最多 15 分钟；完整运行时使安装包和安装耗时较大。Mac 云端包为关闭自动更新的未签名测试包。Artifacts 保留 7 天。

## 尚需真实环境验证

脚本和状态测试不等同于三个平台安装验证。公开分发前仍需 Mac Developer ID 签名、公证，以及真实版本升级验收。CDN 按当前需求只预留 POST 接口。不要把仅能打包的 unsigned Mac 构建视作已验证的自动更新发布版本。

## 本机 Windows 构建调查（2026-09-12）

- 此 Mac 为 Apple Silicon；Docker Desktop 已安装，启动后报告 `linux/aarch64`。
- `node-pty` 与 `uiohook-napi` 的现有包包含 Windows x64 预编译文件，但这不能证明整个运行时可交叉构建。
- Homebrew `wine-stable` 当前被标记为 disabled，原因是 `fails_gatekeeper_check`。
- 实测官方 `electronuserland/builder:wine`（digest `sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64`，Wine 11.0）在 `linux/amd64` 下运行校验过的官方 Windows Node 22.22.0 x64 时，启动即退出 134：

```text
wine: dlls/ntdll/unix/virtual.c:267: anon_mmap_fixed:
Assertion `!((UINT_PTR)start & host_page_mask)' failed.
qemu: uncaught target signal 6 (Aborted)
```

Docker 的 `UseVirtualizationFramework` 与 `UseVirtualizationFrameworkRosetta` 均为 true。设置独立 `WINEPREFIX` 和 `WINEARCH=win64` 后同样失败，因此当前没有可用的 Windows Docker/Wine 构建证据；失败发生在执行项目代码之前。

本机 Windows 虚拟机仍是一条可行的环境路线。Apple Silicon 可运行 Windows 11 ARM，再使用 **x64 Node** 运行构建脚本；Windows ARM 的 x64 应用模拟能力由 Microsoft 支持，但 amiba 全套构建、安装与更新仍需实测。也可继续调查 Wine/模拟层兼容性，不应把上述特定组合失败理解为所有 Mac 均不能构建 Windows。

参考：[Microsoft x64 模拟说明](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation)、[UTM Windows 安装指南](https://docs.getutm.app/guides/windows/)、[Homebrew Wine 状态](https://formulae.brew.sh/cask/wine-stable)。

GitHub 发布仓库已在线确认是公开的 `iHeyTang/amiba`，当前 CLI 身份具有 ADMIN 权限，调查时尚无 Release。CDN 现阶段按需求只保留 POST 适配器，未选定实际接口不会阻塞本轮适配代码。


### Actions 下载入口

每个平台通过 `upload-artifact@v7` 的 `archive: false` 单独上传带版本号的安装文件：
`Amiba-<version>-mac-arm64.dmg`、`Amiba-<version>-mac-x64.dmg`、`Amiba-<version>-win-x64.exe`。
点击单个安装文件即可下载原始 DMG/EXE；不要选择下载全部 artifacts。
Mac 更新 ZIP 同样直接上传，和 DMG 同名，仅后缀不同。blockmap、更新清单、构建 manifest 和体积清单保存在小型 `metadata-<version>-<target>` 中，供发布与复验使用。诊断信息写入作业日志，不再单独上传 reports。
安装文件和更新 ZIP 只在该平台冒烟检查通过后上传；失败时保留 metadata 和日志供排查。
工作流统一命名为 `Amiba Desktop`，运行标题使用 `Build / Verify / Release · All platforms`（单平台显示 `Windows x64`、`macOS Intel` 或 `macOS ARM`），作业 Summary 只提供原始文件下载链接及测试包状态。

`mode=verify` 支持 `target=all`，可在同一次运行中复验原有三个平台的安装包，无需重建。
同时兼容历史 artifact 布局；新的 DMG/EXE/ZIP 均保留原始文件名与内容，下载时禁止自动解压更新 ZIP；拆分文件在执行前按原始 manifest 校验 SHA-512。
例如：

```sh
gh workflow run desktop-build.yml --ref main -f mode=verify -f target=all -f run_id=<原始构建运行ID>
```

一键发版自动汇总同一构建的三个平台，通过独立 Desktop Release 工作流触发，使用已通过 PR 合并的版本。
流水线会重新合并分开下载的安装文件和更新文件，验证三个平台的版本、源码提交、构建 ID 与文件哈希后，逐个上传为独立 Release assets，全部回读验证通过后自动生成更新说明并发布。
测试/复验不会创建 Release。Mac 未签名发布允许手动分发；要启用 Mac 自动更新，需选择 `mac_signing=signed` 并配置签名与公证。


2026-09-13 验证记录：

- [首次三平台拆分上传](https://github.com/iHeyTang/amiba/actions/runs/34740759104)：三个平台成功。
- [读取拆分产物再次复验](https://github.com/iHeyTang/amiba/actions/runs/34741097285)：三个平台成功，包含原始安装文件下载、manifest 完整性校验及原生运行检查。
- 独立安装文件大小：ARM DMG 379,388,623 字节；Intel DMG 382,063,658 字节；Windows EXE 327,434,217 字节。下载响应为原始文件名，没有 ZIP 外壳。
- 这两轮复用了原始构建 `34736708616` 的 0.1.0 测试包；manifest 保留原始源码提交及构建 ID，不将复验提交冒充安装包来源。
- 本地发布工具 15 项测试通过；另验证三平台拆分文件合并，以及最后一个平台文件被篡改时整批上传前拒绝（上传命令使用替身，未修改 GitHub Release）。


## 历史一键发版验证（2026-09-13）

以下记录发生在 PR-only 规则之前；其中直接提交版本到 main 的流程已废止。

发布工具 21 项测试通过；使用模拟 GitHub CLI/API 和小型三平台文件执行实际 ci-upload/upload 脚本，验证上传、回读哈希、自动更新说明、公开发布、发布作业幂等重试，以及损坏文件在远端修改前被拒绝。

[真实 Release 配置预检](https://github.com/iHeyTang/amiba/actions/runs/34743078625) 在 Prepare 阶段按预期报告缺少五项 Mac Secrets，main 未发生自动版本提交，版本保持 0.1.0，也没有创建或发布新 Release。该次预检未执行真实签名、公证或公开发布；后续未签名发布结果见下文。


### 未签名发布

当前默认允许未签名发布。Mac 使用无需账号、证书和网络的 ad-hoc 本地签名封装完整应用，不提供 Apple Developer ID 身份认证，也不进行公证。运行时命令链接转换为包内相对路径；构建和成品检查执行 codesign 严格校验。Mac 包的 `release-config.json` 更新源为空，改为写入 `manual.repository`，运行检查会同时验证这两点；公开 Release 只提供 Mac DMG/ZIP，不提供 Mac 自动更新清单。Windows 保留 EXE、blockmap 和更新清单。Release 说明自动提示 Mac 安装限制。

未签名 Mac 包因此走「检测 + 下载 + 手动安装」通道：应用按 `manual.repository` 读取该仓库最新 Release，发现更高版本后在更新弹窗里给出下载按钮；下载完成并比对 Release 公布的 sha256 后提示安装包就绪，点击即退出应用并由系统打开 DMG 安装窗口，由用户拖拽完成替换。未签名包没有可校验的签名身份，因此该通道只做检测与下载，绝不自动安装；完整性完全依赖 HTTPS 与 Release 公布的摘要。`manual.repository` 只在未签名 Mac 构建中写入，本地测试包（`--local-only`）不写。

用户从网络下载 Mac 包后，系统可能拦截启动；可根据 [Apple 官方说明](https://support.apple.com/102445) 在“系统设置 → 隐私与安全性”中手动允许该应用。后续 Mac 版本由应用内检测并下载安装包，退出后打开安装窗口由用户拖拽安装，无需再自行寻找下载地址；切换到签名版时仍需要安排一次手动安装。


### 首次公开发布验证（2026-09-13）

[Release v0.1.2](https://github.com/iHeyTang/amiba/releases/tag/v0.1.2) 已公开并设为 Latest；[完整流水线](https://github.com/iHeyTang/amiba/actions/runs/34744099935) 全部成功。采用 `mode=release,target=all,mac_signing=unsigned,bump=patch`，自动提交统一版本、构建三平台、上传回读校验、生成说明并发布。tag 与安装包源码均为 `26c3dbe99d76ad97d506fd85cfd7427c5f2983e4`。

- macOS ARM DMG：382,926,734 字节；Intel DMG：387,194,022 字节；Windows EXE：327,434,008 字节。
- 公开附件共七个：两组 Mac DMG/ZIP、Windows EXE/blockmap/latest-x64.yml；无 Mac 自动更新清单。
- 三平台均通过安装文件完整性、包内 Node、原生 ONNX CPU 推理、Transformers/MemOS 加载及 Electron 原生 PTY 检查。Mac 另通过 ad-hoc 严格校验和更新源为空检查；Windows 实际执行静默安装。
- 发布作业重新下载三平台公开附件并按构建 manifest 验证哈希后才公开；发布后再次确认 Latest、tag 源码与无需认证即可下载的 Windows 更新清单。
- 发布工具本地 24 项测试通过。Apple Developer ID 签名、公证和跨版本自动升级仍未实测；当前 Mac 使用手动安装更新，Windows 保留自动更新配置。

0.1.1 的首次运行在公开前主动取消，用于修复 Mac 本地封装签名和运行时绝对链接；没有发布该版本，重新执行流水线正常递增至 0.1.2。CDN POST 接口仍待配置，本次通过 GitHub 分发。


### Mac 安装窗口提示

未签名发布和本地测试 DMG 的安装窗口直接显示首次打开被拦截时的“系统设置 → 隐私与安全性 → 仍要打开”指引。提示使用普通/Retina 两套背景图片，图标位于提示上方；已签名发布不显示未认证提示。

`package-mac.mjs` 在压缩 DMG 前通过 Finder 写入原生背景引用、窗口大小和图标位置，避免 dmg-builder 25 生成的旧引用在新版 macOS 上显示白底。该步骤需要构建机具备 Finder 图形会话；自托管 Mac 构建机需登录桌面。本机已实际重新打包、只读挂载并截图确认文字完整、图标不遮挡。此项尚未在 GitHub macOS runner 上复验。

背景源文件为 `scripts/release/assets/render-dmg-background.swift`，在 macOS 执行即可重新生成 PNG；正常打包直接使用已提交的图片，无需运行 Swift。改动随下一次构建生效，已发布的 v0.1.2 附件不覆盖。
