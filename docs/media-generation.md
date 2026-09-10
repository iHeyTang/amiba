# 媒体生成

Amiba 的媒体生成由通用 `@amiba/dsh-plugin-media` 和各 Provider 适配器组合实现。通用插件不依赖 TokenDance；TokenDance 在媒体服务存在且 Provider 配置已保存时注册适配器，复用原有地址和凭据。仅安装聊天 Provider 时，不要求媒体服务存在。

## 使用

在「模型与服务」页面配置 TokenDance 或官方 minimax-cn 的 API Key，再到同页的「模型分配」列表刷新媒体能力，按需选择图片、视频、语音和音乐的默认模型。每个场景占一行；主模型与它的推理强度在同一行设置。随后在对话中提出生成需求。聊天模型负责理解需求并调用媒体工具，不必把会话模型切换成生成模型。

`media_describe` 提供可用 Provider、模型、协议、官方文档和默认选择；也可读取 Provider 声明的文档 URL。`media_generate` 接受模型、协议、操作及原生 JSON 参数。Agent 根据所选模型的参数契约填参；Provider 在提交前校验并补默认值。已适配的独占字段被保留，未知字段在本地拒绝。

「服务提供商」列表按 Provider 和模型 ID 合并聊天与媒体目录，搜索、总数和详情包含图片、视频、语音模型。上游目录中尚未适配的模型也可展示，并标明状态；展示目录不会扩大实际可调用的模型范围，媒体模型不会进入聊天模型候选列表。

模型选择弹窗保留紧凑列表，通过每个模型的 info 按钮打开统一详情弹窗，查看 Provider 提供的 `description` 与已知能力；搜索仍支持匹配介绍内容。聊天模型沿用 DSH 的描述字段，媒体目录保留同名描述字段；缺失或无效的描述不生成替代文案。TokenDance 的描述随模型目录刷新获取。

媒体模型在 Provider 列表中有独立的「允许调用」开关，设置持久保存。关闭后，该模型从可选模型和 Agent 发现结果中移除，相关默认分配同时清除；服务端拒绝明确指定的禁用模型，并在后台任务提交前再次检查。已提交任务仍可查询和保存结果，关闭开关不会取消上游任务。重新开启后可再次调用。

默认模型只用于未显式指定的选择，并仍需通过当前模型目录验证。模型下线或协议不匹配不会静默改用另一个模型。默认偏好使用 DSH settings 的乐观版本控制。

## TokenDance 已实现协议

| 操作 | 协议 |
| --- | --- |
| 图片生成 | OpenAI Image Generations、Ark Image Generations |
| 视频生成 | Seedance Generations、MiniMax Video Generation v2、Kling、Wan、HappyHorse |
| 文字转语音 | MiniMax T2A v2、Ark 单向 SSE TTS |

目录展示上游新模型，但只有已适配参数契约的模型可调用；未列出的协议、双向 WebSocket 语音、声音复刻和语音识别不在本次首版适配范围。只有适配器已实现的协议进入可用媒体目录，不能把目录出现等同于可执行。

图片支持完整响应及已适配模型的 SSE，组图部分成功时保留成功图片并报告警告；Seedream Pro 分层额外交付图层 JSON 清单。MiniMax 语音支持 JSON/SSE，字幕作为附属文件保存；Ark SSE 分帧拼接成音频文件。原始 PCM 在适配器中封装为 WAV，便于预览播放。支持的参数范围以 Provider 返回的版本化契约为准，规则由 Provider 开发者根据官方资料维护。

## 任务、结果与复用

生成通过 DSH jobs 在后台执行。视频任务 ID 在查询前持久化；停止本地 job 只停止观察，不表示取消远程收费任务。提交超时或结果无法解析时，保留「提交结果待确认」，不自动重提。

Provider 完成结果先暂存，再保存正式产物。文件保存中断后可继续保存，已有文件不会重复生成。`media_resume(recordId)` 仅恢复保存或远程查询。进程重启后，不再活跃的提交记录显示为待确认，有远程引用或暂存结果的记录显示为中断。

对话工具行提供图片预览、音视频播放与下载。产物按会话保存，浏览器按块读取；引用其他会话的记录会被拒绝。支持的文件签名检查会拒绝伪装成图片的 HTML 等内容。

Agent 可在原生参数值放置 `{"$mediaAsset":{"recordId":"...","artifactId":"..."}}`，由服务端替换为已生成文件的 data URL，无需把大段 Base64 写入模型上下文。此方式适用于接受 data URL 的协议，引用总量上限为 32 MiB；要求专有上传流程的接口需要另外实现上传适配。

## 验证边界

已覆盖协议 HTTP 测试、注册生命周期、独占参数保留、任务恢复、会话隔离、文件验证、默认设置版本冲突和前端分块预览。运行时媒体专项测试通过真实 DSH 工具、jobs、文件与 RPC 链路使用本地 Provider，不产生生成费用。

提供本地组件验证页 `plugins/dsh-plugin-media/qa`，用于检查默认选择、预览以及浅色/深色布局。桌面构建与运行时打包验证独立执行。

没有使用真实 TokenDance 账户进行收费生成，因此生产账户权限、余额、模型实际效果及上游服务可用性未被这些测试证明。裸 DSH 网页存在原有 Pin 插件依赖桌面 PlatformAdapter 初始化的问题，组件浏览器验证不等于完整裸网页产品启动验证。

### 对话中的媒体交付

成功任务的 `job_output` 和 `media_describe(recordId)` 返回 `delivery.markdown`。Agent 在最终回复中原样包含该 `amiba-media` 代码块，媒体插件的 Markdown renderer 将其显示为图片或音视频播放器。引用只包含 sessionId / recordId；文件通过现有 artifact RPC 校验和分块读取，不把本地路径交给浏览器，也不在模型上下文塞入 base64。图片点击打开对话上方的放大预览，音视频不自动播放，支持下载和历史消息重新加载。失败记录不会提供交付代码块。

旧回复中的纯文本路径不会被改写；可以让 Agent 用 `media_describe` 查询原记录并补发交付块，无需重新生成或复制文件。

### Provider 参数契约与官方 MiniMax 扩展

`media_describe(provider)` 列出模型，`media_describe(provider, model)` 返回所选模型的 `parameterContract`（版本、JSON Schema、跨字段约束）。Provider 在任务创建前执行 `prepare`，补充默认值、拒绝未知字段和不兼容参数；正式 `generate` 也再次校验。Agent 不再负责查文档或用付费请求研究特殊字段。

TokenDance 将实时目录与已维护的模型规则取交集，当前为 23 个媒体模型，包含 Seedream、Seedance、MiniMax、Seed TTS、Kling、Wan 和 HappyHorse。未适配的新模型仍在 Provider 库存展示，但不开放调用。各模型尺寸、组图、搜索、分层等规则由 TokenDance 插件维护；详见[覆盖清单](../plugins/dsh-plugin-provider-tokendance/MEDIA-COVERAGE.md)。Seed TTS additions 与 Kling 完整独占字段仍有文档缺口，未知字段会在本地拒绝。

`@amiba/dsh-plugin-media-minimax` 为官方 `minimax-cn` 增加 H3/Hailuo 视频、image-01 图片、Speech 系列同步语音和账号允许使用的 Music 系列，共 24 个模型（[覆盖清单](../plugins/dsh-plugin-media-minimax/MEDIA-COVERAGE.md)），不注册 LLM Adapter。它只通过 DSH 公开的 Provider 目录、设置服务和凭据服务绑定官方 pi-ai 实例。用户继续在原 Provider 中配置 API Key，在模型分配里选媒体模型；不支持将登录凭据、Coding Plan 凭据或任意兼容网关自动认作媒体凭据。账号需具备相应按量媒体 API 权限。

同会话同类媒体存在提交中、远程运行中、结果待恢复或提交不确定记录时，工具拒绝新建，即使换模型/协议也一样。使用原 recordId 恢复。确实无法恢复时，用户可在原媒体工具详情点击“允许再次生成（可能再次扣费）”；授权独立留痕，原结果仍保留。Agent 的工具参数没有绕过开关。

下载器遇到代理 Fake-IP（198.18/15）域名时，使用 Cloudflare DNS-over-HTTPS 查询该域名的真实 A 记录，再执行原有公网地址检查与连接 IP 固定。只发送主机名，不发送签名 URL、路径或 API Key；私有地址和字面量 Fake-IP 仍被拒绝。解析失败保留结果引用，不触发重新生成。

### 媒体工具调用与查看器

精确模型的 `media_describe` 返回 `generationCalls`，其中包含 Provider、模型、协议和操作；Agent 添加符合参数契约的 `parametersJson` 后调用。`media_generate` 的五个字段均为必填，恢复查询独立使用 `media_resume(recordId)`，不再让生成字段因兼容恢复入口而全部可选。

图片及视频使用独立全屏媒体查看器，保留无障碍焦点管理和 Esc 关闭。图片支持滚轮、按钮和双击缩放及拖动，视频使用原生播放控件。内联下载与查看器下载均由媒体插件渲染，不依赖 Agent 生成下载链接。
