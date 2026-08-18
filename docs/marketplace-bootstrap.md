# DSH Plugin 分发与安装边界

旧 Amiba Extension marketplace（`manifest.json`、Extension registry、Electron
hot-reload）已经退役，不得恢复。

当前 `amiba plugin create` / `amiba plugin build` / `amiba plugin pack` 负责生成和打包标准
`dsh-plugin-*` npm 项目。产物是 `dsh-plugin.tgz`，包含 package manifest、Host/Client
build 和 README。

安装器已经落到 DSH 官方 Profile/Loader 链路：

1. Amiba 打包固定版本的 pnpm，Electron 不依赖用户机器上的 Node/pnpm；
2. 注册表包或本地 `.tgz` 交给官方
   `dsh plugin --profile web add/remove/update`；
3. DSH 命令维护 profile `dependencies` 与 `dsh.profile.bundles`；
4. Amiba 在停机状态快照整个 profile，校验包身份、
   `dsh.bundle.patch` 和 `--dump-config`；
5. 校验通过后重启 DSH，Renderer 重新获取同一版本生成的 Host/Client graph；
6. 任一步失败都恢复完整 profile 快照并启动旧 graph；
7. Settings 的运行状态仍来自官方 Loader inventory Remote，不读取安装收据伪造状态。

Electron 只负责文件选择、执行官方命令、profile 快照和进程重启，不能维护第二份
registry，也不能把 WebView 页面当作插件。包解析、依赖安装和 bundle reconciliation
由 DSH/pnpm 完成；运行态真相由 Loader 提供。

当前信任模型是“用户显式选择本地包或输入 npm 包名”。本地包按 SHA-256 归档到 profile
内部，方便后续重装与回滚；它不会被“更新”操作静默替换成同名 registry 包，升级时必须
重新选择新的 `.tgz`。远程 marketplace 的发布者签名、组织策略和恶意包扫描属于分发层
增强项，不改变上述 DSH 生命周期，也不能绕过用户确认。
