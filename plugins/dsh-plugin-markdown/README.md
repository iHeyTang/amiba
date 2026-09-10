# Markdown 展示插件

客户端通过 `amiba.markdown.extension` 插槽注册默认 Markdown 扩展，供 Amiba 的统一 Markdown 渲染入口使用。默认扩展在 `src/client/defaults.tsx` 中维护；服务端入口不提供运行时业务服务。

此插件只贡献展示能力，不管理会话、任务或持久化数据。后台任务结果等界面复用统一渲染入口，而不是在本插件另建对话流。
