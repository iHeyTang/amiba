# 工作台浏览器独立插件

目标：整个工作台浏览器作为独立插件安装、卸载和替换。

## 实现边界

`@amiba/dsh-plugin-browser-provider-electron` 包含自己的 DSH 激活补丁、客户端界面、
本地化文案、Electron 原生模块及工具 provider。桌面基础包不再强制启用它。

宿主保留通用工作台资源和原生扩展机制。浏览器标签索引、WebView 管理、页面快照、
输入/点击/截图执行已全部从 `apps/desktop` 和 `packages/ui` 移出。
`PlatformAdapter` 不再包含 `embeddedBrowser`，而是提供通用 `nativeExtensions` 通道。

客户端的视图、常驻宿主、工具栏、favicon 和 URL 解析器遵循同一贡献选举。
常驻宿主位于聊天树旁，插件更换不会重新挂载聊天树。后台操作明确指定会话。
卸载时资源记录可保留为不可用状态，但页面实例会销毁；重新安装兼容视图可恢复资源，
不会承诺恢复已经销毁的 DOM 或导航历史。

原生模块从已安装依赖图解析 `dsh.native` 入口。每次装载获得独立 lease，旧通道无法
操作替代实例。卸载会取消等待创建标签的请求、移除监听器并关闭页面。DSH 进程停止
也会强制撤销所有原生实例。原生入口缺失或越界的安装会回滚。

旧配置执行一次迁移，将浏览器变为 profile 的独立可选包；迁移标记保留，因此用户
卸载后不会在重启时被基础配置重新启用。安装与替换继续使用官方 DSH plugin CLI。

## 验收证据

- 浏览器插件测试覆盖 provider 启停、装载确认丢失、卸载竞态、前端页面清理、恢复、
  替代视图选举、保留聊天草稿及后台会话隔离。
- 主进程单元测试覆盖真实 CommonJS 装载、包路径限制、lease 撤销、迟到事件与结果、
  原生入口缺失时的安装回滚，以及浏览器标签会话索引。
- Profile 测试覆盖一次性迁移以及移除后重启不恢复默认包。
- `node apps/desktop/scripts/smoke-browser.mjs`：消费实际打包归档，使用真实 Electron
  WebView 验证导航、输入、点击、快照、截图、卸载销毁、旧通道拒绝、替代包运行及
  在途创建取消；再启动完整托管 DSH 验证实际 provider 激活与停止清理，共 13 项。
- `node apps/desktop/scripts/smoke-browser-profile.mjs`：临时 profile 内通过官方 CLI
  验证迁移组合、移除、安装归档、替换版本、再次移除、重启后保持移除，共 6 项。
- `node apps/desktop/scripts/smoke-browser-app.mjs`：启动真实桌面应用，在临时任务中
  打开插件面板，通过地址栏加载本地测试页，并保存 `workbench.png` 验证布局与页面渲染。
- 冒烟输出位于 `apps/desktop/out/browser-smoke/result.json`、`profile-result.json`
  和 `browser.png`。测试不使用用户的真实 profile。
- `pnpm verify:browser` 独立检查宿主中没有浏览器实现及专属通道，且插件产物齐全。
- 桌面构建、UI/SDK/浏览器插件/桌面类型检查，以及通用插件化检查纳入最终验证。

全量 `verify:architecture` 的已知工作区问题：任务开始前已有的宠物插件改动读取
`getPlatform().desktopPet`，违反该检查的规则。该功能不属于本次改动，未为其增加豁免，
也未覆盖或回退它。浏览器边界另由 `verify:browser`、源码检查、真实安装与执行验证。

## 使用

见 `plugins/dsh-plugin-browser-provider-electron/README.md` 的打包、安装、移除和替换说明。
扩展接口见 `docs/workbench-extensions.md` 与 `packages/extension-sdk/src/desktop-extension.ts`。
