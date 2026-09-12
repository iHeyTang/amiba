# Amiba 桌面分发

当前发布代码位于 `feat/amiba-distribution` 独立工作区。发布仓库、CDN 和签名由发布者配置；没有内置第三方 GitHub 代理。

## 本地构建

使用 Node 22.19+ 和 pnpm 9.12；首次运行 `pnpm install`。运行时包含独立 Node 和原生模块，必须在目标操作系统和 Node 架构下准备依赖与构建。

- Apple Silicon：`pnpm release:build darwin-arm64`
- Intel Mac：`pnpm release:build darwin-x64`
- Windows x64：`pnpm release:build win32-x64`

Apple Silicon 上的 Intel 构建可在独立 checkout 中，通过 Rosetta 运行 x64 Node 和 pnpm；不要复用 ARM 的 node_modules、运行时目录或输出目录。Windows 请使用本地 Windows x64 机器或 VM；当前没有验证 Mac 上 Wine 交叉编译原生依赖。

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

## GitHub 和国内 CDN

先执行 `gh auth login`；仓库应为公开发布仓库，客户端不包含 GitHub 凭据。

```sh
pnpm release:build darwin-arm64 --upload
# 也可单独上传已有产物
pnpm release:upload darwin-arm64
```

上传创建或复用版本号对应的草稿 Release。不同机器可以依次上传三个目标，发布前确认全部到齐。已发布版本拒绝覆盖，必须增加 `apps/desktop/package.json` 中的版本。

配置 rclone 的 OSS、COS 或 S3 兼容 remote，以及映射到其目录的 CDN：

```sh
export AMIBA_CDN_REMOTE='cos:amiba/releases/stable'
pnpm release:cdn darwin-arm64
```

CDN 先上传安装包，再上传发现清单。不会删除历史包。版本化安装包可长期缓存；`latest-*.yml` 请设置短缓存或不缓存，上传后刷新 CDN 清单缓存。支持 HTTPS、GET、HEAD、Range 请求，并保留文件字节，禁止对安装包做转换。

全部平台上传并确认 CDN 可访问后，在 GitHub 发布草稿。发布后运行 `pnpm release:verify-online <target>`，它会逐个下载 CDN 与 GitHub 上的安装包、blockmap 和清单，并对照本地发布记录校验 SHA-512；该命令会产生完整安装包下载流量。首次分发前应在真实安装环境上完成一次版本 N → N+1 更新：检查每个架构命中正确 ZIP/EXE、网络中断重试、CDN 故障回退、校验失败拒绝安装、应用退出与重启后版本变化。

## 客户端行为

打包版本启动 30 秒后检查，此后每 6 小时检查。发现更新后后台下载，用户从左下角菜单查看进度并选择“重启并安装”。下载完成后不会在后台强制重启。安装前执行应用现有运行时关闭流程。

开发运行或没有内嵌源配置时显示此构建不支持更新。手动检查与后台检查共用任务，避免重复下载；所有源失败后显示错误并允许重试。

## 尚需真实环境验证

脚本和状态测试不等同于三个平台安装验证。需要发布仓库、国内 CDN、签名和 Windows/Intel 构建环境才能完成公开分发验收。不要把仅能打包的 unsigned Mac 构建视作已验证的自动更新发布版本。
