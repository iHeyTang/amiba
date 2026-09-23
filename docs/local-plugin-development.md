# 在 Amiba 中开发 DSH 插件

Amiba 的桌面核心是 DSH。两种开发流程共用 DSH 的包解析、Loader 和热更新，
没有宠物或 Mofli 专用的接入机制。

## 开发 Amiba 本身

在 Amiba 仓库运行：

```sh
pnpm dev:desktop
```

启动流程准备已发布依赖的 Runtime，然后把仓库插件接入临时 DSH profile，
并启动源码监听和 desktop。修改插件的 `src`、构建脚本或配置后，受影响的插件
自动构建。Host 由 Cordis HMR 重新加载，Client 由 DSH 的客户端 HMR 更新。
开发进程通过临时 profile 的 Node preload 统一解析运行时提供的 `@deepseek-ai/*` 模块。
本地插件和网关必须共用 Cordis 与 Remote 协议实例，否则插件虽已启动，接口仍会因注册表分裂而返回 404。
插件自己的其他依赖仍从项目解析，不修改项目的 node_modules。

Native 构建发生变化时，同时重新加载所属 Host，让插件释放旧 Electron 实例并重新挂载。

仓库里尚未接入当前产品配置的插件不会因为启动开发模式而自动启用。
新增依赖、改变插件名称或 Loader 配置后，重新运行开发命令。

## 使用已打包的 Amiba 开发独立插件

打开包含此功能的 Amiba，在插件项目中运行：

```sh
pnpm install
amiba plugin dev
```

初始化模板已提供两个连接命令：

```sh
npm run connect:dev      # 只连接源码启动的 dev 测试版
npm run connect:release  # 只连接已安装的发行版
```

模板的 `npm run dev` 是 `connect:dev` 的别名。它们分别调用
`amiba plugin dev --target dev` / `--target release`，不会因为目标没启动而
改连另一个版本。直接运行不带 `--target` 的 `amiba plugin dev` 仍保留自动发现行为；
发现多个实例时要求指定 `--dsh-home`。

自定义目录可分别设置 `AMIBA_PLUGIN_DEV_HOME` / `AMIBA_PLUGIN_RELEASE_HOME`。
指定 `--target` 后忽略未区分版本的 `AMIBA_DSH_HOME`、`DSH_HOME`、`AMIBA_USER_DATA_DIR`，
避免继承环境变量误连；显式 `--dsh-home` 优先级最高。
两个命令都是临时开发连接，不会永久安装或发布插件。

插件项目需要安装包含此功能的 `@amiba/cli`。
不需要 Amiba 源码，也不需要重新打包 Amiba。

命令先成功构建插件，再连接运行中的桌面端。首次接入会自动重启 DSH 并刷新主窗口，
随后修改源码会自动构建并热更新。按 `Ctrl+C` 会停止监听、断开本地插件，
桌面端自动恢复已安装版本。可以在不同终端同时开发不同名字的插件。
如果终端异常退出，失去心跳的调试连接会在约一分钟后自动清理。
如果退出 Amiba，重新打开后默认加载正式 profile，需要重新运行插件开发命令。

使用自定义桌面数据目录时显式指定对应的 DSH home：

```sh
amiba --dsh-home /absolute/path/to/userData/dsh/home plugin dev
```

只需要编译监听，不连接桌面时：

```sh
amiba plugin dev --no-connect
```

支持标准 `tsc` + Vite 插件构建脚本，以及模板中的 `amiba plugin build`。
Host-only 插件也可使用。Native 插件使用 `vite.native.config.ts`，或者在自己的
`build` 脚本中显式声明 Native 构建。改动包依赖、导出路径或 bundle 配置后，
停止并重新运行开发命令。使用其他构建工具的插件暂需自己的构建和 DSH 接入流程。

## 隔离和更新范围

- 调试连接存放在临时的 `amiba-desktop-dev-*` profile，使用正常的 Node 包链接和 DSH patch。
  正式 profile 的依赖、用户 patch 和应用安装目录不会被开发命令覆盖。
- 同名本地插件在调试期间替换已安装插件；既有 Loader 行的配置和禁用状态保持有效。
  独立新插件会加入 Loader；带 `dsh.bundle` 的插件使用自己的 bundle patch。
- 构建先写临时目录，全部成功后才发布文件。编译错误会保留上次可用的构建。
- 普通 Client 更新保留页面，通过 DSH HMR 卸载旧插件再加载新插件。
  UI 根插件（`dsh-plugin-ui-shell`）更新需要刷新整个页面。
- 首次接入、断开、切换包来源需要重启 DSH；调试时应避免同时运行重要的 Agent 任务。
  调试期间安装、更新和删除正式插件会被阻止，退出调试后即可操作。
- 桌面发现文件只对当前系统用户可读；控制端口仅监听回环地址、校验随机 token，
  并拒绝浏览器 Origin 请求。它只负责连接管理，不替代 DSH 的 Loader。

发布和打包继续使用锁定的线上依赖。开发 profile 不属于打包输入；即使本机曾经
调试过 Mofli 或其他项目，也不会把这些临时链接分发给其他用户。

## 验证

```sh
pnpm --dir apps/cli build
pnpm --dir apps/desktop typecheck
node --test apps/desktop/scripts/build-dsh-plugin.test.mjs apps/desktop/scripts/watch-dsh-clients.test.mjs
node --experimental-strip-types --test apps/desktop/src/main/__tests__/plugin-development.test.mjs apps/desktop/src/main/__tests__/dsh-client-transport-rewrite.test.mjs
node apps/desktop/scripts/smoke-plugin-development.mjs
# 先构建 desktop；使用临时用户目录和实际 file: renderer，连接独立插件后验证 HMR 和退出恢复。
node apps/desktop/scripts/smoke-plugin-desktop.mjs --native
node apps/desktop/scripts/smoke-plugin-desktop.mjs --author --native
node apps/desktop/scripts/smoke-desktop-dev-start.mjs
# 实际安装 CLI tarball 到仓库外，再连接桌面验证；需要 npm 网络访问。
node apps/cli/scripts/smoke-package.mjs
```
