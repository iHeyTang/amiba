# Amiba 桌面分发

当前发布代码位于 `feat/amiba-distribution` 独立工作区。发布仓库默认从 Git origin 读取（当前为 `iHeyTang/amiba`），CDN 和签名由发布者配置；没有内置第三方 GitHub 代理。

## 本地构建

使用 Git、Node 22.19+ 和 pnpm 9.12；首次运行 `pnpm install`。运行时包含独立 Node 和原生模块，必须在目标操作系统和 Node 架构下准备依赖与构建。

- Apple Silicon：`pnpm release:build darwin-arm64`
- Intel Mac：`pnpm release:build darwin-x64`
- Windows x64：`pnpm release:build win32-x64`

Apple Silicon 上的 Intel 构建可在独立 checkout 中，通过 Rosetta 运行 x64 Node 和 pnpm；不要复用 ARM 的 node_modules、运行时目录或输出目录。Windows 请使用本地 Windows x64 机器或 VM；当前没有验证 Mac 上 Wine 交叉编译原生依赖。

如果只想在配置发布服务前验证本地安装包，可运行 `pnpm release:build <target> --local-only`。此模式禁用更新源与 macOS 签名，产物不可通过发布脚本上传。默认正式发布模式要求代码签名成功。Windows 可使用 `pnpm release:build win32-x64 --allow-unsigned` 放宽证书要求并保留更新功能；已有签名配置仍会生效。Windows 可能显示未知发布者或 SmartScreen 提示。macOS 现有 Squirrel.Mac 自动安装依赖签名，`--local-only` 未签名测试包不支持该安装链路。

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

工作流 `.github/workflows/desktop-release.yml` 使用三个原生托管环境：Windows x64 (`windows-2022`)、Mac Intel (`macos-15-intel`)、Mac ARM (`macos-15`)。不需要把当前 Mac 注册为 runner。Node 固定为 22.22.0，Python 固定为 3.11，以兼容现有原生模块工具链。

在 Actions 的 **Desktop build and release → Run workflow** 中选择：

- `target=all`、`mode=test`：生成三个架构的未签名测试包，关闭客户端更新，产物保留在 Actions Artifacts 7 天。
- `target=win32-x64`、`mode=release`、`publish_draft=true`：生成 Windows 发布包并上传草稿 Release，允许没有代码签名证书。
- `target=all`、`mode=release`、`publish_draft=true`：三个架构发布包全部通过后，依次上传同一个草稿 Release。必须先配置 Mac 签名与公证 secrets。

也可在本机触发云端 Windows 构建：

```sh
gh workflow run desktop-release.yml --repo iHeyTang/amiba --ref feat/amiba-distribution \
  -f target=win32-x64 -f mode=release -f publish_draft=true
```

合并后将 `--ref` 改为 `main`。首次运行不需要本机 Windows 虚拟机。

推送 `v<桌面 package.json 版本>` 标签会触发所有架构的 release 构建并上传草稿；版本不匹配会失败。当前验证分支 `feat/amiba-distribution` 的普通 push 自动执行 test 构建。

构建后校验更新清单的版本、目标架构和 SHA-512，运行内置 Node 与 Electron 原生 PTY。Mac 额外校验 DMG 和 ZIP；Windows 在临时 CI 机器里静默安装 EXE 后检查安装结果。安装包生成后即保存 Artifacts，运行检查失败时也保留文件便于排查；只有检查通过才允许上传 Release。上传 Release 时先验证所有目标文件，再顺序上传，草稿绑定实际构建提交。

仓库 Variables 的 `AMIBA_UPDATE_URLS` 可指定 CDN 下载目录；GitHub 下载源作为兜底。发布用 Secrets：Mac 的 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；Windows 可选 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。

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

全部平台上传并确认 CDN 可访问后，在 GitHub 发布草稿。发布后运行 `pnpm release:verify-online <target>`，它会逐个下载 CDN 与 GitHub 上的安装包、blockmap 和清单，并对照本地发布记录校验 SHA-512；该命令会产生完整安装包下载流量。首次分发前应在真实安装环境上完成一次版本 N → N+1 更新：检查每个架构命中正确 ZIP/EXE、网络中断重试、CDN 故障回退、校验失败拒绝安装、应用退出与重启后版本变化。

## 客户端行为

打包版本启动 30 秒后检查，此后每 6 小时检查。发现更新后后台下载，用户从左下角菜单查看进度并选择“重启并安装”。下载完成后不会在后台强制重启。安装前执行应用现有运行时关闭流程。

开发运行或没有内嵌源配置时显示此构建不支持更新。手动检查与后台检查共用任务，避免重复下载；所有源失败后显示错误并允许重试。

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
