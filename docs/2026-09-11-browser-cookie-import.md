# 工作台 Cookie 导入

浏览器插件增加地址栏旁的导入入口。默认只需选择浏览器，点击「一键导入」，将当前
显示配置的全部网站登录数据带入工作台，保留已有登录状态。配置选择、网站筛选和
覆盖选项折叠在高级设置中；结果页先提供「开始浏览」，详细统计按需展开。

界面使用浏览器到工作台的迁移示意、明确的主按钮和轻量浏览器选择，保持工作台的
紫色强调色。验证了默认、窄窗口、深色、高级设置与结果状态。

目前支持 macOS 标准路径中的 Chrome、Edge、Brave Default/Profile 配置，读取
Chromium v10 加密及版本不超过 24 的兼容 Cookie 表。按来源版本校验 v24 域名哈希，
保留 Cookie 域/host-only、路径、Secure、HttpOnly、SameSite 和有效期。
分区 Cookie、未知加密格式会跳过，密码、Passkey 和其他网站存储不在本次范围内。

## 数据与生命周期

- 配置和网站发现不读取钥匙串，只返回配置标签、网站和数量。
- 原生端只接受本次发现的配置 ID，不接受界面传入文件路径、SQL 或钥匙串项目名称。
- 只读 SQLite 查询按所选范围（全部网站或自选域名）读取 Cookie 内容，不修改来源，不生成明文导出或临时文件。
- 钥匙串授权在写入前完成；取消不写 Cookie。解密材料仅在原生进程内使用。
- 导入接口只在 rendererCall 中注册，没有注册为 Agent 工具或 DSH browser operation。
- 插件卸载会撤销等待中的读取/授权，并阻止后续写入。已有持久化登录数据遵循原浏览器
  partition 的生命周期，不因插件卸载而删除。
- 高级自选包括精确主机名与对应 domain Cookie，不会自动扩展到其他子域；一键导入则明确导入当前配置的全部网站。
- 导入成功与网站登录成功分别展示；用户通过「打开验证登录」检查，部分站点仍需登录。

## 验证

- 浏览器插件测试 21 项通过，包括 9 项原生导入测试和 5 项导入界面测试；覆盖超过 100 个网站的一键导入。
- `node apps/desktop/scripts/smoke-cookie-import.mjs`：14 项检查，通过人工构造的
  Chromium 数据库和测试密钥，将 Cookie 写入真实 Electron session，验证 HTTP
  请求登录、HttpOnly 隔离、默认保留和显式覆盖；渲染实际 React 面板及桌面 CSS。
- 输出：`apps/desktop/out/browser-smoke/cookie-result.json`、`cookie-import.png`、
  `cookie-import-result.png`。
- 未读取用户的真实浏览器配置或钥匙串；真实系统授权弹窗仍取决于来源浏览器及应用签名。

实现参考 Chromium 的 OSCrypt macOS v10 和 SQLite Cookie Store v24 源码，以及
Electron Cookies API；未使用将用户 Cookie 发往远端的导入服务。
