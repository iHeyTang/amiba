> 本文保留历史审计／设计背景；官方插槽的当前状态及后续接入、同步、退役决策统一维护于 [DSH 官方插槽兼容维护台账](../DSH-SLOT-COMPATIBILITY.md)，不再在本文更新插槽当前状态。

# DSH extension compatibility implementation

Base: `main` at `3cbcaaa2dbf4b9036c43c5e0a175bcdcccaefecb`.
Initial branch: `feat/dsh-extension-compat-isolated` (merged).
Continued from main `99e8f93` on `feat/dsh-extension-compat-next` in the same isolated worktree.
Main and the other task's personal menu, external-message and update changes are preserved.

## 最新进展：附件统一为一个画廊组件，conversation.message.images 整组调用 + shadow 默认 occupant（2026-09-21）

用户消息改为官方同构的附件行：文件与图片共处一个 `AttachmentGallery` 行（图片为有界预览瓦片、文件为紧凑 chip，单图封顶、多图退化为统一小瓦片，与 composer/空状态输入完全一致）。文件项继续由 Amiba 原生 chip 渲染；图片项按消息**整组调用一次** conversation.message.images（owner.images 为整组图片，owner 载荷 images/loadImage/align/compact 保持官方契约），默认 occupant 为 `MessageImagesGallery`（复用 `AttachmentImageTile`，渲染紧凑瓦片），注册在 `SHADOW_PRIORITY`(-1)——低于官方 ui-attachment occupant 的隐式 0，故默认即 Amiba 画廊形态；第三方以 **≤ -2** 注册即可接管图片侧渲染，接管后仍在附件行内、位置由宿主决定。乐观 live 气泡尚无 durable ref 时，图片 `attachmentBadge` 直接以 256px 缩略图渲染为同款瓦片（不再退化成文件胶囊），durable 后再由 seat 接管——live/durable 气泡与两种输入框四态一致。原「文本之后的右下角图片区」与更早的胶囊 occupant 均已移除。`conversation.input.attachments` 保留声明（第三方宿主可自行派发），Amiba 的 composer 不再转发该 seat，直接由 attachment hook 渲染同一附件画廊。

兼容性：conversation.message.images 的声明、single/session、owner 载荷（images/loadImage/align）保持官方契约；整组调用从宿主侧看是合法用法（owner.images 本就是数组契约），但 Amiba 默认 occupant 与附件行布局属宿主呈现策略，不在槽位契约内。

## 进行中：main 的 conversation 保留入口（2026-09-14）

将 layout.selectPanel('conversation') 映射到原生会话入口，与 null 使用同一 canonical panelInfo 状态；此保留名称不再按普通插件全局页面派发，即使插件注册同名 main 贡献，也不会接管原聊天。其他 main key 仍严格检查注册并保持原有卸载回退。sidebar.panellist 的 conversation 入口无需替换组件即可使用，active 结合实际原生 sidebarView，避免其他工作区显示时误亮；其渲染移至已有 workspaceNavigation 回调末尾，DOM 顺序保持不变，没有改 NavigationRow 或 CSS。完整替换会话界面仍属于有条件适配，不因这个别名就宣称支持原样接管。

12 项导航/列表测试、插件类型检查和完整桌面构建通过（/tmp/amiba-main-reserved-tests.log、/tmp/amiba-main-reserved-types-2.log、/tmp/amiba-main-reserved-build.log）。实际 --compat --main-panels --panel-list --sidebar-right 退出 0（/tmp/amiba-main-reserved-smoke.log）：无同名注册与存在同名贡献两种情况下都返回原会话，原输入 DOM、未发送草稿、Session 身份保留，同名替换组件未执行；保留侧栏入口可用且选中图标正确。右侧栏、guide、文档及其余桌面回归通过。

另外运行 verify-dsh-architecture 发现已有静态规则仍要求 tool.call.toolview 直接接收 request.owner，而当前实现已构造含图片/inspect 的 owner；同一规则在 HEAD 与工作区均匹配失败（/tmp/amiba-main-reserved-architecture.log）。未绕过检查，需在后续全量审计中核对和修正这条过期检查。44/0/20 统计不变，Web、完整服务和剩余清单继续处理。

## 进行中：guide 默认视图、多入口和主题（2026-09-14）

新增真实插件 guide 回归：全部 chain 贡献 decline 时显示 shipped fallback；优先贡献接管并获得真实 useTabInfo，卸载恢复默认内容；同一 kind 的多个入口按 order 与其他类型一起排序，动态注册/卸载即时更新；超过四个入口隐藏描述，恢复三个时描述回来。点击或原生 Enter 激活入口替换当前 guide，保持标签数量，多个同 kind 的入口均可用。

首轮交互通过，但截图发现 upstream 颜色变量缺失，入口背景/边框和弱化图标未生效。仅在 GuideBody.module.css 内将颜色角色映射到现有 Amiba theme，未改布局或其他视图。完整桌面构建退出 0（/tmp/amiba-sidebar-guide-build.log）。最终 --compat --sidebar-right 退出 0（/tmp/amiba-sidebar-guide-smoke-3.log），浅深色实际背景、边框和文字层级均有 computed-style 断言，两个截图已查看。键盘测试补齐 Enter 字符事件并检查焦点，未用合成 click 替代键盘验证。文档/PDF 及原侧栏回归同时通过。44/0/20 统计不变；独立 Web、完整服务、跨窗口/重启等清单项仍在进行。

## 进行中：PDF 多页阅读位置恢复（2026-09-14）

24 页真实 PDF 复现了返回标签后落回第 1 页的问题（/tmp/amiba-pdf-pages-smoke.log，期望 12、实际 1）。外层滚动恢复早于异步 PDF 页面生成，且原 IntersectionObserver 将预加载范围内的页码记成阅读页，disconnect 后向上滚动也不再更新。

新增 PDF 局部位置观察器：页面生成后在现有滚动祖先中按 tab 页码恢复；实际 scroll/resize 后按视口记录页码，隐藏时不记录，卸载取消 frame/observer/listener。预加载仍由原观察器驱动，但不再写阅读状态。未改 CSS、未增加滚动容器、未改其他文档或原聊天视图。恢复粒度沿用 PdfView 的页码，并非新增任意像素位置承诺。

172 项文档测试、插件类型检查通过，完整桌面构建退出 0（/tmp/amiba-pdf-position-build.log）。最终 --compat --sidebar-right 退出 0（/tmp/amiba-pdf-position-smoke-3.log）：第 12 页返回、回滚到第 4 页再返回，以及 24 页重载缩短为 2 页的末页定位均通过，页渲染仍按需、Worker 随正文关闭释放。末页测试按浏览器可滚动范围判断底部与末页可见，避免要求不足一屏的末页强行贴顶。最终截图已检查，PDF 图片/WASM、动画、其他文档与侧栏回归通过。44/0/20 统计不变，独立 Web、完整远程服务、队列及其他清单项仍待完成。

## 进行中：PDF 嵌入图片、WASM 与透明蒙版（2026-09-14）

新增二进制安全的 PDF image XObject fixture，xref 按字节偏移生成。三种样本分别使用 DCTDecode/JPEG、JPXDecode/JPEG 2000、FlateDecode RGB 加灰度 SMask；背景为绿色，左右像素可明确区分图片缺失、色彩错误及未应用透明度。JPEG 2000 色块为自行编码数据，无外部文档。测试经实际文件授权、文档页、PDF Worker 和画布绘制检查像素；JPX 额外要求本次 Worker 的 FetchBinaryData/openjpeg.wasm 成功回复，不以资产存在代替实际使用。

--compat --sidebar-right 退出 0（/tmp/amiba-pdf-images-smoke.log），三种图片像素和关闭 Worker 清理均通过；透明蒙版的最终截图已查看，半透明左半区与绿色背景正确混合，原会话/输入保留。标准字体/CMap、全图片格式与动画、其他文档及侧栏回归同时通过。只增加测试和证据，沿用 fce007ca 完整构建的产品。不能以三个样本推断所有 PDF 编码；多页可见性/位置恢复、独立 Web 及完整服务语义仍待完成。44/0/20 统计不变。

## 进行中：图片格式与动画实际验证（2026-09-14）

新增自制的 32×32 色块编码 fixtures，覆盖 baseline JPG、progressive JPEG、GIF、lossless/lossy WebP、24 位 BMP，以及含 16/32 像素条目的 PNG/DIB ICO；另加无限循环双帧 GIF/WebP。fixture 以 base64 保存在测试模块，Pillow 只用于生成，运行测试无需该依赖。实际文件使用大写后缀，经过原文件授权/完整字节读取和 ImageBody 后检查解码像素及 intrinsic 尺寸；每个样本都验证损坏文件重载、恢复、替换/关闭 URL 不再可加载。动画检查实际 compositor 的图片区域截图，再读取截图像素，确认红蓝两帧均显示；不以 drawImage 的首帧或文件元数据代替动画验证。

--compat --sidebar-right 最终退出 0（/tmp/amiba-image-formats-smoke-2.log），10 个新增样本全部通过；此前 SVG/PNG、Markdown 中英文脚注、HTML、代码、PDF 及原侧栏/会话回归亦通过。仅修改测试与文档，沿用 fce007ca 已完整构建的产品，无组件或样式改动。全部 8 个官方图片后缀已有桌面样本证据，但不声称覆盖每种编码变体或独立 Web。44/0/20 入口统计不变，复杂 PDF、完整服务和跨窗口/重启等工作仍在进行。

## 进行中：Markdown labels 与脚注本地化（2026-09-14）

为实际 rc.2 MarkdownText 补入新版 MarkdownLabels 的 code/footnotes 参数，保留可选旧 codeLabels 及默认英文标题；新 labels 提供时优先使用。流式缓存同时考虑脚注文案变化，结束渲染使用同一文案。文档 MarkdownBody 传递其 locale，未修改 CSS 或原聊天调用方。

171 项文档测试、插件类型检查及 2 项运行时补丁复用测试通过。测试涵盖流式/结束脚注、同文本语言切换、旧复制文案及新参数优先级。首次构建暴露 ui-primitives 仅为编译期依赖；首次桌面 smoke 进一步发现实际 singleton 来自 dsh-web-frontend 预打包文件，因此增加该固定版本发布文件的对应补丁，而非仅修改开发依赖。运行时 digest 同时包含两份补丁；编译期包缺失仅豁免此明确目标，实际 Web frontend 的补丁应用与版本检查仍严格执行。最终完整桌面构建通过（/tmp/amiba-markdown-labels-build-3.log）。

最终真实桌面 --compat --sidebar-right 退出 0（/tmp/amiba-markdown-labels-smoke-5.log）。测试通过公共 locale 服务显式切换 zh/en 并等待脚注标题变化，再按 getSnapshot().active 恢复原语言，独立注入上下文在恢复后释放。修正了测试默认中文假设和复用已卸载上下文的问题；没有改变产品默认语言。其他文档、实际 PDF 字体/CMap、侧栏和原输入回归通过，最终 PDF 截图已检查。44/0/20 统计不变；复杂 PDF 图像、其他图片格式、独立 Web、队列及其余全量服务语义仍待完成。

## 进行中：PDF 标准字体和 CMap 实际验证（2026-09-13）

扩展确定性 PDF fixture，加入未内嵌 Symbol 字体，以及 Type0/CIDFont 的 UniJIS-UCS2-H 文本。桌面 smoke 观察真实 Worker 的 FetchBinaryData 请求与成功回复，记录同一次调用的资源名和字节长度，再检查画布输出；没有替换资源工厂或字体解码。

--compat --sidebar-right 退出 0（/tmp/amiba-document-pdf-cmap-smoke.log）。FoxitSymbol.pfb 实际传输且形成黑色字形像素；UniJIS-UCS2-H.bcmap 实际传输且页面绘制完成。已查看 Symbol 字形截图和 CMap 的“日本”文字截图，原界面保留；新增文档关闭后所有 PDF Worker 均终止，原损坏重试/恢复及其他文档回归通过。此次仅修改测试和证据记录，沿用 af24ca29 的已构建产品。复杂 PDF 图像/WASM 解码、更多页面恢复、其他图片格式、脚注本地化及独立 Web 等仍待完成；不能由一个标准字体及一个 CMap 推断覆盖所有字体或平台。44/0/20 入口统计不变。

## 进行中：PDF 文档视图（2026-09-13）

迁移固定源 PDF 正文、页状态、Worker runtime、canvas 渲染、资源工厂及 locale。使用 PDF.js 6.1.200，真实 module Worker 经 ready 握手后创建 PDFWorker bridge；解析和页渲染有独立取消/清理，失败不回退主线程解析。输入字节复制后传递，保留文档 owner 原缓冲区。CMap、标准字体、WASM 与 worker 同版本内联，并将相关许可证写入发布 client banner。采用原文档 bytes-complete 读取；tab 状态使用实际 rc.2 runtime store，正文关闭销毁 Worker，tab 结束忘记页状态。

169 项文档测试通过（/tmp/amiba-document-pdf-tests-2.log），新增 33 项 PDF runtime/资源/渲染/正文/store 测试；实际 runtime store factory 用于页状态，jsdom 缺少 AbortSignal.any 时采用 Node 原生 signal。修正旧版 runtime 导出路径为 /client 后插件类型检查通过。

首次真实桌面解析报 a.toHex is not a function：当前 Electron 缺少新 Uint8Array API；改用 PDF.js 同版本 legacy 主模块与 worker，沿用库自带兼容层。初次压缩包检查还发现普通注释许可证被 minifier 删除，改为保留的 /*! 注释块。最终 PDF 专项 33 项和类型检查通过（/tmp/amiba-document-pdf-tests-3.log、/tmp/amiba-document-pdf-types-4.log）。完整桌面构建退出 0（/tmp/amiba-document-pdf-build-2.log）；--compat --sidebar-right 退出 0（/tmp/amiba-document-pdf-smoke-2.log），实际 module Worker、红蓝两页像素、损坏后失败/重试清理、恢复及关闭后的全部 Worker 终止通过。

已查看最新 amiba-native-document.png，页面正常且原聊天、输入器和工作区标签保留。pnpm pack 后 scripts/verify-pdf-pack.mjs 验证 tar 包中的 client.js 保留 10 份 PDF.js/资源许可证和 189 个二进制资源（/tmp/amiba-document-pdf-pack-verify.log）。字体/CMap、复杂图像解码的实际 PDF 样本、更多页可见性/恢复及独立 Web 仍待专项验证；此次矢量两页验收不代替全部 PDF 语义，44/0/20 入口统计不变，完整目标未完成。

## 进行中：代码文档视图（2026-09-13）

当前 rc.2 CodeBlock 缺少 streaming、lineNumbers、contentRef；迁移固定源对应 CodeBlock、StreamingHighlightSession、viewport 高亮及语言表，仅供新增 code 文档正文。复用公共 writeClipboard，保留聊天及原文件代码组件。固定 shiki/@shikijs/langs 4.4.3（原 lock 已有），局部原生字体/颜色及浅深色 shiki token；不改全局 Markdown 样式。metadata 在 Markdown/HTML 之后注册，保留其默认优先级；text-pages 累积内容、行号、独立 scrollport 和换行接到文档 owner。

初始 135 项文档测试退出 0。新增固定源代码/增量/viewport 测试仅涵盖 CodeBlock，不引入无关 ReadBlock 测试及组件。pnpm 添加依赖时产生的无关 hast 类型版本整理已还原，pnpm lock 仅增加本插件两个依赖。首次构建发现发布运行时依赖锁需更新；执行 runtime:lock 并保留 runtime-deps 两个文件，未绕过发布检查。

首次桌面分页发现固定源 CodeBlock 仅保留“文本未变而结束”的 DOM，“最后一页追加且同时 EOF”会切换完整 HTML。局部实现补齐最后追加分支，保留已完成行及 scrollport；新增回归后 136 项文档测试通过（/tmp/amiba-document-code-tests-4.log），最终代码专项 47 项通过（/tmp/amiba-document-code-final-tests.log），类型检查退出 0（/tmp/amiba-document-code-types-3.log）。

最终完整桌面构建退出 0（/tmp/amiba-document-code-build-3.log），含运行时和 bundle verifier；--compat --sidebar-right 退出 0（/tmp/amiba-document-code-smoke-2.log）。6002 行 TypeScript 实际高亮/颜色、5000 行分页、最后一页完成后的行 DOM 与 scrollport 保留、5002 行定位、换行切换和关闭通过。已查看 amiba-native-document.png，行号、语法颜色及布局正常，原聊天/输入器/工作区标签保留。Markdown/HTML/图片默认视图和既有文件、目录、配置、HMR 回归通过。PDF、脚注本地化、图片格式逐项桌面验证、独立 Web 与其他服务仍未完成，44/0/20 入口统计不变。

## 进行中：HTML 文档视图（2026-09-13）

迁移固定源 HtmlBody、pack、bootstrap、UTF-8 工具、relative reader、metadata 与 locale。html/htm 采用完整字节，在 allow-scripts 的 opaque iframe 中打开；原文及有限直接引用的普通 JS/CSS 经 base64 序列化，依赖 Blob URL 在 iframe 自身创建。每个资源 4 MiB、最多 64 个、总计 32 MiB；保留官方 base 元素处理及不遍历模块、CSS 内部依赖、图片和运行时请求的范围，不能据此声称任意本地网站完整运行。

桌面完整读取增加可选 relativePath：从已授权且 canonical 的基础文件目录解析，再对目标进行同会话授权；两次授权后均检查取消。保留 Amiba 工作区限制，不迁移新版允许越界读取的行为。文档适配器注入 readRelated，未向 iframe 暴露 IPC 或读取回调。旧读取请求不变。

89 项文档测试退出 0（/tmp/amiba-document-html-tests-2.log），6 项主进程 IPC 测试退出 0（/tmp/amiba-document-html-ipc-tests.log），插件和主进程类型检查退出 0。迁移测试覆盖序列化、依赖去重/限额、取消、iframe 替换与释放、失败提示和保持挂载；当前 jsdom 缺少 AbortSignal.any，HTML body 测试改用 Node 真实 AbortController/AbortSignal 后通过，生产代码未替换取消语义。

完整桌面构建退出 0（/tmp/amiba-document-html-build.log）。首次桌面运行确认 CSP 拒绝 Blob iframe，增加 frame/child、script-src-elem、style-src 的 Blob 来源后，electron-vite 重建（/tmp/amiba-document-html-csp-build-2.log）与 bundle verifier 均退出 0。最终 --compat --sidebar-right 退出 0（/tmp/amiba-document-html-smoke-3.log）：相对 CSS/JS 查询串及片段、实际执行及计算颜色、opaque origin/父 DOM 隔离、正文高度、无效 UTF-8 重载失败、URL 撤销通过；缺失基础文件、绝对依赖、路径及软链接越界经真实 IPC 验证。第二次功能回归截图早于 iframe 绘制；增加双动画帧和短 compositor 等待后重跑，已查看最新 amiba-native-document.png，正文及紫色标题正常，原聊天、输入器和工作区标签保留。

发现上一轮图片 smoke 用 fetch 拒绝证明 URL 释放的证据不充分：connect-src 本身拒绝 Blob。已改为成功解码的 SVG 在重载后、PNG 在关闭后用新 Image 再解码必须失败；最终回归通过。HTML 则记录并调用真实 URL.revokeObjectURL，配合 iframe 销毁断言，不把 CSP 拒绝算作释放。其余图片格式、脚注本地化、代码/PDF、独立 Web 及其他服务仍待完成；44/0/20 入口统计不变。

## 进行中：图片文档视图（2026-09-13）

迁移固定源 ImageBody、图片 metadata、locale 与独立 CSS，注册 png/jpg/jpeg/gif/webp/bmp/ico/svg 的 bytes-complete 内置实现。通过已有文档 face/会话授权读取完整字节，按文件类型创建 Blob URL；按原始 CSS 像素显示，容器负责滚动。SVG 仅交给 img 静态图片模式。文件内容替换/卸载释放 URL；分配失败、解码失败和不支持的输入显示本地化状态，不替换现有原生图片入口。

65 项文档测试通过（/tmp/amiba-document-image-tests-3.log），类型检查退出 0（/tmp/amiba-document-image-types.log）。新增测试覆盖全部后缀与第三方优先级、替换时重置解码状态、旧 URL 和卸载 URL 释放、分配失败及不支持的文件。首次新增测试的分配失败 mock 被一次性成功返回值覆盖，清空 mock 后重跑通过。完整桌面构建退出 0（/tmp/amiba-document-image-build.log）；--compat --sidebar-right 退出 0（/tmp/amiba-document-image-smoke.log），SVG/PNG 实际解码、400×240 CSS 像素原始尺寸、损坏重载提示，以及替换和关闭后旧 Blob URL 无法读取均通过。已查看 amiba-native-document.png，图片居中显示，原聊天、输入器、侧栏和工作区标签保留；文件/目录、Markdown、配置和 HMR 回归通过。其余格式已注册但尚未逐格式做桌面解码验收，独立 Web 仍待验证。44/0/20 统计不变，完整适配目标未完成。

## 进行中：Markdown 文档视图（2026-09-13）

新增 Markdown 内置实现，沿用固定源扩展/注册优先级、text-pages 累积内容和独立 whitespace/CSS 范围；.md/.markdown 自动选择，外部 renderer 优先级与纯文本备选保持。使用当前 rc.2 MarkdownText，将新版 labels.code 映射到实际 codeLabels，保留 localized copy/copied 标签；不替换当前聊天 Markdown 或代码组件。

代码组件核对发现 rc.2 CodeBlock 尚无新版 streaming、lineNumbers、contentRef；未用忽略参数伪装代码视图兼容。MarkdownText 缺少新版统一 labels/footnotes 接口，本轮先接通已有 Markdown 渲染与代码复制标签，脚注标题本地化仍待补齐。

62 项文档测试退出 0（/tmp/amiba-document-markdown-theme-tests.log），类型检查退出 0（/tmp/amiba-document-markdown-types-2.log）：新增真实 primitives 渲染测试涵盖 heading、GFM table、代码与本地化按钮、脚本/危险链接不注入、分页累积后引用链接完成解析、非文本内容不绘制、后缀与外部实现优先级。

首次桌面功能回归通过，但截图发现官方 Markdown 字体/颜色变量缺失，标题、链接及表格退化为普通文本。已仅在新 Markdown 容器内映射 Amiba 主题颜色及系统字体；完整桌面构建退出 0（/tmp/amiba-document-markdown-theme-build.log），--compat --sidebar-right 退出 0（/tmp/amiba-document-markdown-theme-smoke.log），新增实际计算样式检查覆盖标题字号、正文字体、链接颜色和表格边框。已查看更新的 amiba-native-document.png，标题层级、链接、表格与代码块背景正常，原聊天、输入器与工作区标签保留。原文件/目录、侧栏、配置与 HMR 回归通过。44/0/20 入口统计不变；脚注标题本地化、HTML、图片、PDF、代码文档视图以及独立 Web 仍未完成。

## 进行中：文档正文、标题及 keyed renderer 接入（2026-09-13）

迁移固定源 TextPreview、TextTitle、加载提示、文本行工具、纯文本正文、文档 owner/Hook 契约与局部 CSS。新增可选 documentPreviews 服务及 text fallback 标签类型，使用真实 runtime store、nativeDocumentReads 与 textFace；声明 sidebar.right.tab.document keyed/session 子槽并转发 enclosing useTabInfo。保留原工作区文件预览，新增文档通过 sidebarRight.openResource 打开。

rc.2 primitives 缺少新版 FileTypeIcon/classifyFileType，新增正文和标题沿用本机已有 lucide FileText；原文件图标和样式不替换。copy locale 在 ui-slots.LocaleNamespaceMap 正式声明；too-large 详情从实际 wire 对象检查 limit 后显示，避免依赖新版错误类。模块 CSS 以构建生成的 inline 文本注入，清理随注册生命周期执行。

59 项文档测试及 327 项侧栏测试通过（/tmp/amiba-document-ui-regression.log）。新增正文测试用实际 rc.2 store 及绑定器，验证首屏分发、下一页、重新挂载保留内容、metadata 变更重载、关闭标签清理。类型检查退出 0（/tmp/amiba-document-ui-types-4.log）。首次完整构建发现生产 file 行号参数缺少声明，测试的 test 参数扩展掩盖了该缺项；已将 file.line 加到正式文档契约；第二次完整桌面构建退出 0（/tmp/amiba-document-ui-build-2.log）。

--compat --sidebar-right 退出 0（/tmp/amiba-document-ui-smoke.log）：实际资源打开、6002 行文件跨 5000 行分页定位、metadata 更新及重载、正文高度、第三方 bytes renderer 的 owner/useTabInfo、卸载后纯文本回退、关闭 tab signal 取消均通过。原文件、目录、Markdown、配置、侧栏和 HMR 回归通过。已查看 /var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-native-document.png，原聊天/工作区标签与文件入口保留。#56 入口基础统计更新为 44/0/20，不等于完整兼容率。Markdown、HTML、图片、PDF、代码正文实现以及独立 Web 仍须继续接入和验证，不能用纯文本入口替代完整适配目标。

## 进行中：文档预览状态、读取生命周期与实现注册表（2026-09-13）

迁移固定源 ui-sidebar-documentpreview 的 store、face、rpc 和 document/registry。真实 rc.2 runtime.defineStore 持有按标签分桶的页、完整字节、版本、滚动、换行及导航 revision；face 按 generation 丢弃重载前的结果，后续页出现新版本时重新从第一页读取，tab signal 结束忘记状态；实现注册表保持扩展优先、最长后缀优先和稳定快照。

调整限于当前基线：client-store 的 store handle 改用已安装 runtime，BoundActions 用 ui-slots，RemoteResult/Failure 用实际 typert-protocol；文件地址复用已验证 grammar，文档 wire 类型从新平台读结果派生；旧 TypeScript 的 Uint8Array 不带泛型参数。registry 的安全通知采用固定源同等逐个 try/catch，不引入另一套 store。

新增 nativeDocumentReads，将上一轮桌面 result/dispose 操作转换为 face 所需的永不 reject 的结果：保留错误码/详情，拒绝不匹配的成功响应形状，tab signal 取消原生操作，结束后移除监听并 dispose；未提供能力的宿主返回明确 unsupported，不伪装空文档。

58 项测试通过（/tmp/amiba-document-state-tests-4.log）：迁移 55 项 store/face/rpc/registry 测试，加 3 项原生读取转换测试；使用实际 rc.2 ModuleLoader store factory 测试加载器。最初 mock 使用别名导致未被 Vitest 提升，修为标准 vi.mock 后真实 factory 测试通过；Vitest 2 的单次调用断言拆为次数和参数，保留语义；新版 RemoteFailure 测试对象的 name/isDSHRemoteError 改为实际 wire 字段。类型检查退出 0（/tmp/amiba-document-state-types-2.log）。

这些模块尚未在产品注册，不能算 #56 完成；下一步接入 TextPreview、document keyed owner/Hook、标题及各正文实现，并跑真实桌面资源打开、分页、变更、重载和关闭回归。43/1/20 统计不变，完整目标未完成。

## 进行中：文档读取会话授权与桌面 IPC（2026-09-13）

新增 files:read-document/files:cancel-document，通过原 workspaceManager.resolveFileForSession 校验并规范化会话路径后调用读取核心。显式 ok/value 或 ok/error 对象跨 Electron 传递 code/details，避免 throw Error 的自定义字段丢失；原文件预览 read/readBytes/stat 不替换。平台新增可选 readDocument，preload 返回 result/dispose 操作，Electron adapter 与桥接声明已接通。

每个请求归属发起 WebContents 的当前文档；重复 id 拒绝，其他窗口不能取消，主文档导航/销毁中止等待授权或正在读取的请求，最后一个请求结束移除监听。IPC 输入检查不合法操作与缺失身份；范围仍由读取核心严格验证。授权阶段 ENOENT 与原工作区越界拒绝映射到对应文档错误码，未知错误保留为失败而不伪造缺失文件。

11 项核心/IPC/原预览测试通过（/tmp/amiba-document-ipc-tests-2.log，额外断言其他 sender 取消不影响活动 signal）；主进程类型检查退出 0（/tmp/amiba-document-ipc-types-2.log），补齐 global.d.ts 桥接声明后渲染端类型检查退出 0（/tmp/amiba-document-ipc-renderer-types-2.log）。完整桌面构建退出 0（/tmp/amiba-document-ipc-build.log）；--compat --sidebar-right 退出 0（/tmp/amiba-document-ipc-smoke.log）。真实 preload/IPC 验证文本页、字节窗口、完整二进制内容、规范化 metadata/version、缺失/非法范围/二进制/超限错误码、实际工作区及 symlink 越界拒绝、立即取消及重复 dispose。既有侧栏、文件/目录、Markdown、配置和 HMR 回归通过。

文档 owner 与 #56 renderer 仍未接入；通信入口通过不等于完整文档插件可用。继续实现预览状态、分页及各正文类型，统计 43/1/20 不变，完整目标未完成。

## 进行中：文档完整读取与分页读取核心（2026-09-13）

核对固定源 api/workspace-files 的 read/readBytes/readAll 与 fs-local.streamWholeText：文本按 1-based LF 行分页，末尾 LF 不增加空行；严格 UTF-8 解码，开头 8192 字节与返回页拒绝 NUL；默认每页 2 MiB/5000 行，完整读取 32 MiB，超限拒绝而不截断。分页可以读取大于完整文件上限的文件。官方新版部分读取允许工作区外路径，与 Amiba 当前会话授权不同，后续适配保持现有授权边界。

新增 document-file-reader.ts：完整/字节窗口/文本分页共享同一打开文件描述符及其 bigint metadata 版本；分块解码和行计数不缓存跳过的行，支持 AbortSignal，所有路径均 finally 关闭描述符。提供 code/details 错误供后续 IPC 显式序列化，未替换原 readPreviewFile 或 statWorkspaceFile。行分页迁移保留 DeepSeek MIT 归属，并加入桌面 LICENSE.deepseek。

7 项真实文件测试通过（/tmp/amiba-document-reader-tests.log），包含 5 项文档读取测试和 2 项原文件预览回归：空文件/空行/尾 LF/CRLF/越界页、跨 64 KiB UTF-8、超限及边界、二进制和损坏编码、完整读取及字节窗口、非法范围、文件缺失/目录及开始前/打开期间取消。主进程 TypeScript 检查退出 0（/tmp/amiba-document-reader-types.log）。

此处完成读取核心，尚未接入产品调用；下一步必须连接会话授权、保留 code/details 的 IPC、取消与文档 owner/renderer 生命周期。不能把辅助函数测试计为 #56 文档入口完成。43/1/20 统计不变，完整目标仍未完成。

## 进行中：侧栏窄屏自动全屏（2026-09-13）

按固定源 SidebarRight.tsx 的 viewportWidth < 768 规则派生自动全屏，使用 resize 外部快照读取当前视口，不修改已保存 layout.mode；变宽后自动回到手动模式。窄屏点击退出全屏与固定源一致：收起并设置 push。仅影响新增侧栏展示，原工作区轨道、文件预览、尺寸和样式不改写。

组件测试通过 767/768px 边界、自动模式不写入 store、手动全屏跨尺寸保留、窄屏退出恢复原预览、重新打开自动全屏及正文挂载计数不变；测试和类型检查退出 0（/tmp/amiba-sidebar-narrow-tests.log、/tmp/amiba-sidebar-narrow-types.log）。完整桌面构建退出 0（/tmp/amiba-sidebar-narrow-build.log）；--compat --sidebar-right 退出 0（/tmp/amiba-sidebar-narrow-smoke.log）。实际 CDP 视口覆盖确认 767px 全宽及 tabInfo.fullscreen=true，768px 恢复普通面板及 false；窄屏退出收起、重新打开全屏、恢复原视口后回到普通模式，正文挂载计数不增加。既有会话切换、收起草稿保留、全局 main、浮动/手动全屏、菜单、原文件/目录、Markdown 和 HMR 回归均通过。

原生工作区其他隐藏路径、文档正文、完整第三方插件与独立 Web 继续核对；43/1/20 统计不变，完整目标未完成。

## 进行中：侧栏收起时保留正文组件（2026-09-13）

固定源 ui-sidebar-right/src/client/shell/SidebarRight.tsx 明确要求收起时正文仍挂载。Amiba 原 WorkspacePane 在预览模式不渲染扩展 content，上一版只保留 store/occurrence，正文局部状态会丢失。

现由持续挂载的 tab 席位持有 DockSurface React portal，每会话注入共享 dockHost；content 席位只把同一容器放进原内容区或手动全屏位置，卸载时移除容器但不卸载正文 React 树。重新展开复用同一树；整体会话席位卸载仍按既有规则清理。没有改变原 WorkspacePane 的条件渲染、文件预览、尺寸、标签或样式。

组件测试确认收起恢复原预览、正文不在页面上、再次展开挂载次数不增加；327 项侧栏回归退出 0（/tmp/amiba-sidebar-retained-regression.log），类型检查退出 0（/tmp/amiba-sidebar-retained-types.log）。完整桌面构建退出 0（/tmp/amiba-sidebar-retained-build.log）；--compat --sidebar-right 退出 0（/tmp/amiba-sidebar-retained-smoke.log）：实际插件正文写入局部草稿，收起后恢复原预览，展开后草稿仍在且挂载计数不增加；既有会话隔离、全局 main、浮动/全屏、菜单、文件/目录、Markdown、配置及 HMR 回归通过。

本轮补齐收起正文局部状态保留，不扩大为所有跨会话局部状态保留；整体会话视图卸载仍会卸载正文。原生工作区其他隐藏路径、窄屏自动全屏、文档正文、第三方完整插件与独立 Web 仍继续核对，43/1/20 统计不变，完整目标未完成。

## 进行中：右侧栏会话实例与原生工作区身份对齐（2026-09-13）

NativeSidebarSeat 按 sessionId 隔离 React 实例，继续复用框架的会话 store 与 occurrence。组件回归先复现两个展开会话切换后被误判成关闭的问题，修复后验证会话恢复、快照不受另一会话修改、旧标签回调仍操作原会话及 signal 保留。

真实桌面新增 A/B 会话测试：不同 cwd 避免触发原 Host fixture 的替换；正文记录首次挂载会话，检查 React 状态未串用。首次测试返回 A 超时；第二次挂载轨迹显示 A 曾出现后又返回 B，不能据此算作通过。进一步给工作区 owner 附加可选 workbenchSessionId，原生与官方会话选择尚未对齐时不挂载侧栏内部实例，避免将新 store 与旧工作区控制器组合。原工作区能力、状态结构与样式不变。

组件测试 2 项退出 0（/tmp/amiba-sidebar-session-tests-4.log），包括身份不一致期间无服务绑定、拒绝公开写入、对齐后正常恢复；类型检查退出 0（/tmp/amiba-sidebar-session-types-2.log）。完整桌面构建退出 0（/tmp/amiba-sidebar-session-build-2.log）。第三次桌面测试确认过渡期间拒绝 openTab，测试等待条件改为同时等待原生工作区身份对齐。第四次运行在侧栏开始前的配置保存检查丢失页面测试引用，保留 /tmp/amiba-sidebar-session-smoke-4.log。第五次完整回归退出 0（/tmp/amiba-sidebar-session-smoke-5.log）：A/B 往返、正文首次挂载会话、原标签 signal、旧回调操作 A 而不改变 B、全局页面/浮动/全屏恢复、菜单及原文件、目录、Markdown、配置和 HMR 均通过。

实际桌面会话往返已验收。原生工作区其他隐藏路径、收起正文局部状态保留、窄屏、文档正文与独立 Web 继续核对；43/1/20 统计保持不变，完整目标未完成。

## 进行中：官方 main 页面隔离及工作区重挂载恢复（2026-09-13）

NativeSidebarSeat 读取公共 usePanelInfo，官方 main 页面选中时不绘制右侧栏正文、标签或浮动层，并在 layout effect 中释放当前会话控制器绑定。公共写操作因此遵循已有 no-session-surface 拒绝语义；adopted store 与 occurrence 不释放。返回时重新绑定并从已保存布局恢复面板，保留标签 id、signal、布局和手动全屏模式。未改动原工作区、文件预览或样式。

真实桌面先暴露了组件测试遗漏的生命周期：WorkspacePane 在 visible=false 时直接返回 null，标签和正文都会卸载；释放时原 closePanel 恢复文件预览，而 store 仍 expanded=true。只跟踪同一实例的可见性变化无法恢复新实例。/tmp/amiba-sidebar-global-smoke-5.log 的挂载轨迹及布局快照确认了这一点。现在首次挂载也从 store 恢复，不将恢复过程当成用户关闭；active 已与 expanded 一致时不执行多余状态写入。Portal 容器的位置同步也依赖会话视图可见性，确保保留实例的嵌入方式可正常恢复。

组件测试改为真实卸载/重挂载，使用已安装运行时 store 与 renderer 绑定：全局页面期间不能执行公开写操作，浮动和正文消失，返回后恢复正文及浮动，store 快照身份保持不变。测试退出 0（/tmp/amiba-sidebar-global-tests-4.log），类型检查退出 0（/tmp/amiba-sidebar-global-types-2.log）。

完整桌面构建退出 0（/tmp/amiba-sidebar-global-build-3.log）。--compat --sidebar-right 退出 0（/tmp/amiba-sidebar-global-smoke-6.log）：实际记录并断言标签席位卸载、重挂载；验证全局页面期间拒绝 openTab、原标签 id/signal 保留、浮动返回并停靠、全屏隐藏及恢复、原文件/会话/目录/Markdown/HMR 回归。测试曾将公开 dock 误写成内部动作名 unfloat，已修正测试；诊断观察器的 effect 返回值也已改为 void，未因此改变产品接口。

此轮验证范围是官方 main 页面；实际会话切换、原生工作区和 pane 隐藏路径、收起时正文局部状态保留、窄屏自动全屏、文档正文与 Web 仍继续核对。43/1/20 统计不变，完整目标仍未完成。

## 进行中：右侧栏实际面板、四个扩展入口与公开服务（2026-09-13）

将 Dockkit 接到现有 amiba.workbench.panel 会话插槽：复用框架 store handle、adoption、普通/keyed 注入和 hookContext，声明 pane.tab、pane.tab.title、tab.menu.item，注册 guide 类型及其 tab.guide chain 子槽。公开 ctx.sidebarRight 控制器。未替换 Amiba 的 WorkspacePane、文件预览或聊天组件；附加标签使用已有扩展标签类，关闭通过原 closePanel 恢复先前视图。

宿主仅在选中扩展时挂载正文，因此公开服务绑定和浮动层由持续挂载的标签实例持有；正文把测量结果通过会话注入闭包共享给绑定，控制器可按实际分栏空间处理 split。收起时保留 store、occurrence 和资源 pin，浮动层不随正文卸载。guide/标签标题迁移固定源，沿用真实 rc.2 primitives。模块 CSS 通过同一构建得到的 inline 文本注入，已确认 class hash 匹配；插件清理移除其样式。原界面样式未改写。

真实启动首先暴露 locale 缺少注入授权（/tmp/amiba-native-sidebar-smoke.log），改为在 ctx.inject(['locale']) 子作用域注册及清理，保持没有 locale 的宿主仍能加载原界面。初次构建还发现 primitives 缺少模块到达声明，已补 dsh.client.external，未升级运行基线。Smoke 插件的 chain.select 和 list.id 缺项分别修正；这些修改限于测试注册参数。

首次实际截图发现正文高度未撑满、文字控制占据标题栏，改为完整 flex 高度及本地紧凑图标控件；仅给新面板设置字号变量。全屏与普通模式共用稳定的 portal 容器，移动容器位置而不重建正文组件。真实 React/store 测试验证正文未挂载时仍可通过服务打开、收起恢复原预览、浮动保留、完整移除后恢复与资源取消，以及全屏往返正文不重新挂载。

最终 326 项右侧栏测试通过（/tmp/amiba-native-sidebar-regression-2.log），类型检查通过（/tmp/amiba-native-sidebar-types-5.log）。完整桌面构建退出 0（/tmp/amiba-native-sidebar-build-5.log）；--compat --sidebar-right 退出 0（/tmp/amiba-native-sidebar-smoke-5.log），实际插件验证正文/标题 Hook、guide 替换链、菜单 tab/dismiss、重复导航 revision、收起后资源生命周期、类型卸载 fallback、面板恢复、真实正文高度及全屏往返挂载次数。原文件、会话、目录、Markdown 和 HMR 回归通过。实际截图 /var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-native-sidebar.png 已查看，原聊天与文件标签保留，新控件不再挤占标题栏。

入口基础统计更新为 43/1/20：54、55、57、58 现在有真实桌面接入证据，56 文档正文仍未接入。不是完整兼容率。下一步必须处理全局主面板切换时暂停右侧栏绑定/浮动、实际会话切换与恢复、窄屏自动全屏、guide fallback/多入口、完整文档读取和独立 Web。正文目前按原工作区生命周期在收起/切回预览时卸载，官方收起时保留组件局部状态的语义仍须核对并适配；仅 store/occurrence 保留已证实。不得据本轮测试宣称全部右侧栏或第三方插件已兼容。

## 进行中：完整 Dockkit React 交互层（2026-09-13）

迁移固定 c291e796 的 DockSurface、FloatLayer、PaneTree、TabPanel、TabTitle、TabMenu、指针所有权、DOM 测量、渲染类型和 CSS module，共 10 个文件；与固定源逐文件比对，仅 MIT 归属及 .ts/.tsx→.js 导入后缀不同。纯引擎 index 保持不导入 React/CSS，单独 react.ts 提供 UI 入口，避免模型消费者意外加载 DOM 样式。模块样式没有全局 body/root 选择器；尚未导入实际产品面板，因此未改变现有 UI。

显式加入开发依赖 clsx 2.1.1 和 UI primitives 0.1.1-rc.2，用已有宿主 external 提供生产 primitives。首次 catalog 规格不存在，改为固定实际 rc.2；安装退出 0（/tmp/amiba-dock-ui-install-3.log），没有升级运行基线。Vitest 配置保留原 Vite 配置，只对 primitives 内联转换，使真实包的 CSS 可以加载；未用空组件替代 Tooltip 或图标。

新增迁移 79 项组件测试与 5 项 DOM 测量测试。适配 Vitest 2 的断言名称（一次调用+参数分开断言），保留原断言语义；本地 jsdom 没有 PointerEvent，测试内用带 pointerId 的 MouseEvent 子类保留坐标，解决原先 21 项拖拽失败和 NaN。生产手势逻辑保持原样。84 项通过（/tmp/amiba-dock-ui-tests-4.log），随后全部右侧栏 325 项通过（/tmp/amiba-dock-ui-regression.log），类型检查及插件包构建退出 0（/tmp/amiba-dock-ui-types-2.log、/tmp/amiba-dock-ui-build.log）。

覆盖 tab/body/title 显示、菜单外部条目、拖拽落点及取消、另一指针隔离、分栏空间限制、浮动移动缩放、卸载清理和嵌入控件。jsdom 几何由测试提供，不等于真实浏览器布局验收；实际 pane 席位、服务注册和原生面板整合仍待接入。此阶段没有把组件测试计入入口兼容数，39/5/20 不变。

## 进行中：框架会话 store 的控制器 adoption 生命周期（2026-09-13）

增加 createSidebarRightSessionStore，供后续面板与标题席位共享同一个真实 runtime handle；由框架创建实例时按 scopeKey 交给控制器 adopt，不另造会话缓存或替代 store。未带 scopeKey 的实例不冒充会话；所有 adoption 随席位注册所有者释放，重复 dispose 幂等，已释放所有者拒绝再创建实例。TabDomain 的最终释放仍归外层插件，确保先移除席位和监听，再取消所有资源 occurrence。

241 项右侧栏测试通过（/tmp/amiba-session-store-tests-3.log）：新增真实 rc.2 store、控制器、注册表联合测试，验证多会话隔离、标签回调操作原会话、资源 pin、owner 释放后旧回调不再修改 store、停止订阅后 store 提交不再驱动资源生命周期、最终 domain dispose 取消资源。首次测试直接加载仅供浏览器的 ModuleLoader bundle 报 window 未定义，改用已有完整 factory 测试加载器后通过，未改生产逻辑。类型检查见 /tmp/amiba-session-store-types-2.log。

此处完成的是后续实际注册会使用的生命周期连接，尚未调用到产品面板入口；不把内部测试算作五项右侧栏 UI 已可用。实际席位、公开服务、正文和跨平台验证继续，原有能力和样式未变，39/5/20 不变。

## 进行中：扩展 entry 的 keyedHooks 通用绑定（2026-09-13）

实际组装右侧栏前发现 rc.2 的 bindInjectHooks 仅处理普通 hooks，之前根级标准来源适配尚未覆盖 entry.inject.keyedHooks。现回补该通用入口：按名称生成 useX Hook，复用根级 keyed source 的稳定绑定与缺失值逻辑，同时移除注入容器并保留业务属性及普通 Hook。框架持有的 SlotHookFactory/hookContext 不变；没有用逐个组件手动绑定掩盖通用契约缺口。

实际 ui-slots 包导出 KeyedStandardSource、KeyedHooksSources、KeyedSnapshotSelectorHook 和 PropsKeyedHooks，InjectFace 同时映射普通与 keyed 容器；删除上一阶段临时本地同形类型，tabInfo 与测试 helper 改用公开类型。两个 rc.2 补丁与锁文件 hash 已同步，未升级依赖版本。根目录离线安装退出 0（/tmp/amiba-keyed-install.log）。

实际 renderer 绑定的 5 项 React 测试通过（/tmp/amiba-entry-keyed-tests-2.log）：新增注入时不求值、复用绑定、普通与 keyed 来源共存、业务属性保留、来源更新、切键退订、缺失键及卸载清理。最初 helper 漏提取 bindInjectHooks 声明，补齐测试加载后通过。静态类型检查通过（/tmp/amiba-entry-keyed-types.log）。资源和右侧栏回归日志确认 17 个文件、318 项测试全部通过（/tmp/amiba-entry-keyed-regression.log）；完整桌面构建日志到达最终依赖核验成功（/tmp/amiba-entry-keyed-build.log）。这两次工具会话返回在上下文压缩时丢失，未恢复退出码；进程已结束且成功结尾完整，不重复构建。

真实桌面 --compat --resources --root-providers 退出 0（/tmp/amiba-entry-keyed-smoke-2.log）：entry 注入经真实 ModuleLoader/renderer 验证普通和 keyed Hook、业务属性、值更新、切键、缺失键及卸载订阅清理；根级来源、共享资源流与原文件、会话、配置、Markdown、HMR 回归通过。首次 smoke 的普通 useFixed 调用漏传必需 selector，报错明确位于测试插件；补上 selector 后通过，未修改产品接口（/tmp/amiba-entry-keyed-smoke.log）。源码 diff 检查通过；补丁文件只报告合法 unified diff 上下文标记空格后接原始 tab，不改写补丁上下文。

右侧栏真实 pane、公开服务与正文仍未挂载；本节只完成通用 entry keyedHooks 前置能力，现有 UI 和 39/5/20 统计不变。

## 进行中：右侧栏 tabInfo Hook 与插槽类型契约（2026-09-13）

迁移固定 c291e796 的 tabInfoFactory/guideTabInfoFactory：从框架提供的会话 store 和按 tabId 绑定的导航 source 组合信息，只有已提交的布局记录且导航仍绑定时才可读取；找不到任一部分即拒绝，避免已关闭标签继续显示旧快照。正文可见性跟随 activeTab，标题在侧栏展开时允许未选中标签，浮动标签保持可见；signal/actions 来自 occurrence，移动或折叠不替换生命周期。

增加 pane.tab、pane.tab.title、tab.guide、tab.menu.item 的类型契约与本地同形 KeyedSnapshotSelectorHook；沿用 rc.2 原生 hookContext/SlotHookFactory，没有改写框架。导航类型复用已迁移文件。rightbar.session/root 所有权、完整 locale namespace 及真实注册/挂载仍未处理，不能将类型声明当作入口已可用。

239 项右侧栏测试通过（/tmp/amiba-tab-info-tests-3.log）：新增 3 项官方已提交关系测试和 1 项正文/标题/折叠/浮动/身份稳定的真实 React Hook 测试，使用真实 rc.2 store 与已打补丁 renderer 的选择器绑定。测试 helper 初次使用 import.meta.url 时被 jsdom/Vite 转成浏览器 URL，Node createRequire 拒绝；改为已知插件测试目录下的绝对文件路径后通过，未改生产逻辑。Helper 放在 src/dev，不进入产品输出。类型检查（/tmp/amiba-tab-info-types-2.log）和插件包构建（/tmp/amiba-tab-info-build.log）均退出 0；尚未做实际桌面 pane 验证。

后续继续把这些 hookContext 绑定到实际右侧 pane，补 body/title/guide/menu 渲染、文件正文和平台验证；当前 UI 和 39/5/20 统计不变。

## 进行中：右侧栏会话状态、控制器与默认页（2026-09-13）

迁移固定 c291e796 的 stores/service/defaultSeed 及 guide 元数据定义。状态动作使用已安装 rc.2 的真实 runtime/client.defineStore 与 EngineStoreHandle，保留官方 BoundActions 契约，未以本地仿制 store 替代。布局变更仍由纯规划器产生，整次操作记录一个历史条目；页面按 pane 去重，资源按 kind/contentId 揭示，替换/浮动/停靠/分栏/关闭/撤销重做遵循官方规则。控制器区分当前挂载席位与已采用的会话 store，标签自身动作始终指向原会话；过期的 binding/adoption 释放不清除新的所有者。

guideDefinition 只迁移注册元数据，翻译参数限定为它实际调用的 tab.guide.title；尚未注册完整 sidebarRight 文案命名空间或渲染 guide 组件。pure navigation 类型与服务契约保持结构一致，尚未把 ctx.sidebarRight 暴露成没有真实席位的公共服务。

235 项右侧栏测试通过（/tmp/amiba-sidebar-service-tests-3.log）：新增 23 项官方状态测试、31 项官方控制器测试，并恢复此前因未迁移 defaultSeed 而暂缺的 1 项注册表测试。测试执行完整已安装运行时 ModuleLoader factory，使用真实 Cordis 和 SlotCore；最初仅提取词法声明遗漏 Immer arrayTraps 初始化，导致 46 项失败（/tmp/amiba-sidebar-service-tests.log），修正测试加载方式后通过，未为测试修改生产状态逻辑。测试辅助放在 src/dev，排除出生产输出。

类型检查通过（/tmp/amiba-sidebar-service-types-2.log），插件包构建退出 0（/tmp/amiba-sidebar-service-build.log）。控制器尚未连接现有桌面 pane、tabInfo/body/title/menu，因此没有把这些内部测试记为五项右侧栏 UI 已兼容；当前能力和样式未改动，39/5/20 统计不变。

## 进行中：右侧栏停靠模型与标签生命周期（2026-09-13）

迁移固定 c291e796 的纯 Dockkit engine/contract：布局树、初始状态、操作及逆操作、序列历史、意图规划、控制器、约束和几何计算。未迁移 React surface 或样式，未替换现有右侧栏。10 个 engine/contract 文件已与固定源逐一比较，除 MIT 归属和 .ts→.js 导入后缀外完全一致；纯引擎入口不导出未迁移的 React 组件。141 项官方引擎测试原样语义迁移通过。

迁移 TabDomain 与导航参数/placement/actions 的纯类型契约：按会话和标签 id 保存 occurrence，布局提交时 pin 资源，标签消失才 abort，折叠或隐藏不释放；撤销关闭创建新 occurrence；动作始终传原会话与标签当前所在 pane。navigation 使用已验证的完整快照存储，未引入新版 store 的 Immer draft/persist 或开发态深冻结。尚未声明/注册右侧栏 UI 插槽，不把纯模型迁移算作五项入口接入。

右侧栏目录 180 项测试通过（/tmp/amiba-tab-resources-tests.log）：141 项引擎、26 项已有注册表、12 项官方 TabDomain、1 项真实 ResourceRegistry + DockController + TabDomain 联合测试。联合测试验证提交后自动 pin、复制标签共用资源流、折叠保留、最后关闭释放、撤销重新获取和稳定 source 引用。品牌及 Session 类型显式依赖固定 rc.2，仅加入 devDependencies，pnpm 锁只增加两个依赖入口；无运行时依赖升级。首次类型/构建发现缺少 Session 类型依赖，补齐后类型检查通过（/tmp/amiba-tab-domain-types-2.log）。测试夹具目录已排除出生产声明/代码输出。插件包构建退出 0（/tmp/amiba-tab-domain-build-2.log）；本轮未改动桌面运行入口或挂载组件，因此没有把包构建当作桌面右侧栏验证。

后续必须接会话 store adoption、公开 sidebarRight 控制器、真实 pane 席位及 tabInfo/body/title/menu；本阶段组件尚未挂载，未宣称真实桌面右侧栏兼容，39/5/20 统计不变。

## 进行中：文件监听跟随会话工作区重绑定（2026-09-13）

files:observe-resource 订阅对应会话的 WorkspaceChange；每次重绑定先取消旧原生观察，读取当前根目录并建立新一代观察，变化通知受代际与取消状态约束。初次订阅尚未 ready 时发生目录切换，必须等待最新代完成；旧设置迟到失败不会取消新代。首次成功后的重绑定设置失败保留工作区变化订阅，之后可从有效绑定恢复。资源解除持有或文档结束时也清理 WorkspaceChange 订阅。

原生路径/事件及 IPC 生命周期共 4 项测试通过（/tmp/amiba-file-rebind-tests.log）；新增测试覆盖无关会话不重启、旧代取消、最新代就绪、迟到通知隔离、重绑定失败后恢复和订阅清理。主进程类型检查通过（/tmp/amiba-file-rebind-types.log）。

完整桌面构建退出 0（/tmp/amiba-file-rebind-build.log），--compat --resources 退出 0（/tmp/amiba-file-rebind-smoke.log）：在两个真实工作区间切换同一会话，元数据 canonicalPath 和原生事件均跟随新目录，修改旧目录不触发观察回调，随后恢复原工作区；ready/提前取消/越界拒绝、缺失恢复和原文件/会话/配置/Markdown/HMR 回归通过。仍保留元数据周期校验用于事件遗漏恢复；官方错误契约、文档正文及右侧栏尚需继续，39/5/20 统计不变。

## 进行中：文件事件接入 IPC 与资源提供器（2026-09-13）

新增 files:observe-resource/unobserve-resource 及 preload 的 WorkspaceFilesAdapter.observe，返回 ready/dispose。先在 preload 安装事件接收，再发起主进程订阅；初始 ready 等待实际 Chokidar 发现完成，允许 ready 前取消；注册失败自动移除接收器。主进程按发送窗口及订阅 id 隔离，最后订阅释放后移除窗口监听；窗口销毁或主文档导航会取消该文档的全部订阅，页内导航保留。

file provider 在观察就绪后执行初始 stat；通知计数避免丢掉等待读取期间到达的事件，并唤醒正在等待的资源，最后持有者取消时关闭观察。保留每秒元数据校验，以覆盖操作系统丢通知、无法建立监听和工作区绑定变化。工作区重绑定后重新绑定原生观察、上游完整 RemoteFailure 类型与独立 Web 仍待完善；本阶段没有承诺捕获所有中间写入或完整复制官方 change-feed。

原生文件/IPC 所有权 3 项测试通过（/tmp/amiba-file-events-native-tests.log），包括旧页面设置未完成时导航、新页面已订阅后旧设置失败、跨窗口取消隔离和销毁取消。资源目录 78 项测试通过（/tmp/amiba-file-events-tests-3.log）：新增就绪前不 stat、读取中通知触发立即重读、等待中通知唤醒及取消释放；早期回归发现无观察平台 await undefined 改变旧时序，改为仅观察存在时等待 ready 后恢复通过。主进程和渲染端类型检查通过（/tmp/amiba-file-events-main-types-2.log、/tmp/amiba-file-events-renderer-types.log）。

完整桌面构建退出 0（/tmp/amiba-file-events-build.log），--compat --resources 退出 0（/tmp/amiba-file-events-smoke.log）：真实 Electron observe.ready、初次缺失文件的创建通知、就绪前取消、越界观察拒绝及 dispose 后停止回调通过；实际 useResource 的缺失/创建/更新/删除/重建与卸载清空、资源共享生命周期和原配置/会话/文件/Markdown/HMR 回归通过。窗口导航/销毁清理由上述 IPC 所有权测试验证，此次桌面没有另做真实窗口销毁用例。构建结束后仅移除提供器文件末尾多余空行，不改变运行逻辑。

## 进行中：文件资源原生事件监听基础（2026-09-13）

新增 workspace-file-observer：待监听文件尚不存在时，从最近存在的祖先 realpath 起检查工作区边界，允许缺失后缀，但拒绝指向外部的祖先和悬空符号链接；该校验仅用于监听，后续文件读取仍须重新授权。Chokidar 仅沿目标的祖先目录链递进，忽略其他子树及目标变成目录后的后代；返回前等待 ready，AbortSignal 和幂等 disposer 负责关闭 watcher。

首次真实事件测试失败（/tmp/amiba-file-observer-tests.log），第二次仍失败（/tmp/amiba-file-observer-tests-2.log）：逐步核实缺失多层父目录需要沿目录链发现，而 macOS Chokidar fsevents-handler 的 opts.persistent 分支才启动持续监听。已启用 persistent 并保留确定关闭生命周期。修复后真实文件测试通过；扩展父目录删除重建与无关路径隔离后仍通过（/tmp/amiba-file-observer-tests-4.log）。校验测试同时覆盖绝对/相对/符号链接越界、悬空链接、目录拒绝及工作区内链接的规范路径。

主进程类型检查通过（/tmp/amiba-file-observer-types-2.log）。本阶段只完成主进程监听组件及真实文件事件验证，尚未连接 IPC/preload/provider；产品仍使用上一阶段元数据校验。下一步接入订阅就绪、事件转发、窗口销毁和资源取消，不将该组件单独记为事件流或右侧栏完成。

## 进行中：真实 file 资源提供器与状态恢复（2026-09-13）

在具备真实 WorkspaceFilesAdapter.stat 的平台注册 file provider，通过现有 ResourceRegistry / useResource 接入文件元数据。按地址原样传 sessionId/path 给主进程，不从会话摘要推断路径；无 Session 的 absolute 地址返回 unknown-workspace，非法地址返回 unsupported-address。未实现 stat 的平台不注册伪提供器。

rc.2 原监听没有完整 change-feed 语义，因此本阶段采用持有期间的每秒元数据校验：首读立即开始，同值去重，失败后继续重试，文件删除/重新创建及原工作区树忽略的目录可恢复；最后持有者取消后清理等待定时器，不再请求，迟到 IPC 结果丢弃。失败保留最后成功值由真实 ResourceRegistry 处理。此方式约有一秒加 IPC 耗时的更新延迟，按活跃地址产生 stat 请求，不保证捕获两次检查间的短暂变化；它是状态适配进展，不是新版官方事件流的完整等价实现。后续仍需事件驱动监听/错误契约完善与独立 Web 验证，五项右侧栏与 39/5/20 统计不变。

验证：资源目录 77 项测试通过（/tmp/amiba-file-provider-resource-tests.log），其中新增提供器测试覆盖缺失恢复、版本/大小更新、重复帧去重、删除重建、取消清理、迟到结果和未授权地址不触发后端。首次类型检查发现测试回调参数遮蔽 typeof value，修正测试命名后通过（/tmp/amiba-file-provider-types-2.log）。完整桌面构建退出 0（/tmp/amiba-file-provider-build.log），--compat --resources 退出 0（/tmp/amiba-file-provider-smoke.log）：真实 useResource 插槽读取 .cache 中带空格/#/? 的文件，初次缺失、创建、修改、删除保留旧值、重建及卸载清空状态均通过；共享流、pin、取消、元数据权限和原会话/配置/Markdown/文件/HMR 回归通过。默认 HOME 通过相同 stat 路径实现，但此次没有独立写入 HOME 的桌面用例，不扩大实测结论。

## 进行中：文件资源真实元数据接口（2026-09-13）

增加可选 WorkspaceFilesAdapter.stat，经 Electron preload 的 files:stat 路由到主进程；调用原 resolveFileForSession 完成工作区 realpath 与越界检查后，仅 stat 文件，不读取正文。返回 canonical absolutePath、完整 bytes 与 opaque version；版本包含设备、inode、大小及纳秒 mtime/ctime，检测替换与恢复 mtime 的写入。原 read/readBytes、预览上限和 UI 不变；不向缺少后端的 Web 平台伪造实现。

真实文件测试覆盖超过 32 MB 的二进制元数据、稳定重复读取、同大小替换、目录拒绝与删除；保留原二进制往返和文本上限回归。文件监听及官方 file provider 尚未接通，不能把 stat 单独算作文档扩展完成。现有监听还会忽略 node_modules 等目录且不监听默认 HOME；后续需要针对资源的监听，不能仅复用工作区树事件并宣称完整覆盖。

验证：2 项真实文件测试通过（/tmp/amiba-file-stat-tests.log）；主进程类型检查通过（/tmp/amiba-file-stat-node-types.log）。首次渲染端检查发现独立 global.d.ts 缺少桥接声明，已补齐 WorkspaceFileStat 导入和 stat 方法，复查通过（/tmp/amiba-file-stat-renderer-types-2.log）。完整桌面构建退出 0（/tmp/amiba-file-stat-build.log）；构建后唯一生产侧修改为不影响输出的 .d.ts 声明。--compat 桌面 smoke 退出 0（/tmp/amiba-file-stat-smoke.log）：通过真实 IPC 核实相对/绝对地址同一 canonical 身份、大文件完整大小、目录拒绝，以及绝对越界、相对越界、符号链接越界拒绝；原文件预览、Markdown、会话、配置与 HMR 回归通过。

## 进行中：文件资源地址协议（2026-09-13）

按固定 c291e796 迁移 file-address 的构造、解析及 48 项上游测试，通过 shell 客户端入口导出 sessionFileAddress、absoluteFileAddress、parseFileAddress 和 FileAddress。保留 Session 身份、POSIX/Windows/UNC 路径、单次解码和未归一化的点路径；授权仍由后端处理，地址解析成功不代表有读取权限。源文件保留 MIT 归属，由现有客户端许可 banner 覆盖。

48 项测试通过（/tmp/amiba-file-address-tests.log），shell 类型检查（/tmp/amiba-file-address-types.log）与包构建（/tmp/amiba-file-address-build.log）退出 0。本次未改动界面或现有文件预览，也未将纯协议测试记为文件 provider 或五项右侧栏完成。

继续接入前已核实：官方 file 资源只返回 absolutePath/version/bytes 元数据，正文另读；原生 readPreviewFile 会读取并限制正文大小，不能代替 stat。现有 files:watch 在注册时 realpath 失败会跳过该路径，且前端 watch 不暴露注册就绪状态，因此不能直接满足先监听后 stat、初次不存在后创建恢复的官方语义。后续需要补齐真实元数据接口和监听契约，保留原预览权限验证及读取行为。39/5/20 统计不变。

## 进行中：资源来源、引用保留及根级 useResource（2026-09-13）

迁移固定 c291e796 的 ResourceRegistry 与公开契约：ctx.resources 按协议注册 provider，source(address) 返回稳定引用，订阅者与 pin 共用同一流，最后一个持有者释放时 abort 并清空状态；provider 停用变为 none，重新注册可重新读取，失败帧保留上次成功值，取消后的迟到帧丢弃。通过 provideRoot keyedHooks.resource 绑定真实全局 useResource。此阶段没有内建 file/document provider，不能把自定义测试流当作已接通官方文件资源或右侧栏。

资源模型私有存储只需要完整快照替换：以本地同步、Object.is 去重、订阅异常隔离的 ObservableSnapshot 实现替换新版 client-store 依赖，未引入其 draft/persist/raf 功能；生产快照语义保持，未迁移开发态 Immer 深冻结。MIT 许可已由 shell 客户端 banner 覆盖。

类型核对发现 module augmentation 无法代替新版插槽包的实际导出入口。新增 ui-slots rc.2 类型补丁，把 ResourceProtocolMap 和 RootStandardSourceContribution/Binding 放回词法定义处，并在原 SlotRendererHost 定义上增加 root；删去 runtime 补丁中那段补充类型声明。实际类型测试验证协议值映射、根槽 useResource 泛型以及原 host.sessions 仍有有效类型，而非退化为 any。

24 项迁移生命周期测试原先通过；另加“provider.open 同步取消 pin”用例，旧实现失败（/tmp/amiba-resources-pin-red.log）：hold 启动读取之后才监听 abort，会错过同步取消并泄漏持有。现在先绑定监听再 hold，原有及新增测试全部通过；加 1 项类型契约测试共 26 项（/tmp/amiba-resources-tests.log），shell 类型检查通过（/tmp/amiba-resources-types.log），根状态补丁的 4 项回归通过（/tmp/amiba-resources-root-regression.log）。

首次完整构建因托管树没有独立 ui-slots 包而失败（/tmp/amiba-resources-build.log）。已把相同 0.1.1-rc.2 的契约包加入 shell 直接依赖并运行 runtime:lock；分发锁只新增该包，不能跳过补丁验证。重新构建退出 0（/tmp/amiba-resources-build-2.log），实际托管 ui-slots 类型入口已确认导出资源协议表，runtime 中旧补充声明也已移除。--compat --resources --root-providers 退出 0（/tmp/amiba-resources-smoke.log）：真实全局 hook、两个组件共用流、pin 跨组件卸载保留、最后引用释放中止、稳定 source 重新打开、调用方 fiber 卸载协议后返回 none 均通过；根级来源及既有配置/会话/文件/Markdown/HMR 回归也通过。完整目标及 39/5/20 统计不变，Tab occurrence、真实 file/document provider、右侧栏 body/title 和面板布局继续处理。

## 进行中：右侧栏标签类型注册与资源路由规则（2026-09-13）

迁移固定 c291e796 的 SidebarRightTabRegistry，并通过真实 ctx.reflect.provide 暴露 sidebarRightTabs。此服务只负责类型注册与选择：按地址 glob/canOpen、extension/builtin/fallback 优先级、匹配长度和注册次序选取查看器；允许一个 extension 临时接管 builtin，同 band、重复 id 与 fallback 同 kind 冲突均拒绝；卸载恢复原定义和 guide 元数据。阶段二的标签 body/title 分发、资源读取和生命周期还未接入，不能把这个注册服务算作五项右侧栏完成。

源文件与 26 项相关上游测试按 MIT 迁移（排除尚未迁移 defaultSeed 的一项）；仅替换旧版不存在的 notifySubscribers 小辅助及图标 props 类型依赖，匹配库使用固定 picomatch/posix 4.0.4。LICENSE.deepseek 随 npm 文件列表发布，完整版权许可也通过 Vite banner 写入客户端生成文件，覆盖 managed runtime 只复制 lib 的分发路径。

26 项测试通过（/tmp/amiba-right-tabs-tests.log），shell 类型检查通过（/tmp/amiba-right-tabs-types.log）。首次构建被运行时依赖锁检查拒绝：picomatch 最初误放生产 dependencies；其代码实际由 Vite 打包且不在 external 中，已移到开发依赖，保留原运行时依赖锁。修正后的完整构建退出 0（/tmp/amiba-right-tabs-build-2.log），managed runtime 的实际 client.js 也已确认带完整许可。--compat --right-tab-registry 退出 0（/tmp/amiba-right-tabs-smoke.log）：实际服务注入、地址选择、扩展接管、冲突拒绝后快照保留、调用方 effect 随 fiber 卸载恢复原定义、最后移除贡献均通过；既有设置、会话、文件、Markdown 和 HMR 基础回归通过。

新的服务范围核对：新版 sidebarRight 不只是开关面板；还包含分栏、浮动、停靠、每会话 Tab occurrence、资源 pin、导航 revision 和跨会话稳定 tabActions。必须迁移真实状态和资源模型并接到当前工作台，不能用空实现或假 TabRecord 填入 owner。完整目标与 39/5/20 统计保持不变。

## 最新进展：左侧全局面板图标列表（2026-09-13）

第 53 项 sidebar.panellist 已接入原侧栏：metadata source 使用真实 SlotCore 的入口版本、order、label 与 main 注册状态；列表和 main 的迟到注册/卸载均触发更新，不调用图标的 inject 工厂。沿用 NavigationRow 的布局和样式，展开态向图标传 size=16 和实际 active。缺少匹配 main 时按钮禁用，避免把无效导航错误抛到点击处理；目标注册后自动启用。全局面板显示期间，原生工作区导航的 activeView/visibleSessionId 不再指向其背后被隐藏的工作区。

7 项列表/导航测试通过（/tmp/amiba-panel-list-tests.log），使用真实 SlotCore 与原 NavigationRow，覆盖排序、动态标签、迟到主面板、卸载、真实选中 owner、订阅清理。最初测试按同步注册通知断言失败；核对官方微任务批量通知契约后改为等待真实通知，不修改生产时序。类型检查通过（/tmp/amiba-panel-list-types.log），完整桌面构建退出 0（/tmp/amiba-panel-list-build.log）。

实际 --compat --main-panels --panel-list 退出 0（/tmp/amiba-panel-list-smoke-2.log）：排序、延迟 main 启用、真实 Enter 激活与鼠标切换、图标尺寸和选中态、卸载返回、原侧栏按钮节点及当前会话保留均通过，原主面板草稿回归与配置/文件/Markdown/HMR 基础回归亦通过。第一次 smoke 的 CDP Enter 未提供字符文本而超时；加入回车 text/unmodifiedText 并断言真实焦点后通过，未增加产品键盘事件补丁。

已查看实际桌面截图 /var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-global-panel-list.png：新增入口位于原工作区行之后，会话分组和原控件仍在，未新增外层布局或替换原导航。统计更新为 39 项已有接入基础、5 项待进一步适配、20 项有条件适配；不是完整插件兼容率。main conversation 保留键、完整官方侧栏组件/域依赖、独立 Web 与五项右侧栏继续处理。

## 进行中：全局 main 面板与当前会话保留（2026-09-13）

已将 MainPanelNavigation 状态源接到 layout.selectPanel、provideRoot({hooks:{panelInfo}}) 与 keyed/root main 渲染入口。选择不存在的 key 会同步拒绝，保留原选择和待处理导航信号；有效选择取消先前异步导航；所选贡献卸载时返回原聊天区域。原生会话/工作区导航清除全局面板，避免强制改写原生目的地。selectPanel(null) 明确通过已有工作区导航请求 chats。

FullScreenChatView 新增可选主面板内容，复用原 PrimaryWorkspaceView 隐藏聊天但保留挂载的机制。无全局面板时布局与样式不变；面板打开时关闭聊天可见事实及文件工作台可见事实，源消息继续保留。根/面板组件使用真实 panelInfo 来源；main owner 不伪造 sessionId。

导航状态与取消相关 8 项测试通过（/tmp/amiba-main-panel-navigation-tests.log）；现有 FullScreenChatView 25 项回归通过（/tmp/amiba-main-panel-ui-tests.log）。shell 类型检查通过（/tmp/amiba-main-panel-types.log）；完整构建退出 0（/tmp/amiba-main-panel-build.log）。实际 --compat --main-panels 退出 0（/tmp/amiba-main-panel-smoke.log）：keyed 分发、panelInfo、非法选择拒绝、卸载返回以及会话/输入框对象/草稿保留均通过；既有设置、会话、目录、文件、Markdown 和 HMR 回归通过。

尚未完成 sidebar.panellist 图标列表、main conversation 保留 key 的完整契约及全局面板的布局/错误恢复专项验证，不能据此提升兼容统计，保持 38/6/20。

## 最新进展：根级公共状态贡献与渲染订阅（2026-09-13）

在当前 rc.2 的真实 SlotRegistry（client-runtime）补齐 slots.provideRoot；通过已纳入 pnpm 和 managed runtime prepare 的可复现补丁接入，保留原 sessions.open 等旧补丁。普通 hooks、按 key 解析的 keyedHooks 和静态 props 统一检查输出名称；失败注册不发布快照、不通知订阅者；成功注册及调用方 fiber 卸载均原子更新，单个订阅者抛错不阻断其他订阅者。rc.2 原生 useSessions/useWorkspaces 保留为受保护名称：这不意味着新版会重新注册同名来源的整套域插件可以直接替换旧域插件。

ui-renderer 从 host.root 获取贡献并合成标准属性；root/session/session-maybe 三类入口订阅贡献名单变化，状态源自身变化由原 selector hook 处理。保留既有 useSessions/useWorkspaces 的函数身份；按 key 切换释放旧来源订阅。没有修改页面布局或样式。类型随实际 runtime 补丁发布，UI 包的开发依赖固定 renderer 版本用于执行真实补丁测试。

4 项实际补丁测试通过（/tmp/amiba-root-provider-tests.log）：真实 Cordis/SlotCore 的冲突回滚、fiber 卸载与重注册、订阅者错误隔离；真实 React DOM 三作用域的名单更新、状态更新、按 key 切换、卸载与重新注册，同时保留输入框对象及草稿。shell 类型检查通过（/tmp/amiba-root-provider-types.log）。首次 DOM 测试暴露测试依赖从根目录解析到另一份 React，已将 renderer 测试依赖放回 UI 包，与现有 React 18 对齐；没有替换产品 React 版本。

完整桌面构建退出 0（/tmp/amiba-root-provider-build.log）。实际 --compat --root-providers 退出 0（/tmp/amiba-root-provider-smoke.log）：真实 SlotCore/renderer 的状态更新、名称冲突拒绝、调用方 fiber 卸载、同名重新注册、订阅释放以及原输入区域和扩展草稿对象保留均通过；既有配置、会话、文件、Markdown、目录与 HMR 回归通过。此项只补基础服务；main/selectPanel/usePanelInfo 的实际布局绑定、左侧全局面板入口与五项右侧栏仍未完成。统计保持 38/6/20，完整兼容目标不变。

## 最新进展：导航取消服务及全局面板依赖核对（2026-09-13）

补齐 ctx.layout.beginNavigation：根拥有 LayoutNavigation，每个新请求取消前一个 AbortSignal；open-chat/open-new-chat/open-workspace/open-settings 经既有布局事件边界提交时取消待处理导航，来自桌面宿主的同名事件也走此边界。开关侧栏/详情或其他无关事件不取消。根卸载取消当前信号，卸载后的旧引用也不能重新创建有效请求。没有改变现有导航动作、资源或样式。

3 项单元测试通过（/tmp/amiba-layout-navigation-tests.log）：请求替换、迟到异步回调不提交、根生命周期结束。shell 类型检查通过（/tmp/amiba-layout-navigation-types.log）；完整桌面构建通过（/tmp/amiba-layout-navigation-build.log）。实际 --compat --layout-navigation 退出 0（/tmp/amiba-layout-navigation-smoke.log）：真实 layout 服务的请求替换、openChat 取消、宿主事件取消、无关事件保留均通过；既有配置、会话、文件、Markdown、目录及 HMR 基础回归通过。

澄清第 53 项：c291e796 的 sidebar.panellist 是左侧全局面板图标列表，owner 为 size/active，列表 id 对应 keyed/root main 的 key；并不是右侧标签列表。此前“右侧栏六项”的概括不准确，当前六项待接入入口包含这一左侧全局面板项和五项右侧栏入口，数量不变。需将 main/selectPanel/usePanelInfo 整体接到可选主区域，避免替换原会话分组。

根级依赖的明确差异：当前 rc.2 ui-renderer 的 standardProps 根缓存只提供 useSessions/useWorkspaces；新版 ui-layout 通过 slots.provideRoot({hooks:{panelInfo}}) 发布全局状态。新版实际实现位于 ui-renderer/src/client/registry.ts 的 provideRoot/rebuildRootBinding，并有原子发布、重复 hook 拒绝及 fiber 卸载要求。后续要迁移真实根贡献与渲染订阅，不可只补 GlobalStandardProps 类型或伪造 owner。此处尚未实现，selectPanel/面板列表仍未完成；统计保持 38/6/20，完整目标及其他服务未完成范围不变。

## 最新进展：真实 Host 分步工具详情与嵌套图片回归（2026-09-13）

新增 --legacy-tool-live（要求 --legacy-tool-details），仅在隔离 smoke profile 中按 marker 驱动真实 Host Session.append：父工具开始、子调用开始、子调用结束、父工具结束分为三个独立阶段。选择父/子调用时均先确认 running；子完成后所选正文自动变为 settled 并收到准确结果，此时父仍在 runningCalls；父完成后再次选择子调用，确认 owner.block 与官方父节点中子对象引用相同。没有在浏览器内伪造 ConversationSnapshot，也没有声称实际执行了这些工具程序。

首次 /tmp/amiba-legacy-live-smoke.log 失败：fixture 缺少 code-dispatch 事件的 rootCallId，运行子调用未进入官方工具定义。固定版本 toolDefinition.match 使用 rootCallId 路由这些更新。补齐真实协议字段后 /tmp/amiba-legacy-live-smoke-2.log 退出 0。相同修正也用于已有 message-image-fixture 的六个嵌套开始/结束事件，保持其原内容与调用关系。

最终组合 --compat --legacy-tool-details --legacy-tool-live --message-images --tool-images --nested-tools 退出 0（/tmp/amiba-legacy-nested-live-smoke.log）。父子详情实时转换、跨会话选择、公共面板开关、页签可见性及卸载恢复原文件通过；多层工具图片的 live/history、准确子 owner/loader、单独引用授权、跨会话拒绝、URL 释放、深层定位及卸载回退同时通过。使用上轮 43d2fed 的完整桌面构建，本轮无产品源码变更，不新增构建通过的说法。

统计保持 38/6/20。完整官方 ui-tool 包及其卡片覆盖、后续版本、多尺寸键盘导航和独立 Web 尚未完成；新版右侧栏六项与全部队列/附件等服务未完成项继续保留。

## 最新进展：详情页签可见性、跨会话验证与公共面板开关（2026-09-13）

修复选中的旧版详情页签留在标签条左边界外的问题：只调整其所属横向标签条的 scrollLeft，并增加该附加页签的选中样式，不滚动聊天正文/页面。回归在修复前失败（/tmp/amiba-legacy-tab-red.log，1 失败/6 通过）；修复后详情及轨迹 10 项通过（/tmp/amiba-legacy-tab-tests.log）。只有插件存在且详情正文处于活动面板时才订阅工具快照，页签、停用及其他面板不额外订阅。

真实跨会话 smoke 的准备暴露了另一处既有缺口：layout.openDetails/closeDetails 仅发送 amiba:dsh-layout-action，工作台没有监听。已在 WorkspacePaneProvider 的当前会话状态中接入这两个事件，仅调用原 persistOpen，保留原资源、模式及其他会话记录；enabled 为 false 时不注册。新增测试先复现原失败（/tmp/amiba-layout-details-red.log），再通过重复打开、关闭后文件保留、跨会话及空首页检查。工作台会话隔离与响应式共 16 项通过（/tmp/amiba-layout-details-tests.log）；本轮相关测试合计 26 项，UI/shell 类型检查通过。

最终完整桌面构建 /tmp/amiba-layout-details-build.log 退出 0，包含公共开关修复；之前 /tmp/amiba-legacy-tab-build.log 仅对应此前的页签修改。实际 --compat --legacy-tool-details 退出 0（/tmp/amiba-legacy-session-smoke.log）：公共关闭/重复打开保留同一文件预览 DOM；页签实际边界在标签条内；Host 创建另一会话后不继承旧调用，返回原会话恢复原 callId 与准确插件 sessionId；卸载恢复原文件内容。目录、配置、下载、会话、Markdown、文件及 HMR 基础回归同时通过。已查看最新 amiba-legacy-tool-details.png，页签完整可见，原聊天与工具卡片保留。

统计保持 38/6/20。完整官方 ui-tool 的 apply 同时注册详情正文、工具树和多种原子卡片，不能仅凭此次 probe 宣称整包兼容；其原卡片覆盖问题、实际运行中调用更新、多尺寸键盘导航和独立 Web 仍需验证。新版右侧栏六项及所有其他服务未完成范围继续保留。

## 最新进展：旧版工具详情可选面板（2026-09-13）

conversation.details.tool 以实际 rc.2 已有 single/session 契约声明并导出其 canonical owner。只在存在插件贡献时提供现有工作台内的可选页签，不覆盖原工具卡片、工具外部打开及轨迹 inspect。面板从当前会话官方 nodes/runningCalls 取真实对象，递归包括子调用；选择由会话 id 与 callId 保存，失去窗口中的调用时不偷偷切换其他调用，不用另一会话快照渲染。选中运行调用完成后，订阅用新官方 settled slice 更新。错误边界仅隔离插件正文，选择控件保留，renderer 替换可恢复。

WorkbenchPanelOwner 新增可选 closePanel(id)。原 openPanel 记录该会话之前的模式，closePanel 只在指定面板仍被选中时恢复，避免卸载插件留下空面板；其他打开/查看操作保持原有路径。中英文选择提示随现有字典提供。

验证：新增面板 6 项加既有轨迹 2 项，共 8 项通过（/tmp/amiba-legacy-details-tests-final.log）；工作台会话隔离/响应式 15 项通过（/tmp/amiba-legacy-workbench-tests.log）。UI、SDK（含 guard）、shell 类型检查与完整桌面构建通过（/tmp/amiba-legacy-details-build.log）。--compat --legacy-tool-details 最终退出 0（/tmp/amiba-legacy-details-smoke-2.log）：真实工具对象引用相同、准确 session、原聊天标题保留、插件卸载后原文件内容恢复。此前一轮错误地在文件异步读取完成前比较 Opening file…，该轮不作通过证据。已查看 amiba-legacy-tool-details.png：原聊天与工具区域保留；标签条保持原水平滚动位置，截图中的新页签部分在左边界之外，后续继续验证主动选择后的可见性与键盘导航。

入口基础统计更新为 38/6/20，不代表完整插件兼容率。完整官方详情插件依赖、实际运行中调用更新/跨会话交互及独立 Web 仍需专项验证；新版右侧栏六项和全部队列/服务未完成范围继续保留。未完成整体目标。

## 最新进展：工具图片扩展报错后的替换恢复（2026-09-13）

发现 ToolImageEvidence 的本地 WorkbenchViewBoundary 仅按 callId 挂载，没有 resetKey：展开后图片 renderer 报错，即使替换 renderer，错误状态也一直保留。新增回归先在修复前失败（/tmp/amiba-gallery-recovery-red.log，1 失败/6 通过），再以 source.render 作为错误恢复条件，仅重试图片子区域。原详情控件保持同一 DOM 节点、未提交输入和展开状态；恢复后卸载图片仍保留原详情。工具图片及多层子工具 13 项测试通过（/tmp/amiba-gallery-recovery-green.log），UI 类型检查通过（/tmp/amiba-gallery-recovery-types.log）。本轮为组件层回归，没有重新声称完整桌面或第三方插件全部验证。

同时复核实际 rc.2 的 ui-conversation contract/slots.d.ts：conversation.details.tool 是 single/session 的整个选中工具详情面板，owner 为真实冻结 ToolCallBlock 与可选 cwd，必须处理 running 和 settled 两种形式。不能直接把它当作按工具名分发的 tool.call.toolview 或卡片附加区。后续仍需真实选择状态及独立面板生命周期适配以保留原卡片；第 10 项继续列为未完成，统计保持 37/7/20，其他全部未完成范围不变。

## 最新进展：模型设置页脚与提供方卡片扩展（2026-09-13）

settings.models.footer 与 settings.models.provider-card 已接到原模型设置页。前者在原新增按钮之后，后者附加于原卡片及配置弹窗，弹窗扩展放在 form 外以避免插件按钮提交原表单。原卡片、模型选择、认证判断及配置动作保留。SDK 补充固定 c291e796 的 list/root、keyed/root 契约及直接类型依赖，entryKey 使用真实 settingsNs。

NativeProviderSettings 保留官方目录对象，configured 由命名空间存在性及 settingsPath 是否有值决定；keyConfigured 单独读取 apiKeyEnv 或规范派生凭据的 configured 元数据，不以 active、模型数量或其他 schema 认证字段替代。首次未配置目录行、路径配置后更新、命名密钥切换及现有认证仍可用均有状态测试。手动新增路由尚未产生目录行的草稿不制造官方 owner；真实目录行的首次配置在原卡片/配置弹窗接入。

验证：21 项模型状态/页面/编辑器测试通过，模型包与 SDK（含 guard）类型检查通过；完整桌面构建产物包含本次生产改动（/tmp/amiba-model-slots-build.log）。实际 --compat --model-settings-slots 最终退出 0（/tmp/amiba-model-slots-smoke-final.log）：真实 Host 配置事实、按命名空间分发、具体配置弹窗中的扩展、卸载后保留表单及原卡片 DOM、取消原弹窗，以及报错后扩展区高度归零均通过。基础目录、设置保存/重置、会话、文件、Markdown 和 HMR 回归同时通过。首次两轮因测试将设置页 dialog 误当尚未关闭的配置弹窗而失败，不作为通过证据；最终以保存的具体弹窗节点及其 form 检查，避免列表扩展冒充弹窗扩展。

统计由 35/9/20 更新为 37/7/20，仍是入口基础数量而非完整兼容率。完整第三方模型插件、独立 Web、右侧栏、队列及其他服务未完成项仍保留。未替换 Amiba 已有能力和样式，也未宣称全部兼容完成。

## 最新进展：lineage 常规配置启用和窗口布局（2026-09-13）

新增 lineage-loader-fixture.mjs，通过隔离 smoke profile 的真实 ctx.loader.create/remove 启用/停用 @deepseek-ai/dsh-client-ui-subagent。正常 Host 客户端图包含该插件并明确不包含替换性的 ui-conversation root；renderer 按正常 boot 加载后官方目录可展开和选择子会话，主 shell 始终只有一个。停用并重载后 lineage 区域消失，原可续聊子会话历史、输入器、续聊及停止保持正常。未用手工 evaluate bundle 代替这一轮的图加载。/tmp/amiba-lineage-loader-smoke.log 退出 0。

窗口验证发现此前真实缺陷：720px 下导航右边界 698px 超过原控件左边界 618px；1600px 下宽屏原 11rem 标题布局把标题压至 0px。仅在非空 lineage 出现时，普通布局复用已测量的右控件 inset 预留空间并保留原标题宽度；导航允许收缩/横向滚动，逐个按钮仍可键盘聚焦。宽屏保持原 11rem 标题布局，将 lineage 绝对定位到原标题区域之后，并用容器宽度限制其边界。无插件或空插件不触发这些布局规则。

修复后 FullScreenChatView 25 项测试及完整桌面构建通过（/tmp/amiba-lineage-layout-ui-tests.log、/tmp/amiba-lineage-layout-build.log）。真实 --compat --child-continuation --child-navigation --header-corner --header-lineage --lineage-loader --lineage-layout 退出 0（/tmp/amiba-lineage-layout-smoke-2.log）。720/960px 下原标题宽度均为 164.49px，导航与原右侧控件保持 30px 间距；1600px 下标题宽度为 140px，导航不侵占右控件。三个尺寸都逐个聚焦真实官方导航按钮并确认可见边界；已查看 amiba-lineage-layout-720.png 和 amiba-lineage-layout-1600.png。浅/深色官方弹层、常规配置移除、只读子会话、续聊/停止、角标、文件/目录、Markdown、turn-tail、HMR 等回归通过。最初失败的 /tmp/amiba-lineage-layout-smoke.log 不作通过证据。

本轮产品变化只涉及 lineage 扩展区及其启用时的空间分配，没有替换原标题、编辑器或右侧控件。统计保持 35/9/20；常规图与已测窗口尺寸不再列为 lineage 的未验证项。固定版本以外的组件与私有样式、独立 Web/Quick Ask，以及全部队列、模型、右侧栏和其他扩展/服务未完成项继续保留，完整目标尚未达成。

## 最新进展：父子会话标题导航接入（2026-09-13）

conversation.session.header.lineage 已接入主 shell，复用实际 rc.2 已有的官方 owner 类型及 branded SessionId，不补造重复接口。sessionLineage 只从真实官方 byId/current 派生：当前标题及 origin=subagent 的祖先按上游顺序分发；普通 fork 不视为子 Agent，缺失祖先和循环止步，不编造名称；Amiba 与官方当前会话尚未一致时不泄露旧会话导航。祖先 openTitle 通过 ctx.sessions.open 和既有选择桥打开真实目标，祖先的 owner 与标准 sessionId 保持各自语义。

导航是原可编辑标题旁的附加区域，原重命名、标题 DOM、编辑器及右侧控件保留。官方组合标题型插件可能在附加导航中重复显示当前标题，这是保留原重命名控件的取舍，不宣称原样替换官方标题布局。可用性订阅官方注册表，未注册或错误退选后不留下空错误节点占据标题间距；本地错误边界在贡献替换后可恢复。

验证：祖先派生 5 项、原 FullScreenChatView 25 项（含导航挂载后重命名与错误恢复）、插槽和选择桥 25 项，共 55 项通过；UI、shell、SDK 含 guard 类型检查通过。最终完整桌面构建 /tmp/amiba-lineage-build-visual.log 退出 0。实际 --compat --child-continuation --child-navigation --header-corner --header-lineage 退出 0（/tmp/amiba-lineage-smoke-visual.log）：真实 Host 创建多层子会话，插件收到准确当前/祖先 owner，点击祖先返回父会话；安装产物中的官方 ui-subagent 组件通过真实 ClientContext 加载后，目录可键盘展开并选择子会话。原续聊、停止、只读子会话、角标、设置、目录、文件、Markdown、turn-tail 与 HMR 回归通过。

首轮功能冒烟 /tmp/amiba-lineage-smoke.log 虽退出 0，截图发现官方 portal 菜单缺少主题别名导致透明，未据此完成视觉验收。新增 official-lineage.css 仅作用于导航区和固定 rc.2 官方菜单根 .ZKlsPq_menu[role=tree]，从 Amiba 现有主题映射颜色、滚动条与阴影，未向页面根传播变量。最终实际断言菜单不透明、有阴影、fixed 定位、浅深色背景变化且全局别名为空，已查看 amiba-header-lineage-official.png 和 amiba-header-lineage-official-dark.png。后续版本类名需重新验证；常规 Host 插件图配置启用、窄窗口和独立 Web 尚未覆盖，仍保留为后续工作。

其余日志：/tmp/amiba-lineage-tests.log、/tmp/amiba-lineage-ui-tests.log、/tmp/amiba-lineage-slot-bridge-tests.log、/tmp/amiba-lineage-ui-types.log、/tmp/amiba-lineage-sdk-types.log、/tmp/amiba-lineage-shell-types-final.log。首次 shell 类型检查发现已存在官方 lineage 定义，已移除重复声明并直接导出官方类型，后续检查通过。

评估纠正：第 42 项 settings.models.provider-card 在固定 c291e796 的 slot-contract.ts/ModelsSection.tsx 与 README 中明确是卡片内部附加区域，而非整卡替换。将其从有条件组移到待适配组；需要真实 provider 目录行、settingsNs、configured 与 keyConfigured，以及保存/首次配置/添加草稿的正确状态。footer 则是空 owner 的 root/list 底部附加区域。没有技术证据支持以现有样式冲突拒绝这两个入口。

统计更新为 35/9/20（已有基础/待验证/有条件），不是完整兼容率。全部 64 项及服务目标仍未完成；跨窗口/重启队列、图片 preview/本人回显、正常插件图及 Web/Quick Ask、右侧栏、模型服务、私有组件和全区域接管条件等全部继续保留。

## 最新进展：嵌套图片释放的真实解码验证（2026-09-13）

复用已验证构建，运行加强后的 --compat --message-images --tool-images --nested-tools，终态退出 0，日志 /tmp/amiba-nested-image-decode-revocation-smoke.log。仅由 code-dispatch 引用的第三张图片在切换前解码成功，切换到未引用会话后新建 Image 读取旧 URL 失败；Host 跨会话明确拒绝；历史重开用新的授权 URL 解码宽度 3。消息、根工具与嵌套工具均已用图片解码验证释放，不再依赖被 CSP 阻止的 fetch。多层实时/历史分发、父内容保留、深层定位和卸载回退继续通过。此轮只有验证和记录，无新产品变更。

下一项 lineage 初步核对：新版 owner 是 lineageSessionId/displayTitle/openTitle，官方 ui-subagent 还依赖 sessions.openSubagent、refreshSubagents、setSubagentCatalogOpen 与标准 useSessions 的 subagentsByParent。实际 rc.2 runtime 已有这些目录刷新/打开状态方法及快照，不能归为“版本完全缺少服务而无法接入”。仍需核对 shell 的真实祖先链、标题和导航语义，保留现有标题/控制区，再做端到端验证；当前未声明或接入 lineage，不调整 34/9/21 统计。

## 最新进展：官方轨迹图片渲染接入（2026-09-13）

固定 rc.2 trajectory 补丁已登记到 patchedDependencies、catalog、SDK peer/dev 和 pnpm lock，完整桌面构建成功应用到 managed runtime。补丁由 trajectory 的 conversation.view 入口声明 conversation.trajectory.images 子槽，按官方注册表订阅可用图片插件。shell 提供同一会话授权 loader；原 stateful TrajectoryView 保留为稳定子组件，通过上下文将图片回调送到预览、详情及工具输出。无 occupant 或无 loader 时保留原 rc.2 展示。连续持久图片成组，inline 图片顺序与原 DOM/classes 保留；compact 按原 preview 语义传入。

7 项真实补丁测试通过，包括引用投影、无插件回退、混排分组及预览/详情参数。SDK 类型与 guard、shell 类型及完整桌面构建通过。真实 --compat --message-images --tool-images --trajectory-loader --cordis-business --trajectory-images 最终退出 0：正常 Host 配置激活已安装官方轨迹，两张不同真实 Host 图片均解码，共用当前 shell 的 session loader；插件卸载不改变选中记录、表头、编辑器连接与草稿；空图片插件不影响工具文本和编辑器；抛错插件由官方 renderer 取消选用，恢复原图片元数据，卸载后原轨迹继续可用。官方轨迹整体停用后保留默认 Chat。已查看 amiba-trajectory-images.png。动态 Cordis RPC/错误隔离、消息/工具图片、配置、目录、文件、Markdown、turn-tail、HMR 等回归通过。

验证脚本同时修正旧 Blob URL 失效的断言：先前 fetch 可能直接被 CSP 的 connect-src 拒绝，不能单独证明 revoke。现在对旧 URL 新建 Image 并等待解码失败，同时验证切换前有效、历史重开新 URL 有效；最终桌面实测通过。本次包含消息及根工具图片，嵌套专用 URL 的相同断言已更新，但未在本次 flags 中重跑，不以旧 fetch 结果宣称该项真实释放已证实。

测试脚本前两处前提已修正：此前图片测试已展开工具区，Cordis 测试不能再一直等待折叠按钮；官方 renderer 错误写入日志并取消选用，不在界面显示错误字符串。未为测试改变产品行为。日志：/tmp/amiba-trajectory-image-render-tests-3.log、/tmp/amiba-trajectory-sdk-types.log、/tmp/amiba-trajectory-shell-types.log、/tmp/amiba-trajectory-image-build.log、/tmp/amiba-trajectory-image-smoke-5.log。smoke-2 为成功基础轮，smoke-3 因错误文案断言失败，smoke-4 因脚本编辑未成功而主动中止，不作为通过证据。

入口统计更新为 34/9/21（已有基础/待验证/有条件），并非完整插件兼容率。完整新版图片插件依赖、真实预览交互、本人发送回显、独立 Web/Quick Ask、跨窗口/重启队列、右栏/模型/lineage 服务及其余条目均继续保留。全部 64 个入口和服务目标未完成。

## 最新进展：轨迹持久图片记录补丁基础（2026-09-13）

新增固定 rc.2 的 trajectory 依赖补丁草稿（patches/@deepseek-ai__dsh-client-ui-trajectory@0.1.1-rc.2.patch），尚未登记到 patchedDependencies 或应用到生产运行时。补丁在 sourceBlock 和 assistantSourceBlock 中保留通过校验的原 attachment 对象，使用新版 TrajectorySourceBlock 的 attachment 字段；类型通过已有 ui-conversation peer 的 canonical 图片 owner 派生，不增加另一套图片身份。原 content 字符串、imageSrc/imageAlt、工具调用 ID/名称和旧图片路径全部保留，此阶段不修改 UI 渲染。

新增 trajectory-images.test.mjs：复制实际已安装 rc.2 包的相关文件到临时目录，先用系统 patch 校验并应用真实补丁（若已应用则验证可反向匹配），再执行补丁后的实际投影函数。4 项测试通过，覆盖普通与助手图片、原引用身份、重复出现及顺序、原文本/inline 字段、无效/暂存元数据拒绝、旧 URL 协议限制和助手工具导航字段。日志 /tmp/amiba-trajectory-image-record-tests.log。测试不改 managed runtime，不用复制出的另一套投影实现代替待测代码。

后续仍需补 conversation.trajectory.images 声明与实际渲染、复用会话授权 loader、无插件时的原轨迹回退、inline/持久图片混排、预览与详情的 compact 语义，然后登记补丁及 lock、验证 runtime prepare 的应用和完整桌面构建/真实轨迹界面。当前 pnpm 工作区尚未直接引入 trajectory，补丁登记时要处理依赖图与锁的一致性，不能仅改 resources 的临时文件。轨迹入口仍未算作已接入；全部目标和 33/10/21 统计不变。

## 最新进展：仅由嵌套事件引用的图片（2026-09-13）

夹具新增第三张有效 PNG（3×1），在 Host 保存后只写入 tool/code-dispatch 的 content；用户消息和普通 tool/result 分别使用另外两张不同字节的图片。断言三者具有不同的 attachmentId，避免把已被其他记录引用的图片误当作嵌套授权验证。

真实 --compat --message-images --tool-images --nested-tools 终态退出 0（/tmp/amiba-nested-only-image-smoke.log）：实时子图片插槽收到第三张准确引用并实际解码宽度 3；未引用会话调用 readAttachment 明确返回 Image is not referenced by this session；会话切换后该图片的旧 URL 失效，历史重开再次解码且 URL 更新。原共享图片与普通工具单独引用图片仍分别通过，深层分发/reveal/卸载、设置、目录、下载、文件、Markdown、turn-tail 与 HMR 回归通过。此次只修改 Host 夹具和断言，复用已验证构建，未更改产品或样式。

下一适配入口 conversation.trajectory.images 已核对实际版本：rc.2 的 TrajectoryViewInjected 没有 loadImage/renderImages，内部 TrajectoryTable 的 MessageImages/PanelImage 直接使用 sourceBlocks.imageSrc。固定新版则由 trajectory 的 conversation.view 子声明该 single/session 插槽，TrajectoryView 将 session loader 传入 renderImages，owner 采用 MessageImagesOwnerProps。因此不能仅在 Amiba root 增加同名声明就宣称接入；需要将图片引用保留、读取器与渲染回调实际接到轨迹组件，同时保留原轨迹筛选、导航和原 inline 图像回退。

仓库已有固定 rc.2 的 pnpm patchedDependencies 及 runtime prepare 的补丁摘要校验机制，可用于可复现的依赖适配；不应直接修改 resources 下的临时安装产物。轨迹入口仍未完成，尚未改动其依赖。所有原目标继续保留，统计仍为 33/10/21。

## 最新进展：原工具详情内的嵌套视图分发（2026-09-13）

原生 SemanticToolRow 与通用 ToolChipRow 在既有详情折叠区保留正文、代码、参数和图片，再呈现 block.subCalls 的逐调用树。所有层级继续通过同一个 tool.call.toolview 分发；子 owner 使用自己的 callId/name/block，继承真实 cwd/openFile/loadImage，不继承指向父调用的 inspect。shell 按子 ID 重新绑定可用的轨迹 inspect，并为每个子调用建立独立图片上下文。未知子工具直接读取 canonical block 的文本或结构，不构造假的 ToolProgress 起始时间、turn 或 step。

树的外层负责递归；原生子行在这棵树内不再次递归，避免中间节点重复展示后代。插件子行拥有其原子视图；其更深后代仍由树分发，不因该插件未处理 subCalls 而丢失。父详情关闭或摘要模式不挂载整棵子树；无子调用或无宿主分发器时原 DOM 不变。单个子视图的错误由局部边界回退到原数据，其他后代和父证据继续存在，分发器改变后可恢复。工作台边界仅增加可选 resetKey，既有调用行为不变。

导航补齐两层展开：过程摘要按真实调用树识别后代，父工具原详情按后代请求展开；对应子行再滚入视野。中间行自己的详情保持独立折叠，不因外层负责递归而重复展开。子行 keyed 身份在运行中→完成更新时保持，组件局部交互状态不丢失。

验证：嵌套行 6 项、原消息 UI 55 项、工具图片 6 项、原工具插槽 7 项，共 74 项相关测试覆盖通过；UI 与 shell 类型检查、完整桌面构建通过。实际 --compat --message-images --tool-images --nested-tools --header-corner --child-continuation --approval-detail 退出 0。夹具经真实 Host 写入 run_code 及多层 code-dispatch 事件；实时与历史重开两次验证准确子 owner、单次分发、父代码/正文保留、插件交互、独立子图片解码、深层 reveal 展开以及卸载原生回退。图片授权/释放、审批、角标、子会话续聊/停止、设置、下载、目录、文件、Markdown 和 HMR 回归通过。已查看 /var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-nested-tools.png。

日志：/tmp/amiba-nested-tool-tests.log（初版嵌套 5 项及图片/工具插槽）、/tmp/amiba-nested-tool-tests-2.log（最终嵌套 6 项及消息 55 项）、/tmp/amiba-nested-tool-ui-types-final.log、/tmp/amiba-nested-tool-shell-types.log、/tmp/amiba-nested-tool-build.log、/tmp/amiba-nested-tool-smoke.log。

范围仍未完成：任意第三方整棵树接管组件的专项适配、外部打开型工具、preview、轨迹图片、独立 Web/Quick Ask、跨窗口/重启队列与其余服务条目继续保留。此次嵌套图片引用的是已由普通工具单独引用的真实图片；只出现在 code-dispatch 的图片授权需再独立验证（实际 rc.2 imageInEvent 源码会遍历 data.content，但源码不是运行验证）。入口统计保持 33/10/21，全部目标未完成。

## 最新进展：工具单独引用的图片授权（2026-09-13）

补齐上一轮共享图片夹具无法证明的授权场景：Host 另存不同字节、2×1 的有效 PNG，确认其 attachmentId 与用户消息的 1×1 PNG 不同。第二张图片只写入真实 tool/result，不写入用户消息；同一工具结果同时保留第一张共享图片，继续覆盖出现顺序与共享缓存。

真实 --compat --message-images --tool-images 已终态退出 0（/tmp/amiba-tool-only-image-smoke.log）。工具图片插件获得两个准确引用，展开后实际解码宽度分别为 1 和 2；用户消息图片集合不含工具单独引用 ID。拥有者会话可以读取第二张图，未引用会话对它明确返回 Image is not referenced by this session；切换会话后旧 URL 失效，历史重开后两张图片均重新解码，第二张图使用新的 URL。共享图仍与消息图复用相同缓存。插件卸载卡片 DOM 恢复、目录、设置、ZIP、视图切换、turn-tail、Markdown、文件操作及 HMR 回归通过。此次仅修改真实 Host 夹具与冒烟断言，无产品或样式修改，复用已通过构建的生产文件。

嵌套工具下一步依据：原生 run_code 的 SemanticToolRow evidence 当前只展示代码和文本，虽然 ToolCallOwnerProps.block.subCalls 已完整保留，但还没有在其详情内逐个分发子工具视图。固定新版官方 ToolCallTree 会递归以子调用自己的 callId/name/block/openFile/loadImage 分发同一 tool.call.toolview。需要将这条逐调用展示路径适配到原详情折叠区，保留父卡片证据，并为每个子调用建立自己的图片上下文；不能把子图片合并进父结果代替该行为。此缺口仍未标记完成，全部 64 项及服务目标不变，统计保持 33/10/21。

## 最新进展：工具图片的桌面展示入口（2026-09-13）

主 shell 声明 tool.call.images 的新版 single/session 契约，提供 images/loadImage/align，并向工具 owner 附加当前会话读取器。复用消息图片的按会话授权、pending/URL 缓存与释放流程，不另造图片身份。rc.2 的 ToolCallOwnerProps 仍兼容旧宿主，loadImage 在类型中为可选；主 shell 会话读取器准备好后实际提供。preview 类型与新版契约对齐，但当前结果提取只产出持久引用，不能据此声称 preview 已验证。

原生 SemanticToolRow 和通用 ToolChipRow 在既有 detail 中附加图片，保留原正文、参数、错误、摘要与折叠样式。每个工具请求都有按 callId 匹配的图片上下文，避免父工具图片流入嵌套子行。根据官方注册表和订阅判断是否有图片插件，不把空 renderSlot 元素误当作已启用的图片功能；没有注册、没有当前 loader 或没有图片时，原卡片不增加按钮。实际图片组件仅在原详情展开后挂载，局部错误边界保护原工具证据。

验证：图片折叠与通用回退 6 项、工具图片提取 3 项、原工具插槽 7 项，共 16 项组件测试通过；UI、shell、SDK 含 guard 类型检查及完整桌面构建通过。真实 --compat --message-images --tool-images --header-corner --child-continuation --approval-detail 最终退出 0：Host 保存规范化 PNG 并写入真实 read_image 调用/结果；插槽收到正确会话、引用及 align；折叠时不挂载图片，展开后实际解码；与消息图片共用同一授权 URL，历史重新打开后共用新的 URL；卸载后原工具卡片 isEqualNode 基线通过。消息跨会话拒绝、URL 释放、角标、审批、续聊、停止、设置、目录、文件、下载、turn-tail 和 HMR 回归通过。已查看实际截图 /var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-tool-image.png。

夹具修复：首次工具结果被 Host 拒绝，原因是遗漏 surface-eligible tool/result 必需的 surfaceOp 标记，已补齐 step 与 append 标记；图片正常显示后，HTML 字符串比较仅因属性顺序变化失败，改为保留全部节点/属性/子内容语义的 DOM isEqualNode 比较，未修改产品行为或放宽属性值要求。日志：/tmp/amiba-tool-image-seat-tests.log、/tmp/amiba-tool-image-seat-tests-2.log、/tmp/amiba-tool-image-seat-ui-types-final.log、/tmp/amiba-tool-image-seat-shell-types.log、/tmp/amiba-tool-image-seat-sdk-types.log、/tmp/amiba-tool-image-seat-build.log、/tmp/amiba-tool-image-seat-smoke-5.log。

统计更新为 33/10/21（已有基础/待验证/有条件），不是完整兼容率。工具图片仍需补嵌套专用视图、保留外部打开行为的工具图片入口、preview、新版完整插件依赖和独立 Web/Quick Ask 验证；注册但返回空内容的插件与插件内部错误后的空详情也需继续核对。当前真实 Host 图片同时被用户消息引用，工具单独引用的授权需另测。全部 64 项及服务适配目标保持不变。

## 最新进展：工具图片的共享提取基础（2026-09-13）

工具原始结果已由实时桥和历史投影完整保留。现将用户消息的持久图片校验提取为 durableContentImages，并为工具展示提供 toolCallResultImages：只提取当前结果直属的 image 块，保留原引用对象、顺序和重复出现次数，不借用 subCalls 的图片，不把内联字节、preview 或暂存 ID 伪装成持久引用。用户文字和附件提取逻辑保持不变。

验证：图片消息与工具 wire 测试 29 项、工具展示及图片读取测试 10 项通过；Runtime 和 UI 类型检查通过。实时与历史两条路径都覆盖图片、混合文本、重复引用和嵌套结果隔离。日志：/tmp/amiba-tool-images-runtime-tests.log、/tmp/amiba-tool-images-ui-tests.log、/tmp/amiba-tool-images-runtime-types.log、/tmp/amiba-tool-images-ui-types.log。此步骤未变更渲染入口，未运行完整桌面构建或新的真实 Host 冒烟。

tool.call.images 仍待完成，统计保持 32/11/21。下一步需在原工具详情折叠区接入授权 loader 和插槽，同时保持无插件时的卡片 DOM 与展开按钮：renderSlot 即使没有 occupant 也返回 React 元素，不能仅以 ReactNode 非空判断是否增加 detail。官方 read_image 原生 quietSuccess 卡片尤其要验证此边界。全部 64 项及服务兼容目标继续保留。

## 最新进展：消息图片授权读取与渲染（2026-09-13）

主 shell 接入 conversation.message.images：从当前真实 SessionFace 读取持久图片，经 FullScreenChatView/ChatSurface/MessageTurns/UserStickyBubble 传入原用户消息。原文字、附件徽标和控件保持不变；插件为空时不增 DOM，渲染异常由局部边界隔离。暂未扩展到本人发送过程中的本地 preview 回显、工具图片或轨迹图片。

session-image-loader 为每个会话 face 独立缓存 pending 及 URL，只有 SessionFace.readAttachment 授权成功后才创建 Blob URL，并提供同步 peek。不同会话不共享缓存；拒绝与连接失败不缓存为成功，后续可重试。会话切换和 shell 卸载释放已创建 URL，迟到响应不创建 URL。effect 拥有实例并按 face 检查可见身份，避免 React StrictMode 重放复用已释放实例。

验证：消息 UI 55 项、读取器与 StrictMode/切换测试 6 项通过；UI/shell 类型检查和完整桌面构建通过。真实 --compat --message-images --header-corner --child-continuation --approval-detail 通过：Host attachments.saveImage 实际验证并保存 PNG，拥有者会话真实日志引用后，插件读取解码出图片；并发调用共享 Promise，peek 在授权完成后可读；另一真实会话明确返回 Image is not referenced by this session；切换后旧 Blob URL 不可读取，返回历史消息产生新 URL 并正常解码。插件卸载保留原文和原对话。角标、审批、续聊、停止、表单、目录、文件、下载和 HMR 回归通过，已查看截图。测试中首次 PNG 被严格解码拒绝，修复了测试数据，未修改产品校验。

日志：/tmp/amiba-image-loader-tests-2.log、/tmp/amiba-image-seat-tests-2.log、/tmp/amiba-image-loader-types-0.log、/tmp/amiba-image-loader-shell-types-2.log、/tmp/amiba-message-image-build.log、/tmp/amiba-message-image-smoke-2.log。

入口统计现为 32/11/21（已有基础/待验证/有条件），不代表完整插件兼容率。本人发送的回显和持久引用交接、新版 preview 分支及 compact 行为、工具/轨迹图片、独立 Web 与 Quick Ask 等非主 shell 界面仍需继续；原全部扩展和队列/服务目标不变。

## 持久图片引用的数据链路（2026-09-13）

重新核对实际安装包：rc.2 已有 ImageAttachmentRef、conversation.message.images 的历史图片 owner，以及 SessionFace.readAttachment / session.attachment 的按会话授权读取接口，不能把这些基础能力都误归为“必须新版”。新版增加 preview 分支、可选同步 peek、compact 等契约，仍要分别适配。

消息转换此前只保留文字及 file-attachment 元数据，原生 image 块被丢弃。SDK 现从已安装官方 MessageImagesOwnerProps 派生 canonical ImageAttachmentRef 类型；产品消息携带只读持久引用数组。userMessageText 保留有效图片的出现顺序和完整引用元数据；历史加载、实时插件 relay 事件、ChatSurface 和 Host 消息合并共用同一数据链路。无效引用被忽略，不从暂存 ID、普通文字或旧内联字节编造持久引用。图片重复出现不被去重；消息身份去重仍沿用原 uiId。未改原文字、附件徽标、输入回显或任何展示和样式。

验证：最终图片投影 13 项，事件桥 4 项，历史投影 15 项，界面 Host 消息合并 10 项，共 42 项覆盖；Runtime、UI、SDK（含 guard）、shell 类型检查通过。日志：/tmp/amiba-message-images-final-tests.log、/tmp/amiba-message-images-tests-2.log（其中图片为前一版 12 项，最终 13 项单独重跑）、/tmp/amiba-message-images-ui-tests.log、/tmp/amiba-message-images-types-2.log、/tmp/amiba-message-images-types-recheck-{0,1,2}.log。

这是图片适配的必要数据基础，尚未完成渲染接入：三个图片插槽、授权读取/缓存/释放、本人发送回显与持久引用交接、工具/轨迹图片和独立 Web 仍需继续。此阶段未作完整构建或真实 Host 图片界面验证，不沿用前一里程碑证明图片支持；入口统计仍为 31/12/21。

## 会话头部角标（2026-09-13）

接入 c291e796 的 conversation.session.header.corner single/session 契约；owner 无业务字段，复用真实标准会话属性。角标放在现有右上角控件之后，保留标题、原控件顺序和样式。空渲染使用 empty:hidden，异常边界保留原界面。既有边缘控件 ResizeObserver 继续根据实际宽度预留空间。

验证：完整 FullScreenChatView 的 23 项测试通过，含新角标的空内容、位置、卸载、标题保留和异常隔离。旧浏览器按钮测试在 HEAD 基线也失败，原因是测试未加载已迁移到插件的浏览器；现使用真实 createBrowserView 和插件文案测试配置，原浏览器开关、工作区宽度及 webview 安全属性断言全部保留并通过。UI、SDK（含 guard）、shell 类型检查和完整桌面构建通过。

实际 --compat --header-corner --child-continuation --approval-detail 回归通过：真实插件注册、sessionId/inject 身份、点击、切换到另一真实会话、clear 隐藏、原草稿恢复、空内容/错误/卸载后宽度等于基线。原控件节点及标题 DOM 保留；已查看真实截图。审批、续聊、停止、表单、下载、目录、文件、Markdown、插件卸载和 HMR 仍通过。

日志：/tmp/amiba-header-corner-tests-4.log、/tmp/amiba-header-corner-baseline-test.log（旧测试失败证据）、/tmp/amiba-header-corner-types-{0,1,2}.log、/tmp/amiba-header-corner-ui-types-2.log、/tmp/amiba-header-corner-build.log、/tmp/amiba-header-corner-smoke.log。

入口统计为 31 项已有基础、12 项待验证、21 项有条件，仍不是完整插件兼容率。新版右侧栏服务、lineage 的实际祖先导航与标题语义、独立 Web，以及既有队列/服务缺口继续保留。lineage 官方 owner 为 lineageSessionId/displayTitle/openTitle，子会话占位会替换 breadcrumb 标题，不能只塞一个无真实导航的数据对象就宣布支持。

## 审批详情扩展（2026-09-13）

接入固定新版 c291e796 的 conversation.approval.detail single/session 契约。SDK owner 复用已安装工具调用 ID 类型；主 shell 的真实会话作用域将审批事件 callId 送入可选详情，FullScreenChatView 和 ChatSurface 透传到现有 ApprovalBanner。没有调用关联或没有插件时不增加 DOM；独立错误边界保护原审批按钮，并在审批身份变化后恢复详情。未修改四种决定、请求回传、代码、倒计时、布局类名或样式。

验证：审批组件 4 项（含原视觉优先级、身份更新、无关联和报错恢复），事件桥 4 项通过；UI、SDK（含契约 guard）、shell 类型检查通过；完整桌面构建及生产依赖检查通过。真实 Host --compat --child-continuation --approval-detail 用例通过：真实子会话中记录工具调用并调用官方 approval.request，详情/无插件/报错三种情况下四个原按钮存在，允许与拒绝实际返回 Host，连续审批之后仍可续聊及停止。已有目录、表单、下载、turn-tail、Markdown、插件卸载和 HMR 回归通过；已查看审批截图。测试模型使用本地确定性适配器，Host、审批服务、日志和事件传输均为实际实现。

日志：/tmp/amiba-approval-detail-test.log、/tmp/amiba-approval-detail-bridge-test.log、/tmp/amiba-approval-detail-sdk-types.log、/tmp/amiba-approval-detail-types-{0,1}.log、/tmp/amiba-approval-detail-build.log、/tmp/amiba-approval-detail-smoke-6.log。测试开发中修复重复审批和工具结果缺少消息 ID；此前失败运行不作为通过证据。

入口统计更新为 30 项已有基础、13 项待验证、21 项有条件；这不是完整插件兼容率。独立 Web、第三方私有依赖，以及下面记录的全部队列/服务缺口继续保留。

## 真实 Host 重定向与目标目录恢复（2026-09-13）

后台发送准备锁现同时暴露原会话和准备后的目标，标准输入可据此进入原队列。重定向目标正在结束旧回合时等待其真实空闲；停止、切回前台、组件关闭会取消等待并释放订阅。既有工作器按实际目标完成事件推进原队列。

真实 Host 用例发现，插件创建的目标可能有独立 cwd，但未有本地目录绑定。新增共用 ensureSessionWorkspace，在没有绑定时恢复 Host 目录；主进程 bindIfUnbound 与用户 bind/unbind 顺序执行，已有选择不被恢复操作覆盖。文件、检查点与发送因此使用同一个根目录。主窗口和 Quick Ask 共用 resolveSessionCreationWorkspace：已有会话在真实目录相同的情况下保留 Host 的原 cwd 写法，避免 workspace 注册规范化 /var 与 /private/var 等路径别名后造成身份冲突；真正不同的显式目录继续交由原 Host 校验。新任务仍沿用原 workspace 注册及默认目录规则。

验证：发送器、输入事务及队列工作器 41 项测试；目录解析和真实目录管理器 13 项测试，共 54 项通过。完整桌面构建及完整真实 Host 兼容回归通过。新增 --redirect-queue 通过真实 ConversationLifecycle 归属 handler，将原队列两条消息各派发一次到另一个同来源目标，源模型不接收这两条，前台草稿不变；目标 cwd 恢复且后续自动绑定请求不覆盖它。原后台出队、Stop/Edit/Delete/Send now、图片及历史文件、目录插件、子会话、冷重启和 HMR 用例全部通过。临时测试窗口关闭动画帧后台节流以稳定流式显示断言，产品窗口策略未改。

日志：/tmp/amiba-redirect-ready-tests.log、/tmp/amiba-shared-cwd-tests.log、/tmp/amiba-shared-cwd-build.log、/tmp/amiba-shared-cwd-smoke.log；类型检查记录使用 /tmp/amiba-shared-cwd-*-types.log（主进程最近检查为 /tmp/amiba-host-cwd-alias-node-types.log）。

范围仍有限：此重定向用例覆盖源和目标均在后台、目标没有独立待发队列的情况。切到新目标后的原生队列展示和交接、新旧目标均有队列时的顺序、标准离屏直接发送的重定向关联、跨窗口/重启协调及完整 Host inbox 仍需继续适配；全部 64 个扩展入口及服务目标保持不变。

## 重定向发送的完成归属（2026-09-13）

ConversationLifecycle 的实际插件 handler 可将提交转到同来源的新会话段。发送派发回调现传出准备后的目标 ID（f72cb95）；后台工作器按该 ID 关联原队列，仅目标完成可以推进它，旧源会话的完成事件不重复派发。目标停止或被原生 Send now 打断时保留并暂停原队列；回执延迟及完成先于回执时也遵守 Stop。

验证：发送器 6 项、队列工作器 20 项测试以及 UI 类型检查通过；新用例使用互相独立的新旧队列，覆盖目标完成、旧源完成、停止、抢占及回执顺序。日志：/tmp/amiba-redirect-queue-tests3.log、/tmp/amiba-redirect-queue-types2.log。该重定向变化尚未完成真实 Host 桌面验证，不能沿用上一里程碑的桌面通过结论。

待补齐：切换到新目标后的原生队列展示和发送交接，新旧目标已有队列时的顺序协调，以及标准离屏直接发送的重定向关联。跨窗口、跨重启和完整官方服务范围继续保留。

## 后台自动出队及前后台交接（2026-09-13）

实际成功结束事件可推动同一 sessionPendingQueue 的后台 FIFO。工作器等待目标真正空闲，检查暂停和队首身份；已解析记录不重复运行 codec，暂存草稿使用目标会话真实引用服务解析。读取持久化记录、解除暂停本身不会触发发送。没有增加隐藏编辑器或更换原界面。

派发边界移除队首并保留附件发送租约；拒绝、结果未确认及命令错误恢复原记录、暂停队列并通过已有输入提示显示原因，不自动重试。准备中删除、编辑、切回前台或停止会取消旧准备；取消后按当前草稿和剩余队列重新核对附件所有权。后台发送切回前台后使用原生队列操作；Send now 仅抑制真正存在的旧原生 finally，旧后台回执不重复推动新队列。实时快照按 Host 回合编号或消息 ID 复用历史助手行，避免重复用户/回复组。

另修复同一数据源自身写入期间启动刷新、旧读取在写入结束后覆盖新入队记录的竞态。沿用原存储键和数组格式。

验证：队列、原生发送、工作器与消息身份共 63 项测试，输入提供者及图片 21 项测试通过；UI 类型检查、完整桌面构建及完整真实 Host 兼容回归通过。新增桌面用例验证后台两条 FIFO 各发送一次且引用只解析一次、前台编辑器和草稿不变、切回不重复气泡、Send now 后剩余三条各发送一次、Stop 经导航及无关完成事件仍保留、显式提交恢复队列、子会话图片拒绝保留原记录和完整字节并支持原 Delete 清理。原刷新、图片、命令、子会话、冷重启和热更新用例均通过。

日志：/tmp/amiba-queue-handoff-fixes-tests2.log、/tmp/amiba-background-queue-bridge-tests.log、/tmp/amiba-queue-handoff-fixes-types3.log、/tmp/amiba-background-queue-build3.log、/tmp/amiba-background-queue-smoke2.log。

仍未完成：跨窗口原子认领、跨重启派发日志及恢复、完整 Host inbox 对齐、准备操作重定向到其他会话后的队列归属，以及其他官方扩展契约。下文是历史阶段记录，当前后台出队能力以本节为准；本里程碑不代表全部 64 个入口及服务已完全兼容。

## 按会话保留队列暂停状态（2026-09-13）

暂停标记从当前面板移到已有 sessionPendingQueue 数据源，仍保留原队列数组与存储格式。Stop 在调用引擎 abort 前同步发布暂停状态及原 queuePausedRef；Edit、解析失败和显式恢复发送也使用同一状态。会话切换不再把旧暂停清空，面板重新挂载读取目标会话的暂停值；旧会话回调不会修改新会话的标记。New chat 中断旧会话时将旧队列停住，再清空面板投影。

标准离屏 submit 对忙碌目标成功入队后恢复该会话队列；空闲目标只有进入实际派发回调才恢复暂停，准备拒绝保留 Stop。命令流程仍不隐式恢复模型队列，其他会话的暂停不受影响。无界面结构或样式改动。

验证：队列及原生行为 36 项、标准输入提供者 11 项，共 47 项测试通过；UI 与外壳插件类型检查、完整构建和完整桌面兼容回归通过。状态测试覆盖 abort 同步回调前已暂停、会话切换和重新挂载、旧回调隔离、准备失败保留及显式恢复；桌面增加 Stop 后离开并返回子会话，保留两条队列且未发送，再用原 Delete/Edit/Send now 完成操作。其余图片、刷新、自动出队、子会话及冷重启回归通过。

日志：/tmp/amiba-session-pause-tests.log、/tmp/amiba-session-pause-bridge-tests.log、/tmp/amiba-session-pause-ui-types.log、/tmp/amiba-session-pause-plugin-types.log、/tmp/amiba-session-pause-build.log、/tmp/amiba-session-pause-smoke.log。

明确边界：暂停标记目前是同一渲染器内的会话运行状态，不是跨窗口或跨重启持久化协议。后台出队工作器、发送中记录的原子认领与恢复、Host inbox 对齐尚未接入。未来工作器不能把加载旧记录或 paused=false 当成授权自动出队；须使用实际成功结束事件、暂停门禁和发送接收回执，避免旧快照、Stop 或发送后未知结果触发重发。

进一步核对实际安装的 rc.2：dsh-host-apiproxy/lib/types/api-proxy.js 的 updateQueue（约 2188 行）只允许 text 编辑，且约 2198 行拒绝已有子会话 Agent；cancel（约 2252 行）使用 keepInbox:true。dsh-agent-loop/lib/index.js 的 cancel/kick（约 405/478 行）以及 dsh-subagent/lib/types/continuation.js 的 interrupt（约 263 行）表明队列保留和再次唤醒必须结合真实运行状态，不能只按客户端类型注释推断。完整对齐需要保留原生图片编辑及子会话操作，不可直接将原队列替换为 Host 列表。

## 标准离屏排队（2026-09-13）

标准 inputActions.submit 对忙碌目标复用同一原生 pendingQueue 数据源。先完成真实引用解析和图片准备，再保存原结构化草稿、已解析模型文本及附件；等待初始队列读取，不覆盖既有记录。重复提交由同一驻留输入事务阻止，队列初始读取失败保留输入。队列观察者抛错不会阻断其他订阅者和持久化。

入队后图片文件所有权交给原队列，消费浏览器草稿注册不会删除队列所需文件。沿用原生内存接纳和异步持久化语义；此处返回 queueId，不伪装成 Host 的 accepted 回执。没有修改原界面、队列形状和存储键。

验证：驻留事务 9 项、共享队列 6 项、原队列行为 27 项、桥接与图片 18 项，共 60 项测试通过；UI 与外壳插件类型检查通过；完整桌面构建和完整兼容回归通过。新增 --resident-queue 在真实忙碌子会话上验证标准离屏提交两次只入队一次、原引用节点和普通 token 文字保留、PNG 文件字节在草稿消费后仍存在、前台编辑器及草稿不变。切回后原 Stop 保留两项队列，删除图片行才清理文件；原 Edit 恢复引用，Send now 把准确文本交给真实模型。原队列刷新、自动出队、附件保留、子会话及冷重启回归均通过。

日志：/tmp/amiba-resident-queue-tests.log、/tmp/amiba-resident-queue-native-tests.log、/tmp/amiba-resident-queue-bridge-tests.log、/tmp/amiba-resident-queue-ui-types.log、/tmp/amiba-resident-queue-plugin-types.log、/tmp/amiba-resident-queue-build.log、/tmp/amiba-resident-queue-smoke.log。

仍未完成：后台自动出队及其停止/暂停协调、完整 Host inbox 对齐、跨窗口原子操作。下文为各阶段历史记录；当前能力以本节和逐项评估表为准。

## Required invariants

### Addressed asynchronous message updates

`SessionsStore.updateActiveMessagesFor` checks the actual selected session before evaluating an updater. Callbacks for another session or Home do not run; accepted updates use the current message array and preserve the original persistence behavior. Native asynchronous attachment badges now use this addressed update, skip absent user messages, and update the matching in-flight user cache so recovery of a missing local user bubble can include the completed badges. This prevents delayed badge preparation from touching another session's messages or recalculating the sending session's metadata using another conversation.

Validation: 25 session-store tests passed, including two new target-isolation/return-to-target cases; runtime and UI type checks, full desktop build and the complete compatibility smoke passed. The smoke verifies existing flows, not an artificially delayed thumbnail race. Evidence: `/tmp/amiba-addressed-messages-tests.log`, `/tmp/amiba-addressed-messages-runtime-types.log`, `/tmp/amiba-addressed-messages-ui-types.log`, `/tmp/amiba-addressed-messages-build.log`, `/tmp/amiba-addressed-messages-smoke.log`. Full offscreen submission remains pending.

- Preserve all existing Amiba capabilities, behavior, styling and default layout.
- An unoccupied additive extension contributes no DOM, spacing or placeholder.
- Use the official slot/service contracts, including actual owner data and disposal.
- Keep one authority for submission, session mutation and attachment ownership.
- Never claim compatibility using empty owner objects or no-op callbacks.
- Scope compatibility by DSH version; latest-only contracts need explicit bridges,
  not installation of another conflicting client runtime.

The user has specified the design: retain the existing Amiba workspace, settings,
conversation, tool and resource surfaces. Reuse its background/foreground, muted,
border, primary and semantic status tokens. No palette, font or density redesign;
no unconditional new navigation, duplicate controls or competing layout owners.

## Implementation and acceptance ledger

Each row remains open until its real registration, rendering/interaction and
unload behavior are tested. Existing capability tests and a default UI comparison
are required in addition to new-plugin tests.

| Scope | Status | Acceptance |
| --- | --- | --- |
| Plugin settings tabs | implementation + focused tests + real Desktop file: integration passed; visual review pending | Real localized tabs/panels; existing inventory and filters preserved; unload falls back |
| Plugin config cards/forms | keyed cards plus three built-in forms implemented; controller/UI tests, real Host save/reset and visual review passed | Host config read/write, actual schema, existing settings preserved |
| Sidebar additive actions | implementation + focused tests + real Desktop wide/narrow/unload passed | Correct owner, no empty wrapper, collapsed/expanded behavior |
| Workspace/directory selection | Home/project surfaces wired; 17 focused tests and Desktop Home/project smoke passed; native IPC bridge verified with OS boundary stub; browser picker open | Open/cancel/picked/error lifecycle, one workspace mutation authority |
| Session export | native plugin enabled + dialog adapted/tested; actual Desktop ZIP saved; ordinary Web download verification pending | Native command download on Web/Desktop without duplicate existing action |
| Official session open from no-selection | implemented; 17 focused tests + real Desktop plugin open passed | Explicit opens follow the existing Amiba path; startup restore stays suppressed. Clear and direct-child navigation need separate audit |
| Existing header/model/plan/command/reference extensions | open | Regression tests plus dependency/owner audit |
| Official component styles | open | Scoped compatibility assets; no changes to Amiba tokens or global defaults |
| Message actions | open | Exact MessageId, no arbitrary turn-to-message mapping, existing bubbles preserved |
| Turn tail/deliverables | chain and produced-files row verified on Desktop; prose references and standalone Web open | Real turn/step/business data and unchanged default rendering |
| Input zones | open | Correct reference offsets, draft images, revisions and submission phases |
| Chat/command/workflow nodes and views | additive conversation views implemented; focused tests, real Desktop registration/session injection/unload and screenshot review passed; nodes/commands/workflows open | Official data and callbacks, independent lifecycle, existing presentation retained |
| Tool subcalls/inspect | subcalls implemented; 26 runtime + 7 UI tests passed; inspect open | Real dispatch tree and trajectory target; no fabricated empty children |
| Dynamic Cordis UI | open | Plugin/package/run ownership and disposal, current tools preserved |
| Latest additive contracts | open | Versioned compatibility assessment and implementation where semantics can be preserved |
| Exclusive whole-surface ownership | boundary pending verification | Do not let a second root/composer take over existing capabilities |
| Full input machine/private DOM/native cross-platform APIs | boundary pending verification | Identify exact unsatisfied contracts instead of advertising partial implementations as complete |

## Verification log

Implementation in progress. No completion claim yet.

### Verified first batch

- Inventory tab selection, removal, keyboard navigation and unchanged filter state.
- Real SlotCore declarations and keyed configuration registration matched against
  the Host-served namespace list; subscriptions and declarations dispose.
- Sidebar tests: 22 passed, including existing settings and the added footer action.
- Existing inventory tests: 3 passed. New tab tests: 2 passed.
- Native export dialog: no idle DOM, session isolation, progress/error/dismissal.
- UI, SDK and runtime-inventory typechecks; shell and inventory production builds.
- Cold runtime preparation exposed an existing build-order omission: type-only
  workspace providers in devDependencies were not built first. Included those
  prerequisites; the complete workspace plugin dependency graph is acyclic.

### Evidence correction

The earlier external audit used local official source as an rc.2 proxy. The
actual installed `@deepseek-ai/dsh-client-ui-settings-plugins@0.1.1-rc.2` declares
`settings.plugin.item` as keyed, although that source checkout says list. The
implementation follows the actual installed declarations and client bundle.
Do not treat that local source commit as proof of byte-identical npm APIs.

### Completed-turn message-action finding

The installed rc.2 `TurnTailNodeView` dispatches assistant actions with
`closing.finalNode.messageId`. Its `tailData` selects the last finalized
assistant step containing nonblank text, ordered by final-node sequence. A
synthesized interrupted step may be that closing step and have no MessageId;
in that case the action slot is absent. Therefore Amiba's merged bubble is
not itself a blocker. Preserve this exact selection across step finalization,
retry and interruption, then carry the canonical identity to the existing
completed-turn surface. No bubble split or arbitrary first/last UI id is needed.

- Code Mode children now reach occupied toolviews in live and restored sessions.
- Ordinary tool rows remain byte-identical with an unoccupied toolview.
- Removing all plugin tabs restores the inventory DOM and preserves its filter.

### Desktop transport follow-up

Real file-renderer smoke revealed two origin assumptions requiring pinned patches:
settings classified file: as remote despite the managed loopback transport, and
session ZIP anchors retained the unresolvable dsh.internal hostname. Both patches
use the explicit desktop transport URL only on file: pages; ordinary Web origin
classification is unchanged. Connection authority tests cover local, remote and
missing transports. Real Desktop file: integration passed: Host namespaces were read, tabs/cards rendered
and unloaded, footer wide/narrow updated, and a nonempty ZIP with PK signature was
saved while preserving the product page. The file download uses a narrowly validated
preload handoff to Electron's native downloader; no request-header override remains.
Ordinary Web retains the official browser anchor path.

- Final full Desktop build and production dependency verification passed after the native download handoff; 14 download/boot boundary tests passed.

### Conversation view integration fixture

The first Desktop probe created and exported a session but opened it only through
`ctx.sessions.open`. Amiba deliberately clears official selection while its own
selection is empty, so no active conversation was displayed and the view tab did
not appear. The view probe now uses the existing `amiba:open-session` navigation
path to establish the product session. The follow-up below replaces this fixture workaround with the official API.

- Conversation views: 2 UI tests and 1 metadata-source test passed; shell and SDK
  typechecks passed. Full Desktop production build passed. Real installed-plugin
  smoke passed with actual session props/inject, mounted native chat and unload
  fallback. Screenshots reviewed after dismissing the export dialog; the native
  composer returns without residual tabs. Existing plugin HMR/detach checks and
  actual ZIP download also passed in the same run.

### Settings form scope correction

The actual installed rc.2 `ui-settings-plugins` client does not generate an
arbitrary form for every schema. It registers three explicit cards: `shell` (Bash),
`agent-loop`, and `web-search-deepseek`, each with its own controller. Custom
namespace cards are already supported; parity with the official package still
requires those three built-in forms and their real staged-save/secret behavior.
An invented universal schema editor is not required to reproduce this version.
Newer version contracts remain a separate audit item.

### Explicit session-open compatibility

Pinned `dsh-client-runtime@0.1.1-rc.2` now publishes per-open provenance before
its synchronous selection notification. Only the initial workspace policy labels
its own request `initial`; ordinary public `open(id)` labels it `explicit`.
The bridge can therefore follow a plugin request from Home without following
restored/startup selection. Failed opens preserve their original exception and
previous metadata. A newer explicit request invalidates older queued draft
projections; existing active-session fallback behavior is preserved.

- 14 bridge tests and 3 tests executing the actual patched runtime methods passed.
- Shell typecheck and final full Desktop build/production verification passed.
- The real Desktop fixture now uses `ctx.sessions.open(id)` directly from Home.
  Session-scoped view props/injection, native chat preservation, unload, settings,
  footer, actual ZIP save, plugin HMR and detach all passed in the same run.
- This does not certify official `clear()` or catalog-addressed child rendering;
  those navigation semantics remain to be audited separately.

### Built-in configuration forms

Runtime inventory now supplies the official `shell`, `agent-loop`, and
`web-search-deepseek` cards using Amiba primitives. The pinned settings package
exposes a standalone controller entry containing the exact controller regions
from its client bundle. This is statically bundled into the adapter: importing
the disabled whole settings UI as a dynamic client dependency was rejected by
the real module loader. The package's original settings page remains disabled.
A test verifies controller-region identity before exercising the standalone code.
Controller scope subscriptions and credential invalidation subscriptions are tied
to the owning plugin fiber. Existing inventory is still the default selected tab.

The official search controller previously treated an existing configured key as
proof that a replacement key saved, even after rejection. Both its original and
standalone implementations now check the write result and retain failed drafts.

- Four real-controller tests passed: staged save/reset, invalid numbers, rejected
  field saves, blank secrets, successful keys and rejected key replacement.
- Four UI tests passed: input/write gating, masked secrets, discard, unchanged
  empty inventory layout and tab selection/unload. External tab panels now scroll
  so longer configuration forms remain reachable.

- Final complete Desktop build and production verification passed. Real installed
  Desktop smoke saved and reset a field through each of the three forms, verified
  editing alone did not write, and checked that the password input remained blank.
  Screenshots reviewed at the top and bottom of the scrolling configuration panel.
  Credential success/rejection uses isolated controller fixtures, not real secrets.
- The same real run passed plugin-tab shadow/unload fallback, footer width,
  explicit session open, conversation view injection/unload, actual native ZIP
  download, plugin HMR/detach and preservation of the installed user profile.

### Directory flow lifecycle groundwork

`directory-flow.ts` supplies real open/busy/outcome state over an occupied slot,
awaits Host adoption before returning the path, cancels on occupant replacement or
unload, and ignores stale callbacks and late adoption results. With no occupant,
it calls the existing platform chooser with the exact original starting path.
Five lifecycle tests and shell typecheck passed. It is not yet wired to a product
surface, so directory-flow compatibility is not claimed complete.

Integration evidence and remaining requirements:

- The installed native picker nests injection of BOTH directory-flow keys before
  registering either one. Declaring only the Home key does not activate it.
- Its `pick()` calls `ctx.workspaces.pickDirectory()` without a starting path;
  Amiba Home and workspace-project pickers currently pass a starting directory.
  Preserve that capability when adapting the default native occupant.
- The native driver reads `outcome.current` when an asynchronous picker returns.
  Reopening before an older picker settles can route that old result into the new
  request. Surface integration must isolate request instances or fix that driver,
  in addition to the controller's own stale-callback guards.
- Home currently selects an intended path; workspace-project actions feed the
  existing development-project authority. Keep those caller actions, use real
  Host workspace adoption for the contributed flow, and do not fabricate owner
  callbacks or silently replace a project/session mutation path.

### Native directory picker request isolation

Pinned `dsh-client-ui-directory-picker-native@0.1.1-rc.2` now captures callbacks
per open cycle and discards results after close/reopen or unmount. Re-renders and
React StrictMode do not launch duplicate pickers; synchronous picker exceptions
reach the owner's error callback instead of escaping the React effect.

The test executes the real installed component extracted from the package bundle.
The same six cases against the unpatched managed runtime reproduced five failures;
all six pass with the patch, alongside the five directory-flow controller tests.
Surface integration, starting-directory preservation and real Desktop interaction
remain open; this patch alone does not establish directory-flow compatibility.


### Directory flow surface wiring

Both official single/root directory slots are declared together. A context bridge
connects Home and the workspace project's existing choose/add-folder actions;
no additional idle DOM, replacement controls or styles are introduced. The caller's
actual path adoption runs while the owner is busy: Home stores its intended path,
and project actions use the existing development service. This deliberately does
not create an extra Host workspace or session when merely choosing a Home path.
The controller still accepts Host workspace adoption when used by such a caller.

The patched native occupant accepts an optional Amiba native picker callback to
retain the original platform chooser and starting path. Other occupants receive
the unchanged required official owner contract. Each opened request has a separate
React key, including when close/reopen notifications are batched together.

Validation: 6 controller, 7 actual native component, and 4 chooser-context tests
passed; shell typecheck and complete Desktop production build passed. The real
Desktop smoke passed Home registration, cancel/reopen, stale callbacks and path
adoption, as well as existing settings/view/export/HMR checks. Native picker
interaction, project-surface integration and browser picker styling still require
runtime verification before marking this entry done.

Final Home smoke also asserts no session IDs are added by directory selection and
both default directory registrations remain after probe unload. The captured Home
screenshot was visually reviewed: original layout/composer/selected-path control
remain intact. Full smoke log: `/tmp/amiba-directory-desktop-smoke-final.log`.


### Project directory integration verified

The complete Desktop smoke now opens the existing workbench and its file tree,
uses the actual New project / Add folder buttons with a registered directory-flow
occupant, and reads the native project's persisted state. Verified creation,
cancellation without mutation, folder addition retaining project identity, and
session location binding to the newly selected folder. Fixture directories are
canonicalized with realpath to match the existing macOS project service behavior.
No production behavior or style changes were needed for this verification.

The final full smoke passed (`/tmp/amiba-directory-project-verified.log`), including
all previous Home/settings/view/export/HMR checks. The project-pane screenshot was
visually inspected. Default OS picker interaction and browser-picker rendering
remain separate open checks; fixture-occupant success does not prove those.


### Default native directory bridge verified

The Desktop smoke now removes the test Home occupant and clicks the existing
chooser again, exercising the installed official native component, its optional
Amiba callback, preload, and `workspace:choose-directory` main IPC. A temporary
native fixture replaces only `dialog.showOpenDialog` for directory requests and
records its options; it restores the original function on disposal/HMR.

The recorded defaultPath equals the prior Home selection, the options include
openDirectory, the returned path reaches the Home control, and session IDs remain
unchanged. Full regression smoke passed (`/tmp/amiba-default-native-picker-smoke.log`).
This verifies the production bridge, not a human interaction with the OS window.
The browser directory picker still requires activation, rendering and style checks.

### Browser directory picker investigation and scoped styles (verification pending)

The smoke can now use `--browse-directory` to set a temporary SSH launch signal,
which makes the official auto-picker compose its browse backend and client. The
actual directory listing and Cancel interaction succeeded. Visual inspection
found a transparent dialog painting over the Home composer: the official theme
is intentionally excluded, leaving the browser's aliases unresolved.

Added `official-directory.css`, scoped exclusively to the pinned rc.2 browser and
create-folder dialog CSS-module roots. It maps aliases to Amiba tokens and supplies
the missing dialog surface. No global official aliases are introduced. A fresh
Desktop build is running; runtime computed-style assertions and screenshot review
must pass before claiming the styling fixed. Directory path editing, creation and
selection remain to be tested with this real browse occupant.


### Browser directory dialog verified

Full production build and `--compat --browse-directory` smoke passed. Computed
styles prove the dialog background is opaque and the official background alias is
absent on the product shell. Both main and create-folder dialog screenshots were
visually reviewed. Through the official backend the test edits a real path,
creates a folder inside the temporary profile, selects it, and verifies its real
filesystem identity and the absence of new sessions. Cancel/reopen and all earlier
settings/export/project/view/HMR checks also passed. Log:
`/tmp/amiba-browser-directory-final.log`.

The browser backend returns lexical absolute paths; Home intentionally retains
that path. Unlike project-service normalization, tests compare its realpath only
when checking filesystem identity. The Open button must be awaited until enabled
after the post-create directory scan. No production behavior changes were needed
for those two test corrections. This run used the browser picker in Electron's
web renderer; a standalone Web deployment remains separately unverified.

### Turn-tail prerequisite: headless official conversation definitions

The installed rc.2 `conversation.chat.turnTail` is a session-scoped chain with a
real engine TurnLocation, closing assistant seq (or turn/end seq), and openFile.
Its Turn/Step data stores cannot be replaced with Amiba bubble ordinals. The
currently excluded ui-conversation package also owns the business definitions and
chat target builder that publish assistant-step and turn-tail data.

A source-level runtime test executes the actual package's contiguous headless
registration region, without React, DOM, slots or input services. Both tests pass:
registration includes assistant-step / turn-tail plus the chat target, and the
actual empty chat builder preserves the supplied engine timeline by reference.
This proves a headless extraction is feasible at registration time. It does not
prove complete event projection: external helpers used during event processing
must still be included, tested, packaged and wired before adding the render seat.
No turn-tail compatibility is claimed from this prerequisite test alone.

### Headless conversation module integrated (Desktop verification pending)

Added a pinned `ui-conversation/headless` ESM export. Its exact lexical dependency
closure is selected with the TypeScript symbol checker from the original bundle;
the only import is the official client runtime. No React, DOM, root slots or
composer state is included. The shell statically bundles this export and registers
its data definitions/target through a scoped conversationEvents/conversationViews
fiber, disposing it with the shell.

Five tests pass, including exact standalone/source identity and real history/live
projection. Tests run the actual official ConversationNodeAssembler and conversion
helpers extracted by the same dependency traversal, without engine substitutes.
They verify turn/start/end, step boundaries, closing seq/message ID and reference
identity between the chat node and timeline TurnLocation. Shell typecheck passed.
A complete Desktop build is running; actual plugin loading, lifecycle and regression
checks are still required. The turn-tail render seat is not yet implemented.

Headless follow-up: declared the actual runtime module in `dsh.client.external`
after the bundle verifier rejected its missing arrival dependency. The shell's
own production build now passes. Seven source/engine tests pass, including tool
call/result preservation across registry rebuild and history replacement, and
absence of a footer on an unfinished turn. A fresh complete Desktop build is
running. The smoke now checks the real mounted definitions and reads the chat
timeline through a plugin view's actual useSession hook.

Headless Desktop verification completed: full production build and actual
`--compat` smoke passed (`/tmp/amiba-headless-desktop-smoke.log`). The probe
asserts registered assistant-step / turn-tail definitions and the chat target,
then reads the real session chat timeline/node store through a contributed view's
useSession hook. Existing Home/project directory, settings, native ZIP, view,
HMR and detach checks pass. The stock conversation page remains disabled.

Next render prerequisite: Amiba groups bubbles by user messages, which must not
be treated as engine turn numbers. Carry the exact event turn number through
live/history message projection before mapping footer render sites, including
completed tool-only replies. The headless module alone is not a completed footer
adapter.

### Exact engine-turn currency carried through Amiba messages

Added optional runtimeTurn metadata from the actual nonnegative safe-integer DSH
turn number to bridge events, engine snapshots, historical assistant messages and
live/snapshot UI projection. The existing turnId and message/bubble identities are
unchanged. Missing or invalid turn numbers do not borrow the event sequence or
user-message ordinal. No new display or styling is introduced.

Seven mapping tests plus sixteen closing-assistant tests pass. Engine tests also
verify that a passive run's stream event and recovered snapshot preserve the
same exact number; the full engine test file passes. Shell typecheck passed.
The footer renderer still needs to use this metadata to read the corresponding
engine TurnLocation, handle missing history and avoid duplicate placement.

### Turn-tail render adapter: visible reply integration verified

Root now declares the official session/chain slot and forwards renderSlotChain.
The adapter resolves the actual session face, subscribes with bound methods, reads
the exact timeline TurnLocation by runtimeTurn, and uses official turn-tail data
for the closing seq (or turn/end seq when no closing assistant exists). The file
opener delegates to the existing workbench path behavior. No Cordis context is
passed into UI components.

Message rendering places the extension after the last visible assistant reply
with that exact engine turn number, before its action contribution. The owner
lookup does not require assistantMessageId; execution-only presentation anchors
remain to be wired. It adds no wrapper; all-declined chains
remain empty. Missing data and open turns render nothing. Three adapter tests and
41 message chrome tests pass, including exact reference/opener forwarding,
subscription disposal, duplicate prevention and unchanged empty-slot DOM. Shell
typecheck and the full Desktop production build passed.

The real installed Desktop fixture writes a deterministic turn through the Host
session log, using only its temporary workspace. The contributed chain displays
after the actual historical reply, receives the identical runtime TurnLocation
and closing seq, and disappears cleanly on unregister. Existing settings,
directory, ZIP, view, HMR and detach checks passed in that same run.

Remaining: live turn/data updates, actual file opening through the contribution,
execution-only presentation, and completed turns with no visible reply at all. Do not claim full turn-tail support
until that placement and end-to-end validation are resolved.


### Turn-tail placement beyond visible replies

The UI now locates each tail after the last rendered item belonging to the exact
engine turn, including execution disclosures and run boundaries. Existing
execution groups are not split merely because a chain exists. Closed turns with
no projected assistant row receive presentation-only anchors ordered by the
engine end sequence; these never enter persisted messages or submission history.
No content is emitted for an unclaimed chain, including a conversation with no
visible messages. Session changes dispose the old source and discard its anchors.

- 43 message chrome tests and 4 adapter tests passed, covering execution-only
  replies, empty history, sequence placement, session switches and unchanged
  empty-slot DOM. Shell typecheck and full Desktop production build passed.
- Real installed Desktop smoke passed: a Host turn remains invisible to the
  tail chain while open, then publishes its exact end sequence after a no-reply
  completion. The contributed opener displays actual file contents through the
  existing workbench. Dynamic unregister removes both historical and live tails;
  settings, directory, ZIP, view, HMR and detach regressions pass in the same run.
- The raw official session.create({cwd}) does not itself establish Amiba's
  separate per-session file-workspace binding. The file-opening smoke explicitly
  binds its temporary session before opening a file; this must not be counted as
  automatic workspace parity for official session creation/navigation.


### Official produced-files row enabled

The original ui-deliverables package is enabled again. Its actual event
accumulator, selector, localization, responsive chip layout and optional
chatFileMentions service run under their own plugin lifetime. The disabled
whole conversation UI stays disabled. Only the pinned row's CSS-module root
receives Amiba color aliases; no global theme or existing review card changes.

A "." tail open request uses the existing session-validated external-path
adapter, so the overflow row's Show in folder action opens the directory rather
than trying to preview it as text. Tail open failures render an error, and old
asynchronous outcomes cannot leak across turns or sessions.

- Actual official assembler/selector tests passed: successful mutation paths,
  duplicate paths, read-only/failed-call exclusions, closing-sequence cutoff,
  turn isolation and definition removal/rebuild. Five tail adapter tests passed,
  including rejected opens and stale outcomes. Shell typecheck passed.
- Full Desktop build passed. Real installed-plugin smoke derived seven files
  from Host tool-call views, opened actual file contents, and reached Electron's
  validated directory opener. Only the OS folder-open boundary was stubbed.
  Historical/live/empty tails, dynamic unregister, original settings, directory,
  ZIP, view, HMR and detach checks passed in the same run. Screenshot reviewed.
- Prose file references remain open: Amiba's current Markdown links handle
  explicit paths, but not the official unique-basename resolver. It must apply
  to the exact closing assistant content, including merged multi-step bubbles.
  Standalone Web and remote-host behavior also remain unverified.


### Closing-prose link provenance groundwork

Historical text timeline items now retain the exact finalized assistant/message
sequence as optional runtimeSeq metadata. A merged bubble can therefore distinguish
an earlier step's text from the closing step, including repeated filenames,
without changing its content, grouping or rendering. Unknown/live chunks remain
unattributed; no sequence is inferred from presentation IDs or string matching.
23 runtime/history tests and the shell typecheck passed.

Still required for prose links: live chunk/finalization provenance (including
retries), propagation through the native condensed/interleaved Markdown views,
and the actual official resolver's lifecycle, matching and file opening. Do not
apply a closing resolver to an entire merged bubble or assume Markdown node
positions remain global when Streamdown splits the source into blocks.


### Live text provenance and completed-Markdown positions

The DSH bridge now carries exact chunk step numbers and append-finalization
sequence/text, plus retry resets. The chat engine and stream buffer share a
source-range updater. Existing text and text-item grouping are unchanged;
metadata covers only attributable substrings of merged items. Retry resets
retire old attribution while leaving visible text alone. A finalization is
accepted only when its canonical text exactly matches that step's streamed
ranges; mismatches revoke any earlier finalization instead of guessing.
History items extended by later chunks retain their earlier source as a range.

Source-range arrays are replaced rather than mutated. Engine snapshots copy
text timeline items, so finalizing a later event cannot change an already
published snapshot. Runtime bridge/engine, retry/mismatch, snapshot and real
stream-buffer tests passed, as did the shell typecheck and existing message
chrome tests. This is provenance plumbing, not a completed prose-link claim.

The actual installed Streamdown static path renders the complete source in one
Markdown processor (its streaming path splits blocks). A real ChatMarkdown
rendering test confirms that completed inline-code nodes preserve full-source
offsets across multiple paragraphs, including repeated filenames. The next step
can therefore gate the official resolver by exact finalized-source ranges in
static native views, while preserving existing explicit-path links. Custom
source-transforming Markdown extensions must not be assumed to preserve offsets.


### Official closing-prose resolver connected

UI Shell now supplies the original chatFileMentions.forClosing provider with the
actual session TurnLocation, closing sequence and existing file opener. Native
Markdown supplies a source sequence only when the inline-code node lies wholly
inside a finalized text range. Existing explicit-path links remain the fallback;
unknown/earlier text and all streaming Markdown receive no new basename links.
The provider uses React context only and adds no DOM or style wrapper.

Source ranges are translated through the native result join and outer trimming.
Plain merged replies and condensed tool/reply results retain their native text
and layout. Ambiguous or noncontiguous text transforms decline attribution
rather than assigning a nearby source. The renderer uses the existing inline-code
and file-link styles.

- 53 message/file-link tests, 2 source-range translation tests and 6 adapter tests
  passed. These cover repeated filenames, unchanged empty-provider DOM, original
  explicit links, condensed tool replies, exact owner forwarding and missing
  session sources. Shell typecheck passed.
- Full Desktop build passed. Real installed-plugin smoke clicked a unique bare
  filename in a live finalized reply and opened actual file contents. Produced
  file chips, validated directory IPC, settings, workspace, ZIP, conversation
  views, HMR and detach passed in the same run. Screenshot reviewed.
- Remaining prose cases: finalized text represented inside folded process
  narration; noncontiguous body transforms (such as inline thinking markup);
  interrupted synthetic final nodes with no assistant/message event; a dedicated
  historical/reopen Desktop check; custom source-transforming Markdown providers;
  and standalone Web/remote-host behavior. Overall compatibility stays open.

### Folded narration and thinking markup source mapping

Finalized prose retains its exact source ranges when displayed inside the native
execution disclosure. Thinking extraction now reports retained raw slices to
the source mapper; the existing extracted body, whitespace rules, disclosure
classes and visible text are unchanged. Adjacent ranges merge only when they
share a source sequence. Extracted reasoning receives no prose attribution.

- 51 UI tests passed, including unchanged DOM with an empty provider, folded
  narration links, thinking removal, repeated blocks and separate source events.
  The existing thinking helper regression and Shell typecheck passed.
- Full production Desktop build and installed-plugin smoke passed. The smoke
  opens a real produced file from the final prose, expands the native process
  disclosure and verifies both source-mapped links. The screenshot was reviewed
  with the disclosure expanded and actual file contents open in the workbench.
- Synthetic interrupted finals, historical/reopen Desktop coverage, custom
  Markdown transforms and standalone Web/remote behavior remain open.

### Interrupted-final contract verified against the installed assembler

Four additional integration cases replay real official definitions through the
installed ConversationNodeAssembler, in both history and live modes, with either
a step boundary or only a turn boundary. All 12 headless integration cases pass.

The interrupted final has no message ID and uses the actual boundary sequence
minus the official 0.9 offset. Retry discards earlier chunks; block-end can
replace the accumulated text. Registry rebuild preserves this final node.
Consequently the prose adapter must read the actual final node, compare complete
step text against its final text blocks, and avoid inferring attribution solely
from a step number or the visible delta text. Production code must not recreate
the synthetic offset. This establishes the contract; interrupted prose mapping
is still unimplemented and is not marked supported.

### Live synthetic interrupted prose connected

Native text source ranges now preserve pending step identity through joining,
trimming, thinking extraction and folded narration. The message wrapper receives
the original assistant timeline. For a closed turn with an official interrupted
final and no message ID, it compares all pending text of the actual final step
with the final node's complete text blocks before consulting the original file
resolver. It uses the actual owner sequence, never a reconstructed offset.
Finalized ranges still require an exact sequence match. Streaming Markdown
remains unlinked, and removed/retried or corrected text cannot gain attribution
from a step number alone. Existing text and layout remain unchanged.

- 52 UI tests and 7 adapter tests passed; Shell typecheck passed.
- Full Desktop production build passed. The installed-plugin smoke's new
  --interrupted-prose variant emits real Host chunks and boundaries with no
  assistant/message event. It asserts the actual fractional final sequence and
  missing message ID, opens the real file from prose, expands folded narration
  and checks both links. The screenshot was reviewed. Settings, directory, ZIP,
  produced-file row, HMR and unload checks passed in the same run.
- Historical draft-only replies still lack source metadata in the history
  projector. Reopen coverage and that metadata bridge remain required, along
  with custom Markdown transforms, standalone Web and the broader open ledger.

### Historical draft provenance and renderer reload verified

The history projector tracks draft-only text ranges with the shared append/reset
helper and returns them as assistantDraftSource metadata. It leaves the existing
body selection (final text or draft), assistantTimeline rows, tool order and
reasoning untouched. A finalized message clears draft metadata; retries revoke
old step attribution without rewriting the existing displayed draft text.
The native Markdown mapping and turn provider consume this metadata without
inserting a timeline row, which would otherwise change tool-only layout.

- 24 history/runtime tests and 53 UI tests passed; Shell typecheck passed.
  The UI regression compares complete DOM before and after draft metadata on
  a tool-only historical reply, then verifies the new link.
- Final production Desktop build passed after removing redundant reset code.
  Two installed-plugin smoke runs passed: --compat --reopen-prose, and the same
  with --interrupted-prose. Both reload the entire renderer and require a
  pre-reload window marker to disappear before reopening the durable session.
  They click a restored prose link and verify actual file contents. The
  historical interrupted-reply screenshot was reviewed; native review and
  execution surfaces remain present. Settings, ZIP, directories, produced-file
  rows, HMR and unload checks pass in both runs.
- Existing history rules may omit a later unfinished draft when earlier final
  text already exists; this change does not rewrite that display policy.
  Custom Markdown transformations, Web/remote behavior and the remaining
  extension ledger are still open.

### Official public clear bridged to native deselection

The pinned runtime now marks public clear requests before its synchronous
selection notification. The bridge forwards only a new marked request, suppresses
its own clear projection, and cancels deferred opens. Unmarked internal selection
loss retains the existing Amiba-authoritative policy. The shell invokes the
existing sessions.deselect action, preserving tabs, messages and native layout.
A navigation revision also prevents a superseded list refresh from reopening
the cleared session or changing the surrounding shell chrome.

- 16 bridge tests and Shell typecheck passed. Tests cover explicit clear, own
  projection echoes, unmarked internal loss and cancellation of a deferred id.
- Full Desktop build passed after reverting the previous patch in the derived
  managed cache so preparation could apply the updated complete patch.
- Real installed-plugin smoke calls sessions.clear, checks empty selection and
  absent transcript, verifies unchanged session ids and reopens the same transcript.
  The complete --compat --reopen-prose run passed, including files, directories,
  settings, ZIP, HMR and detach. During capture the main window became hidden;
  restoring it through the existing native open-in-main action let the same run
  complete without a restart.
- Follow-ups: include patch identity in dependency-cache reuse so patch upgrades
  need no manual cache repair; verify/cancel navigation already inside native
  openTab metadata/history loading. Directory adoption must preserve explicit
  Amiba bindings and default-directory choices. Broader compatibility stays open.

### Managed dependency cache checks patch identity

Runtime preparation now records a digest of sorted patched package specifiers
and their patch contents, independent of patch file location. Reuse requires
this digest as well as the existing dependency/platform checks. A legacy marker,
modified patch, removed patch or different patched version starts from locked
registry files, so a partially old patch set cannot be copied into an upgrade.

The two dependency-reuse tests cover unchanged/reordered patches, changed
contents, removals, changed versions and legacy markers. The real upgrade build
started from the existing marker without a patch digest, ran locked npm ci,
applied the reviewed patches from clean files and completed the production
Desktop bundle. The resulting marker contains patchSetHash. No manual cache
repair was used for this validation.

### Cancel native session opens before their asynchronous work completes

Two regression tests first reproduced late reopening after deselect: one while
history was pending from Home, and one while an unlisted session's metadata was
pending. Native navigation now assigns its cancellation token before metadata
lookup or outgoing flush, carries that token into activation and checks it after
each loading boundary. Deselect invalidates pending opens even when the current
visible state is already Home. Tabs committed before cancellation remain open;
a canceled metadata lookup cannot append a new tab or select it.

All 21 session-store tests and Shell typecheck passed. The full production
Desktop build passed and reused the same patched dependency tree, verifying
the positive cache-reuse path after the preceding legacy-cache migration.
The installed-plugin --compat --reopen-prose run passed without manual window
recovery: official clear/reopen, history reload, ZIP, files, directories, settings,
HMR and detach. Artificially delayed metadata/history cancellation is covered
by the state-store regressions; the Desktop run verifies normal plugin routing.
No UI layout or style code changed for this fix.

### Markdown transform identity, updates and source ownership

The real Streamdown 2.5 pipeline cached processors by function names, causing
distinct extensions with same-named attachers to reuse earlier transforms.
Amiba now adds inert identity metadata to each remark/rehype pipeline, using
weak identities shared across module instances and the extension revision.
The original plugin functions, options, order and Unified deduplication remain
in place. Remark and rehype marker attachers have separate identities to avoid
merging their options. A pipeline identity key also refreshes Streamdown's
rendered output when implementations change without a version bump; unchanged
pipelines retain mounted component state.

- 70 Markdown/message tests passed, followed by all 8 source-position tests
  after adding an ordinary-rerender mount-stability regression (71 distinct
  checks in total). Shell typecheck and final production Desktop build passed.
- Actual MarkdownProvider/Streamdown tests cover inserted paragraphs, rewritten
  anchored code, reordered paragraphs, padded multi-backtick spans, and newly
  generated code without source positions. Original positions retain message
  ownership even if the displayed value changes. No new text-equality restriction
  was added. Generated nodes without provenance cannot be assigned to a merged
  reply's original message; explicit native path links remain available.
- Real installed-plugin smoke registers, replaces and removes two same-name,
  same-version transforms through amiba.markdown.extension. It verifies replacement
  output, retained produced-file links and complete unload. Full --compat
  --reopen-prose passed, including settings, clear/reopen, files, directories,
  ZIP, history, HMR and detach. The post-unload history screenshot was reviewed.
- Hidden test windows previously stalled compositor capture. The native smoke
  fixture now shows only its own main test window before capture; the final
  entire run completed without manual recovery. No production window policy
  or stylesheet changed. Web/remote and the remaining extension ledger stay open.

### Catalog child history transport (2026-09-12)

- Verified the installed rc.2 `SubagentsApi` contract and official runtime's
  `Session.history`: catalog children use `subagent.history` with their durable
  direct-parent address, not ordinary `session.history` or Agent activation.
- Added the address to the platform history options, the exact addressed RPC
  to DshApiClient, and address propagation across all `loadMessages` pages.
  Ordinary callers retain their existing transport. A mismatched child ID fails
  before RPC; catalog failures propagate without fallback or implicit resume.
- All 25 tests across platform-adapters, DshApiClient and session storage passed;
  both app-runtime and shell typechecks passed. Tests cover both child modes,
  pagination, render views/projections, mismatched addresses and host errors.
- This is transport groundwork, not complete child navigation: address discovery,
  shell open/reopen metadata, selection intent, child prompt/interrupt semantics
  and actual renderer verification remain open. No UI or stylesheet changed.

### Retained child selection projection (2026-09-12)

- The selection bridge now recognizes official `subagentAddress(id)` as an
  openable target even when the child is absent from root-list `ids`. Re-selecting
  an existing addressed child no longer leaves official scoped slots deferred.
- Deferred selection checks address availability again in its queued callback;
  disappearance, reappearance and newer deselection preserve cancellation rules.
  Immediate open failures also return to deferral instead of losing the target.
- A regression test exposed synchronous re-entry through the bridge's own
  `clear()` notification following a failed open. Own clear notifications now
  update the observed current selection and return without recursively opening.
- All 21 selection bridge tests and shell typecheck passed. This proves bridge
  state behavior, not full child UI support. Public `openSubagent` intent from
  Home, native child metadata/address persistence, history wiring and child
  interaction semantics still need integration and renderer verification.

### Native child metadata and history lifecycle (2026-09-12)

- Added a validated, copied catalog address to native session metadata and its
  local sidecar. It is a navigation hint; addressed RPCs remain Host-validated.
  Invalid addresses fail before navigation, and conflicting Host parent IDs are
  rejected. Root-list absence no longer prevents creating child tab metadata.
- `openTab(id, address)` loads addressed history; switching back, exporting and
  resolving historical message IDs retain the same transport. New store instances
  still start at Home and can recover an explicitly reopened child's saved address.
  Discovering an address for the already selected ID forces a transcript reload.
- All 34 session-store/storage/platform tests passed, including unlisted children,
  refresh, tab switching, export, store recreation, malformed addresses, Host read
  errors and copying caller-owned address objects. App-runtime and shell typechecks
  passed. No UI source or stylesheet changed.
- Official navigation events do not yet supply this optional address. End-to-end
  event integration, child prompt/interrupt semantics and Desktop renderer/build
  verification remain open; these unit tests do not establish full child support.

### Official addressed-open event wiring (2026-09-12)

- Official selection forwarding now copies the retained child address into the
  existing `amiba:open-session` event. ProductShell passes it to native `openTab`
  and retains it if the session store is not ready yet. Clear still discards the
  entire deferred request and invalidates outstanding navigation revisions.
- Ordinary opens keep their existing event semantics. All 22 selection bridge
  tests and shell typecheck passed; the added check verifies exact direct-parent
  identity and that the forwarded object does not alias the runtime's address.
- Before Desktop end-to-end verification, child interaction transport must be
  completed: the existing DshChatEngineClient unconditionally calls session.create
  and session.prompt, and abort calls session.cancel. Addressed continuable children
  instead need subagent.prompt/subagent.interrupt; one-shot children must honor the
  official read-only semantics. Its mux subscription behavior also needs checking.
  Public openSubagent intent from Home remains distinct from marked public open.

### Addressed continuation RPCs and confirmed limits (2026-09-12)

- Added exact `subagent.prompt` and `subagent.interrupt` client RPCs carrying
  parent, child and continuable mode. Prompt returns the official opaque string
  MessageId and carries optional browser timezone and AbortSignal; it does not
  use root session creation, model selection or ordinary prompt/stop methods.
- Checked actual rc.2 Session.prompt/cancel and API declarations: one-shot children
  are read-only and uncancellable through this interface; child image prompts are
  rejected by the official client. Added the same defensive checks and recorded
  these version-specific limitations in the assessment table.
- All 14 DshApiClient tests and app-runtime typecheck passed, including exact
  wire envelopes/receipts and no-RPC checks for one-shot or image input.
  These are RPC primitives only. Chat engine dispatch, mux subscription readiness,
  UI controls and end-to-end Desktop verification are still outstanding.

### Chat engine child stop dispatch (2026-09-12)

- ProductShell now supplies a stable chat-client resolver that reads the latest
  native or official child address without recreating the chat engine on tab
  changes. Continuable child abort calls subagent.interrupt; it does not call
  ordinary session.cancel, create a session or require parent availability.
  One-shot and mismatched addresses cannot fall through to root cancellation.
- All 17 chat engine tests and app-runtime/shell typechecks passed. Existing
  ordinary cancellation remains covered. Desktop visual/runtime verification has
  not yet run for this group of child changes.
- Sending is still open. Host events.mux emits initial subscribed frames only for
  attached sessions, while a cold catalog child may attach during continuation.
  Reusing waitUntilSubscribed(child) before subagent.prompt can therefore deadlock.
  The send integration must establish mux readiness without requiring preexisting
  child attachment, and propagate unavailable-parent errors rather than waiting
  forever. Do not claim that current child prompt dispatch is complete.

### Child send dispatch and header-established mux (2026-09-12; carrier superseded below)

- Verified the pinned Host Fetch client's `readSse`/`onOpen` contract: headers and
  a readable response establish the mux before any attached-session frame exists.
  Added `openEvents` using that HTTP stream, retaining existing WebSocket events
  for ordinary sessions. Its iterator can close an unread stream after a rejected
  prompt, handles split UTF-8/frame boundaries and propagates HTTP/stream errors.
- Addressed sends now establish this mux then call subagent.prompt; they do not
  run workspace resolution, session.create, model selection or ordinary prompt.
  One-shot and mismatched addresses reject before opening a stream. Parent errors
  propagate through the existing chat error event and close the stream immediately.
- All 37 client/engine tests passed. Cases include an empty mux, unread cleanup,
  split UTF-8 frames, HTTP failure, cold-child send ordering without a subscribed
  frame, unavailable parent, and unchanged ordinary conversation behavior.
- Desktop runtime endpoint availability, actual parent/child fixture continuation,
  read-only controls, explicit openSubagent-from-Home and full renderer verification
  remain open. This is not an end-to-end compatibility completion claim.

### Correct browser carrier after Desktop verification (2026-09-12)

- The first child build passed, but Desktop HTTP testing exposed two mismatches:
  the existing unary fetch IPC buffers whole bodies, and a native HTTP mux request
  received 403. The official Fetch carrier is not the browser connection carrier.
- Rechecked installed WebApiClient.readWebSocket and Host WebSocketDownlinks:
  the browser carrier uses socket `open` as its stream-established signal. Replaced
  the temporary SSE implementation with this exact readiness boundary. All native
  HTTP mux and CORS changes were removed; ordinary transport/security stays intact.
- `openEvents` starts the existing WebSocket iterator, waits for socket readiness,
  preserves its prefetched first frame, and closes even when a prompt fails before
  consuming frames. Failure/cancellation before opening reject and release resources.
- All 38 client/engine tests and shell typecheck passed. Production Desktop build
  `/tmp/amiba-child-websocket-build.log` completed successfully. Full Desktop
  `--compat --reopen-prose` smoke passed (`/tmp/amiba-child-websocket-smoke.log`),
  including actual WebSocket readiness and existing settings, ZIP, view, file,
  Markdown replacement, reload, directory, HMR and detach checks. Previous HTTP
  smoke failed and is not counted as verification.
- These results verify the corrected carrier and regressions. Actual durable
  parent/child navigation and continuation fixtures, read-only UI controls and
  public openSubagent-from-Home remain to be completed and tested.

### Real catalog-child Desktop navigation (2026-09-12)

- Added opt-in `--child-navigation` to the installed-plugin Desktop smoke.
  The temporary Host fixture creates a real session with parentSession/origin
  metadata and an in-turn v2 subagent/descriptor, then appends its own transcript.
  The fixture explicitly injects sessions; ordinary root fixture tracking ignores
  child creation so parent test state is not replaced.
- Initial fixture attempts exposed missing service injection and missing descriptor
  identity. Actual catalog projection requires the descriptor, not just origin.
  Neither failed attempt is counted as successful navigation verification.
- Full `--compat --reopen-prose --child-navigation` passed against the built
  Desktop (`/tmp/amiba-child-navigation-descriptor-smoke.log`). It verifies real
  catalog discovery, public openSubagent from an active parent, child-only transcript,
  exact retained parent address, parent return, child reopen and all existing
  compatibility regression checks. No production UI or style changes in this step.
- This fixture verifies persisted event reading, not actual model execution.
  Home-origin openSubagent intent, read-only controls, cold child reload and real
  continuation remain open.

### Home-origin explicit subagent navigation (2026-09-12)

- Extended the pinned runtime's existing navigation-intent patch to public
  openSubagent. It marks the child before synchronous selection notification,
  and restores the previous marker if catalog validation throws. Startup/restore
  selection remains unmarked and therefore retains Amiba's Home behavior.
- All 23 bridge tests and shell typecheck passed. The added test executes the
  actual installed patched method against the bridge, covering Home forwarding
  with its retained parent address and rollback on selection failure.
- Updated --child-navigation Desktop smoke with clear-to-Home then public
  openSubagent and parent return. Production build passed
  (`/tmp/amiba-child-home-build.log`), including managed patch-cache invalidation
  and locked dependency installation. Full --compat --reopen-prose
  --child-navigation passed (`/tmp/amiba-child-home-smoke.log`), including the
  real Home-origin child open and existing compatibility regression checks.
  Patch installation skipped lifecycle scripts and updated the lockfile patch hash.
  Read-only controls, cold child reload and actual continuation remain open.

### One-shot child composer policy (2026-09-13)

- ChatSurface derives read-only state only from a retained one-shot address and
  passes it to the existing Composer disabled state. No CSS/layout replacement.
  The queue's send, send-now, drain and stop entry points refuse read-only actions;
  the turn runner also returns the supplied draft instead of dispatching it.
- Queue tests verify that read-only attempts preserve draft and queued text, do
  not call the runner or engine abort, and resume existing sending after returning
  to an editable session. Shell typecheck passed.
- Extended real-child smoke with visible editor contenteditable=false, screenshot,
  parent return restoring contenteditable=true and optional --child-reload verifying
  the child after a complete renderer restart. Initial build passed, but the first
  Desktop smoke failed its read-only assertion: RichComposerEditor only used
  disabled in Lexical's initialConfig, which does not react to later prop changes.
- Added an in-context editable-state synchronizer without remounting Lexical;
  disabled editors no longer forward paste or register submission chords. The
  regression test verifies both transitions on the same editor/DOM with its draft
  retained. All 19 editor/composer/queue tests and shell typecheck passed.
- Production rebuild passed (`/tmp/amiba-child-editor-state-build.log`). Full
  --compat --reopen-prose --child-navigation --child-reload passed
  (`/tmp/amiba-child-editor-state-smoke.log`): one-shot editor is read-only,
  parent editor becomes editable, and child transcript/address/read-only state
  survive a complete renderer reload. The child screenshot was visually reviewed;
  original layout and native disabled styling remain. This is renderer restart,
  not cold Host/Agent recovery. Actual continuation remains open.

### 子会话地址在列表同步期间的保留（2026-09-13）

- 先用回归用例复现两种地址丢失：列表刷新读取旧 sidecar 后，用户才打开目录子会话；以及另一窗口广播含同一子会话但不含地址的旧列表。原实现两个用例均失败。
- 外部列表合并现在保留已确认的子会话地址及直接父 ID，仍接受标题等字段更新。显式传入的新地址或不同父 ID 不会被本地旧地址覆盖。此修改不涉及界面、样式或正常根会话运输。
- 37 个会话存储/平台适配测试与 app-runtime 类型检查通过；覆盖刷新竞态后切换回子会话仍使用 subagent.history、旧广播保留地址、显式新元数据覆盖旧值。此项为状态层验证，不替代实际可续聊执行及冷 Host 恢复验证。

### 可续聊子会话真实执行和停止（2026-09-13）

- 新增 `continuable-child-fixture.mjs`，由桌面 smoke 的 `--child-continuation` 加载。仅在独立临时配置中注册本地 LlmAdapter；父子 Agent 都显式指定该测试提供器。通过官方 `agents.create`、`subagents.startContinuable` 创建会话，模型分块交给实际 Agent loop 写入历史和发送事件，不手工伪造该子会话的回复或完成事件。
- 从真实目录打开后，通过 CDP 键盘输入驱动 Amiba 原输入框提交 `COMPAT_NATIVE_FOLLOWUP`；界面收到对应官方执行回复。再提交持续等待的模型请求，点击原“停止生成”按钮，验证模型 AbortSignal 实际收到取消，并且原输入框退出忙碌状态。
- 测试父会话也使用本地模型处理官方子会话结算通知，避免后台通知意外调用外部服务。仍保留官方时间上下文；测试适配器只提取明确的测试输入标记，不将最后一条系统注入上下文误当用户输入。
- 此次测试复用已有桌面构建（实际执行相关产品源码未改）；新增内容仅为测试夹具和覆盖。冷 Host 重启恢复、图片输入限制的完整 UI 仍未由此证明。

### 命令图片提交接入（2026-09-13）

- 原桥接固定将空图片列表传给 `CommandClaim.submit`。现在 Amiba 原输入器捕获本次附件，通过现有 Host staging 读取原始字节，验证身份、大小、类型，按官方 `SubmitImageAttachment` 传递 mediaType/data/name；不把缩略图或暂存 ID 冒充图片内容。
- `claim.images` 未开启、上传未完成、非图片附件或读取失败时，在现有命令提示区域报告原因并保留草稿和附件。成功仅移除本次捕获的附件；重复点击不重复提交，提交期间修改的文字或新增附件不被清空，跨会话完成也不清空新会话草稿。正常发送、输入器布局和 CSS 未替换。
- UI 文本时间线的本地类型此前漏掉已存在的来源字段，导致 MessageChrome 测试类型检查失败；改为复用核心 text 分支类型，运行行为不变。
- 原图序列化 8 项、输入管线 14 项、消息展示 49 项、桥接 11 项测试通过（82 项）；UI/Shell 类型检查及完整 Desktop 构建通过。
- `/tmp/amiba-command-images-smoke2.log` 退出 0：`--compat --command-images --child-continuation --child-navigation --child-reload` 从原隐藏文件输入上传真实 PNG，通过官方 source 的命令判定和原发送按钮执行，断言插件收到的完整 base64、文件名及 MIME 与上传文件相同，成功后附件与草稿被消费。同轮子会话发送、停止、只读、重载及现有完整兼容回归通过。首次 smoke 因未等待附件上传完成点击了禁用按钮；已补等待，不将该失败算作成功证据。
- 这只补齐命令携带图片的提交路径，尚不表示完整 `useInput/inputActions` 的草稿、引用和附件 ID 服务已接入。

### 官方提交判定的附件数量（2026-09-13）

- 实际 rc.2 的 `InputTriggerController.adjudicate(line, signal, envelope)` 将第三参数直接传给每个 source 的 `matchEnter`。官方 commands source 会读取 `envelope.images`，且不会补默认值。此前 Amiba 的结构类型和调用都遗漏该必需参数。
- 先复现 0 张及 2 张图片的两项失败，再补充真实图片数量；普通文件不计入该数量。公共结构类型直接引用官方 source 回调参数，避免再次把必需字段漏掉。24 项相关测试与 UI 类型检查通过。
- 完整输入服务的后续约束：官方 `SessionProvideChannel` 拒绝同名 hook/prop 的重复提供者；现有 `input` / `inputActions` 来自 ui-conversation 的 InputHub。完整桥接必须接到该唯一提供者及真实编辑器状态，不能叠加第二套同名提供者或只提供空快照。
- 完整 Desktop 构建通过；`/tmp/amiba-input-envelope-smoke.log` 的 `--compat --command-images` 退出 0，真实官方 source 在 `matchEnter` 阶段收到 `{images:1}`，随后命令仍收到原图字节。既有完整兼容 smoke 同轮通过，未修改布局或 CSS。

### 输入扩展异步提交的取消与过期结果（2026-09-13）

- 先复现修改草稿、切换会话和卸载输入器后的三个失败用例：旧 adjudication 的 AbortSignal 未取消，返回 undefined 后仍可能走普通发送，晚返回的 claim 也可能进入新的草稿。
- 原输入器现在为判定与引用展开持有同一个提交 AbortController。草稿、会话、禁用状态或附件改变以及卸载时，取消旧提交并释放该提交的锁；旧结果、异常和 finally 均不会覆盖或解锁后续新提交。已经进入命令执行的提交仍按原成功/失败结算规则处理。
- `expandMentionsAsync` 接受可选外部 signal 并传给官方 reference codec；开始前与展开后检查取消，拒绝忽略取消的插件晚返回结果。未传 signal 的既有调用仍可用；普通资源解析行为保留。
- 32 项输入管线、原图序列化和引用展开测试，以及 UI 类型检查通过。包括旧 claim 在新提交等待期间返回仍不接管新草稿、旧 finally 不解锁新提交、已取消的请求不调用 codec。此次是状态和接口回归验证，未重复完整桌面构建/烟测；未修改 CSS 或布局。

### 输入草稿与引用的独立投影（2026-09-13）

- 实际 npm rc.2 的公开 InputState 用完整 `@label` 和 offset/length 表示引用；现有 Amiba 触发菜单以单个 U+FFFC 芯片计算 span。为保留既有菜单及光标行为，新增独立 `InputDraftProjection`，不直接改变 `$scanDraft` 的坐标约定。
- 从真实 Lexical 树读取完整草稿和官方引用表：同名引用按节点身份分配不同稳定 occurrenceId；保留 source/ref/label/clipboardText，UTF-16 偏移计入中文、Emoji、段落间隔。没有官方 owner 的原生/旧芯片保留原持久化 token，不伪造引用来源。未改变内容时复用冻结快照，后续编辑不会修改已交出的快照。
- `createTriggerEditorOps.readInputDraft` 与 Shell 的 `inputDraftFor(sessionId)` 已连通真实编辑器；没有编辑器时返回 undefined，旧绑定卸载不移除新绑定。菜单 revision 现在也识别完整持久化内容变化，避免引用身份/标签改变而占位字符串未变时漏更新。
- 39 项编辑器/输入管线及 12 项桥接测试通过；UI/Shell 类型检查通过。仅新增读取投影和绑定入口，**尚未**替代官方 useInput/inputActions 提供者，也尚不包含图片 ID、阶段、队列或完整公共写入桥接。该投影是下一步单一输入提供者适配的数据来源，不能据此宣称完整输入服务已支持。此步未改 CSS 或布局，未重复桌面烟测。

### 实时输入草稿订阅（2026-09-13）

- 在真实编辑器读取投影之上增加 `subscribeInputDraft` 和 Shell `inputDraftSource(sessionId)`：每个会话拥有稳定 source，绑定、编辑、替换与卸载通知相应订阅者；无编辑器时 snapshot 为 undefined。没有重复注册官方 input 提供者。
- 公开 draftRev 现在按完整草稿/引用投影独立递增，不依赖触发菜单更新监听器的执行顺序。绑定期间每次编辑先刷新投影，再通知监听者；即使中途没有读取、编辑后恢复原文，版本仍递增，避免旧 span 被误当作当前操作。
- 每次编辑器绑定拥有独立身份；旧绑定的事件、bail 操作与清理都不能作用于替换后的编辑器，即使两次绑定复用同一个 ops 对象。订阅清理幂等，旧清理不会移除后来注册的监听者。
- 41 项编辑器/输入管线和 16 项桥接测试，以及 UI/Shell 类型检查通过。此步未改布局或 CSS、未重复桌面构建。公开官方 useInput/inputActions 提供者、写入操作、图片 ID 和提交阶段仍待接入；这里完成的是其所需的实时数据源与生命周期。

### 公开草稿写入到原编辑器（2026-09-13）

- 新增按完整显示文本写入的 `setInputDraft`，从 Shell 当前会话绑定路由到真实 Lexical 编辑器。通过前后公共草稿差异定位最小修改，并转换到原菜单坐标；未受影响的引用节点及 occurrenceId 保留，编辑穿过引用内部时只将该引用转成文字。没有重建整套输入器或替换样式。
- 可选 expectedRevision 在修改前比对公开草稿版本；过期、无编辑器、只读或提交判定冻结时拒绝写入。返回值以实际公共草稿是否变成目标文本判断，不以底层占位字符串变化冒充成功。
- 先复现空段落边界失败，再为已有坐标解析补上记录在 scan.spans 中的元素边界；覆盖完全空段落、开头/结尾空段落及段落分隔符局部替换。
- 32 项编辑器、20 项输入管线和 17 项桥接测试通过（69 项）；UI/Shell 类型检查通过。覆盖同名引用稳定身份、中文/Emoji、只修改一个引用、无效版本、只读/冻结、跨会话路由，以及原占位字符串不变但实际引用已改变的返回值。未重复桌面构建或烟测。
- 这是完整输入服务的原编辑器写入端，尚未连接官方唯一 `inputActions` 提供者；提交动作、阶段、附件 ID 及其他剩余兼容项仍需完成。

### 原输入器的公开提交阶段（2026-09-13）

- 草稿订阅现在合并真实 `plain` / `claimed` / `adjudicating` / `submitting` 阶段及命令描述。CommandClaimStore 在已有进入命令、退出命令及真实提交步骤上发布状态；快照只暴露 token/hint/images，不暴露 submit 函数。提交中保留本次捕获的命令描述，即使草稿修改已退出实时命令模式。
- 阶段变化不增加文本 draftRev；未变化快照保持同一引用。判定和提交期间拒绝公开草稿写入，已有原输入操作保持原路径。
- 命令状态按会话建立；每次提交拥有独立身份。切换会话不再让旧命令阻塞新会话，旧完成回调不解除新提交的锁、不清空其草稿。原文字/图片发送仍经现有路由。
- 63 项编辑器/输入管线/图片序列化与 17 项桥接测试通过，UI/Shell 类型检查通过。新增真实桌面 `--input-state` 验证读取、订阅、写入与过期版本拒绝，并与图片命令一起核对四种公开阶段。
- 本步骤仍未替代官方唯一 input/inputActions 提供者；图片 ID、队列、完整官方提交动作桥接等仍在原目标范围内。
- `/tmp/amiba-input-phase-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-phase-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实桌面读取/订阅/写入及过期版本拒绝通过，原图片命令经订阅实际发布四个阶段；子会话发送、停止、只读、重载和既有完整兼容回归同轮通过。覆盖了前几步未重复桌面构建的输入投影、写入及异步生命周期组合。

### 扩展提交入口连接原发送路径（2026-09-13）

- 新增 `bindSubmit` / `submitInput(sessionId)`，将会话地址映射到当前 Composer 的真实提交回调。回调经过原命令路由、提交判定和引用展开，再调用原 onSubmit；不会另起一套发送器，也不会将空草稿提交转成 Stop。
- 原发送条件抽成可对指定草稿求值的函数，ChatSurface 原按钮与扩展提交共同使用。扩展调用读取 Lexical 最新的持久化文本，覆盖“同一次事件先 setInputDraft 再 submit”而 React 属性尚未提交的情况；异步取消按本次捕获草稿校验，避免把这次正常属性同步误当用户修改。
- 返回 true 仅表示进入原输入器提交判定，不表示 Host 已接受或模型已完成。只读、附件忙碌、现有发送条件不满足、提交已在进行及错误/过期会话回调均返回 false。最新绑定卸载后不可再提交，旧绑定清理不覆盖新绑定。
- 60 项编辑器/输入管线和 18 项桥接测试、UI/Shell 类型检查通过。新增用例在同一 act 中写入并提交，确认只发送一次最新内容；原异步取消与命令生命周期回归通过。此步未改样式或布局，未重复完整桌面构建。
- 这是原编辑器提交端，仍需接到官方 inputActions 的唯一提供者；附件 ID、图片操作及其他全量兼容项仍未完成。

### 草稿附件契约复核（2026-09-13）

- 直接复核实际 npm rc.2 的 `dsh-client-ui-conversation/lib/client.js` 及 `contract/slots.d.ts`：`conversation.input.attachments` 已由 composer.bar 注册，并非只有新版才存在。已修正评估表第 15 行，后续以实际包为准。
- 官方 ComposerAttachment 持有 browser File、DraftAttachmentId 和 previewUrl；Conversation.createDraftImages 先验证整个批次 MIME，再注册图片；draftImages 保留请求顺序并跳过已释放 ID，serializeDraftImages 对缺失 ID 拒绝。releaseDraftImage 删除注册项并释放 object URL。
- 适配必须保留浏览器草稿与 Host 暂存附件的独立身份，并接通成功消费、移除和会话释放；不能把 Host staging ID 填入官方 imageIds，也不能以缩略图代替原 File。此处为已确认的接入约束，尚未完成附件桥接。

### 扩展提交入口的真实桌面验证（2026-09-13）

- `--input-state` 新增通过实际 Shell composerInputs 调用的桌面用例：同一次浏览器事件先写入再提交，首次进入官方命令判定；再次同步写入中文/Emoji 参数并提交，官方 claim 收到最新文本。两阶段均断言紧接的重复提交被拒绝。
- 命令夹具保持待完成 Promise，核对真实 submitting 阶段后才释放；成功后原编辑器清空并回到 plain。空草稿以及未绑定会话的提交均拒绝。夹具只注册测试命令，不调用外部模型。
- `/tmp/amiba-input-submit-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-submit-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。新增入口用例、原图命令、全部四种输入阶段、真实子会话执行与取消、只读/重载、现有设置/目录/Markdown/插件生命周期回归同轮通过。
- 覆盖前一步产品提交入口改动；本步没有改产品样式、布局或发送行为。官方唯一 input/inputActions 提供者、草稿附件映射和剩余全量兼容项仍待完成。

### 原生附件进入官方草稿图片注册表（2026-09-13）

- 原 ChatSurface 的附件入口现在将实际浏览器 File 交给 composerImages.createDraftImages，并在 hook 内以原 UI 芯片 ID 保存注册描述；官方 DraftAttachmentId 与 Host staging attachmentId 分开。原附件展示、上传、命令原图读取和普通发送仍走原路径。
- 注册资源随芯片移除、直接清空附件状态、上传失败或输入器卸载释放；上传中移除仍删除晚到的 Host 暂存文件；等待会话 ID 时卸载不会事后注册浏览器资源。释放闭包绑定创建该图片的服务，服务替换后也不向新实例释放旧图片，重复释放无副作用。
- 实际桌面未创建官方 ConversationController，仅注册官方无界面节点；首次桌面用例因等待不存在的 conversation 服务而失败。已改为独立 composerImages 注册表，按实际 rc.2 的图片方法契约提供创建、顺序读取、原图序列化及释放，不能据此宣称完整 conversation 服务已存在。官方不接受的原生图片格式保留原上传能力。注册描述仍持有原 File，绝不以缩略图代替。
- 5 项附件生命周期、26 项原输入管线和 20 项 Shell 桥接测试通过（51 项），UI/Shell 类型检查通过。完整官方 input/imageIds 提供者、官方草稿向原输入器添加及队列恢复仍未由此完成。

- 注册表新增整批 MIME 验证、URL 分配中途失败回滚、原始字节与顺序验证、已释放 ID 序列化拒绝和 dispose 后拒绝创建测试；3 项通过，合计相关测试 54 项。前述“官方唯一 input 提供者”是官方完整 ui-conversation 启动后的约束，不能误写成 Amiba 当前已存在该提供者；当前仅有原生 composerInputs 桥接，后续需建立真实 provider。
- 修正后的 `/tmp/amiba-draft-image-registry-desktop-build.log` 完整构建退出 0，`/tmp/amiba-draft-image-registry-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实 PNG 经原文件输入上传，确认兼容注册表持有原 File、正确大小和 blob 预览，读取 File 全部字节与上传数据一致；原命令成功后注册项消失。既有图片命令、输入提交、子会话执行与停止、只读/重载及完整兼容回归同轮通过。

### 扩展草稿图片进入原附件流程（2026-09-13）

- 新增会话绑定的 inputImagesFor/addInputImages/removeInputImage，通过原 Composer 和附件 hook 操作已有卡片及上传函数。扩展创建的 File 和 DraftAttachmentId 保留，不再重复注册；Host staging ID 仍独立。
- 添加前核对全部 ID 均能按请求顺序解析；缺失 ID、没有输入器、只读、提交判定/命令执行中、上传或手动附件忙碌时拒绝，不释放调用方未被接受的图片。空批次遵守相同接入条件。旧绑定卸载不移除新绑定，过期会话回调不操作新会话。
- 浏览器注册的原生持有者按注册表实例和草稿 ID 计数；重复 ID 或不同会话共享图片时，最后一个持有者释放后才释放预览。绑定不改变原文件类型支持。
- 扩展附件在等待 session ID 前建立原生待上传芯片，允许同一次操作立即移除；lookup 失败或输入器卸载释放资源。上传计数同步更新，扩展添加后立即 submit 不会因 React 尚未刷新 busy 属性而发送空附件；并发原生上传在全部结束前保持 busy。
- 8 项附件、28 项输入管线、23 项桥接及 3 项注册表测试通过（62 项），UI/Shell 类型检查通过。新增冻结判定测试使用斜杠草稿触发实际 adjudication；最初普通文字未触发该回调，已修正测试输入。
- 这是内部会话附件桥接，尚未注册完整官方 input/inputActions 提供者。同步完整 imageIds 快照、pruneImages、队列恢复及其他全量兼容项仍待完成。
- `/tmp/amiba-input-images-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-images-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。扩展用浏览器 File 创建草稿，通过 addInputImages 进入原卡片；混入缺失 ID 整批拒绝且保留原草稿；添加后立即 submit 返回 false，上传完成后原命令收到正确文件名和全部 base64 原图，成功消费对应草稿。立即添加后移除验证没有残留卡片及浏览器注册项。原输入提交、原生图片上传、子会话执行/停止/只读/重载及既有完整兼容回归同轮通过。

### 实时图片草稿快照与失效引用清理（2026-09-13）

- 新增 inputImagesSource 会话数据源：稳定 source、冻结数组快照、未变化时复用快照；添加/移除/清理和绑定/解绑均可观察。原 Composer 保持一次图片绑定，通过原附件 hook 的订阅推送变化，附件更新不再临时解绑成 undefined。旧编辑器通知和旧清理不作用于替换后的绑定，清理幂等。
- 原附件状态增加同步引用，由统一 setAttachments 按最新列表应用函数更新一次，再驱动 React 展示；图片快照和通知在操作内更新。扩展在同次调用 addInputImages 后可立即读取原图片 ID，remove/prune 后可立即读到新列表。上传进度变化不创建无意义的新图片快照。
- 新增 pruneInputImages/pruneDraftImages，按可用草稿 ID 清理对应原生芯片，保持非注册图片及普通文件；按官方契约，维护性 prune 不受提交/上传 admission 锁阻止。成功上传后只有暂存元数据变化，不重复发图片列表通知。
- 卸载时清空同步附件引用，晚到的上传结果因此进入既有“芯片已移除”路径并删除 Host 暂存文件；不再使已卸载输入器持有晚到的文件。浏览器注册释放规则和共享持有计数保持。
- 10 项附件、28 项输入管线、25 项桥接及 3 项注册表测试通过（66 项），UI/Shell 类型检查通过。覆盖同次添加/清理同步读取、旧快照不可变、保留普通文件、忙碌期间 prune、元数据变化不重复通知、晚上传清理及绑定替换隔离。
- 尚未将文字/图片/真实 Host 队列合成官方 InputState 并注册 input/inputActions 提供者；队列恢复及其他剩余兼容项仍在完整目标范围内。
- `/tmp/amiba-image-source-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-image-source-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实输入器添加图片的同一次调用立即读到 ID；订阅捕获添加和 prune 后的列表，重复读取复用快照且过程中没有暂时解绑的 undefined；上传忙碌中先保留一张再清空，待上传全部结束仍为空，注册资源均已释放。既有原生/扩展图片命令、输入提交、子会话及完整兼容回归同轮通过。

### 原输入状态与真实 Host 队列合成（2026-09-13）

- 从实际官方 conversation.input.left owner 推导 ConversationInputState 类型，合并真实 Lexical 草稿/引用/阶段、同步浏览器 imageIds 和 SessionFace.getSnapshot().queue。严格使用 Host 收件队列；不将本地待发送队列的 ID 或内容冒充官方队列。
- inputStateSource 按会话缓存稳定数据源。草稿、图片 ID 序列和队列引用未变时复用冻结快照；仅阶段或图片变化不增加文字 draftRev；图片 ID 序列未变时复用其数组。缺少实际编辑器、附件绑定或 SessionFace 时返回 undefined，不合成伪空完整状态。
- 订阅同时连接草稿、图片和真实会话队列；会话服务更新时重绑队列，旧 owner 的事件不再通知。即使同一 owner 对象经历断开后重新接入，旧订阅回调也被独立绑定标识隔离；取消订阅幂等。
- 4 项合成状态、25 项输入桥接和 3 项图片注册表测试通过（32 项），UI/Shell 类型检查通过。测试使用有完整 id/messageId/placement/content/preview/text 的 Host 队列行，核对其原对象身份和更新通知。
- 此步骤为真实 InputZone/公共输入提供者的数据来源，尚未注册 useInput/inputActions 或输入区域扩展入口；未绑定会话的动作语义和队列恢复仍需处理，不能据此宣称完整输入服务已完成。已清理 SDK 注释中过时的单占位引用假设。
- `/tmp/amiba-combined-input-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-combined-input-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实桌面合成状态读取到原草稿、扩展添加同次调用内的 imageIds 及全部四种输入阶段；queue 与实际 SessionFace 当前队列保持同一引用，重复读取复用快照。既有图片、提交、子会话与完整兼容回归同轮通过。此桌面用例验证真实队列来源，非空队列更新和重新绑定由前述状态测试覆盖，尚不代表完整队列编辑/恢复链路已验证。

### 四个官方输入区域的真实接入（2026-09-13）

- 声明并派发 conversation.input.dock、conversation.composer.dock、conversation.input.left、conversation.input.right，均使用实际 rc.2 的 list/session/InputZone 契约。InputRegion 订阅真实 ConversationSnapshot 与合成原输入状态，只在两个 owner 都存在时调用扩展；会话替换后旧源不再更新区域。
- 位置遵循官方契约：input.dock 在卡片上方，composer.dock 在下方，left 在原工具行已有控制项后，right 在模型控件后、发送按钮前。通过原 FullScreenChatView/ChatSurface/Composer 传递；裸 React 节点无额外盒子或 CSS，空入口不增加 DOM、间距或样式。原输入器和已有控制项保留。
- 6 项 Composer 入口/空节点测试、28 项输入管线、2 项区域 owner/订阅测试、4 项合成状态测试通过（40 项）；UI/Shell 类型检查通过。
- 旧 accessory 断言要求辅助内容在卡片外，使用 HEAD 原 Composer 和原测试独立复跑同样失败（/tmp/amiba-input-regions-baseline-test.log）。现有产品已将其放在卡片内，因此修正过时断言并保持实际布局，不为测试移动原组件。临时基线文件已清理。
- 这些区域由 owner 接收真实 session/input，无需伪造 useInput。依赖尚未提供的 useInput/inputActions、完整 conversation 服务或其他私有依赖的扩展仍需后续适配；本步骤不宣称全部组件可直接使用。
- `/tmp/amiba-input-regions-desktop-build.log` 完整构建退出 0；`/tmp/amiba-input-regions-desktop-smoke4.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。四个真实插件入口传入正确 sessionId、真实 Host queue 和原草稿，文字/图片变化更新 owner；位置符合上下 dock 和工具行左右区。卸载保留同一个原编辑器节点，卡片类名及宽高恢复至挂载前。截图 amiba-input-regions.png 已查看，现有操作保持可见。
- 首次桌面夹具将 React 打入插件包导致 process 未定义；改为 external 复用运行时 React。随后位置断言错误地要求插件元素直接邻接原控件，实际运行时会包装插件元素；截图和 DOM 确认位置正确后，按区域分支与原卡片/发送按钮的相对顺序核对，未更改产品代码绕过该断言。前三次失败不计为通过证据。


### 官方标准 inputActions 提供者（2026-09-13）

- 通过真实 `sessions.provide` 注册 `inputActions`，按会话缓存动作对象。操作每次查找该会话当前绑定的原输入器；卸载旧编辑器不会移除替代编辑器，也不会改到其他会话。
- `setDraft` 使用 Lexical 的同一差分写入路径。官方 rc.2 的 `draft-changed` 不拒绝 adjudicating/submitting，因此单独增加用户编辑操作；原菜单/CAS 写入的锁定规则保持不变。真实只读输入器仍拒绝写入。
- 图片添加、移除、清理及提交调用现有桥接；`submit()` 保留官方 void 契约，不能把内部准入布尔值解释为 Host 已接收。
- 未挂载输入器的草稿写入明确报错；这仍是与官方常驻会话草稿的差异。当前未注册 `useInput`，不制造空状态来伪装完整输入服务。
- 验证：Shell provider/bridge 28 项、UI editor/pipeline 64 项通过；Shell 与 UI 类型检查通过。完整 Desktop 构建通过。真实插件经标准属性拿到 inputActions，并完成写入、提交以及旧命令成功后保留新草稿；图片、子会话续聊/停止、导航及 renderer 重载回归通过，输入区域卸载后原编辑器身份和卡片尺寸保持。
- 日志：`/tmp/amiba-input-actions-tests.log`、`/tmp/amiba-input-actions-ui-tests.log`、`/tmp/amiba-input-actions-desktop-build.log`、`/tmp/amiba-input-actions-desktop-smoke.log`。


### 官方附件展示入口（2026-09-13）

- 声明并实际渲染 `conversation.input.attachments`（single/session-maybe），传递真实浏览器附件 File、DraftAttachmentId 和 previewUrl。原附件条、文件选择、编辑器及样式保留。
- owner 的图片添加和移除回调使用原附件 hook。每次操作检查当前会话身份、只读、命令/引用处理锁和上传状态，旧会话回调不能修改新会话。空插件入口不添加包装元素。
- 未提供没有根据的数量/大小限制；官方可选 dropLimits 保持缺省。普通文件仍通过原附件入口操作。
- UI 附件入口与注册链路 18 项测试、Shell/UI 类型检查及完整 Desktop 构建通过。真实插件以标准 single 槽优先级覆盖官方默认组件，添加/读取/移除原始图片通过；卸载后恢复默认组件。默认官方文档 drop 与原输入框 drop 同时存在时只暂存一张图，同步上传门禁阻止重复添加。子会话续聊/停止、导航及 renderer 重载回归通过。
- 首次桌面测试发现已有官方附件组件占用 priority 0，按框架规则将测试插件改为 priority -100；未修改框架冲突规则。最终日志 `/tmp/amiba-attachment-seat-smoke3.log`，截图 `amiba-official-attachment-seat.png` 已查看，原附件条和输入器保留。插件新增的预览区域属于附加展示。
- useInput 的完整提供仍需按会话拥有草稿生命周期，不能用组件未挂载时的空值假装常驻输入状态。


### 输入状态的会话组装时序与生命周期（2026-09-13）

- 官方 InputHub 的 shellFor(binding) 明确在会话作用域可按 ID 查询之前执行。原组合输入状态只通过 sessions.binding(id) 查队列，在标准提供者初始化期间可能缺少会话对象。
- inputActions 提供者现在使用 resolve(binding) 直接获得的真实 session，通过会话 effect 绑定到输入桥。组合输入状态优先使用这份对象；旧版单独使用桥接的调用方仍保留按 ID 查找的回退。
- 按会话/作用域对象去重复绑定。替换时先绑定新对象，再清理旧 effect，避免瞬时 undefined；每个绑定的清理令牌只可移除自己。移除插件提供者或作用域销毁时释放订阅，不留下旧队列监听。
- 新增测试覆盖首次 materialization 尚无法按 ID 查询、非空真实队列身份、重复 resolve、对象替换、不出现瞬时空状态、过期清理、队列变化与 provider.dispose；相关 Shell 测试共 33 项通过。
- 本项未引入离屏草稿或 useInput 空值替身。完整常驻输入状态仍需处理 native draft、引用、图片及提交生命周期，未据此宣称完整输入兼容。

- 本项验证：Shell 类型检查、完整 Desktop 构建及真实桌面兼容测试通过。日志 `/tmp/amiba-input-session-owner-types2.log`、`/tmp/amiba-input-session-owner-tests.log`、`/tmp/amiba-input-session-owner-build.log`、`/tmp/amiba-input-session-owner-smoke.log`。


### 按命令名分派的官方命令结果入口（2026-09-13）

- 接入 `conversation.chat.commandview` keyed/session 槽，entryKey 使用原节点 name（缺失为官方规定的空串）。从真实 Chat order/nodes 读取可见命令，保持原 CommandNode 引用；manual-compaction 使用官方投影已经关联的数据，不凭邻近序号猜测压缩关联。
- 展示锚点仅用于 MessageTurns 的渲染，不写 session 消息存储，也不进入发送历史。按引擎 anchorSeq 定位到现有消息/工具展示组之间；保留工具折叠组整体，发生在组内的命令展示附加在组后，尚不提供拆开折叠过程的精确内部位置。
- 原历史转换已将 command/run、command/done 映射为命令输入和结果消息。因此只为当前 keyed 槽赢家生成展示锚点，并隐藏同一 commandId 的原结果展示，避免历史重载后重复；命令输入与存储数据保持。卸载或无注册时不生成锚点，恢复原生结果和样式。
- 消息 UI 52 项、命令投影 1 项测试通过；UI/Shell 类型检查通过。测试覆盖空入口无额外 DOM、独立命令、两轮会话之间的位置、原工具折叠组不变、原参数及明确压缩关联。

- 真实桌面已验证 Host 日志中的 command/run → command/done：插件收到原始参数、执行中状态、完成结果及真实 CommandNode 对象。整页 renderer 重载后覆盖原结果只显示一份，卸载恢复原生结果；输入、附件、子会话续聊/停止、导航及其他兼容回归通过。
- 日志：`/tmp/amiba-command-rows-ui-tests3.log`（52）、`/tmp/amiba-command-rows-tests.log`（1）、`/tmp/amiba-command-rows-types4.log`、`/tmp/amiba-command-rows-ui-types2.log`、`/tmp/amiba-command-rows-build2.log`、`/tmp/amiba-command-rows-smoke2.log`。`amiba-command-row.png` 截图已查看。


### 动态 Cordis 业务区域（2026-09-13）

- 真实桌面探针证实，官方动态运行器已可加载 Client 包，但 Amiba 的原生 cordis_run 语义卡片覆盖了官方 Run 卡片，缺少其子区域渲染位置。这是展示适配缺口，不是动态代码不能运行。
- 保留原生工具卡片及折叠行为，在其下方附加 `tool.view.cordis`。owner 使用真实结果 metadata 的 Plugin/Package/Run ID；entryKey 遵守官方 `${pluginId}.${packageId}` 规则。真实动态包仍通过官方 Guard 的 key:self 注册，不提供绕过 Guard 的入口。
- 使用官方 session 的工具结果树决定同一包的最新成功卡片，并与本页 loaded 列表精确匹配 activation。停止后撤销业务区；失败、过期、缺失元数据及无会话来源时不制造 owner。递归覆盖嵌套 tool result。
- 原工具视图 45 项加业务区 3 项测试通过，涵盖最新归属、失败/缺失数据、运行实例不符、停止更新及订阅清理。真实 Host 定义、Client 运行器加载、交互、元数据归属、停止及样式清理已通过桌面验证；未据此证明双端 handler RPC、版本升级或崩溃回退全部完成。

- 构建与类型检查通过。探针通过官方 define 创建包、startUserRun 加载、Guard key:self 注册，使用真实生成的 run identity 构造测试工具结果；不是生产模型自主触发 cordis_run 的测试。已查看 `amiba-cordis-business.png`，原生 Run module 卡片、折叠过程和输入器保留。
- 验证日志：`/tmp/amiba-cordis-business-types2.log`、`/tmp/amiba-cordis-business-tests.log`（48 项）、`/tmp/amiba-cordis-business-build.log`、`/tmp/amiba-cordis-business-smoke6.log`。早期探针失败分别暴露了测试脚本错误导入 React、未展开原折叠组、原卡片缺少子区域以及测试 ctx 未声明 remote 依赖；正式适配仅补充缺少的业务区域。

- 组合回归 `/tmp/amiba-cordis-business-smoke7.log` 通过，包含动态业务区、命令历史重载、标准输入动作、命令图片、子会话续聊/停止/导航/重载及此前兼容检查。


### 动态 Cordis 双端调用与版本切换验证（2026-09-13）

- 将业务区探针扩展为真实 Host + Client 双端包。Host 使用官方 harness.handle 注册带内部计数器的方法，Client 按钮通过 host.call 发送中文/Emoji 参数；计数和回传文本均来自 Host，未在 Client 模拟返回。
- 验证运行中错误 run ID 返回 stale-run；停止后原 ID 返回 plugin-not-running。同一 Package 重启获得新 run ID，旧 ID 被拒绝，新 Host 闭包计数重新从 1 开始；旧工具卡片不承载新 activation。
- 通过真实 define(existing Plugin) 创建第二个不可变 Package，使用 startUserRun(mode:update) 切换双端代码。新卡片显示 v2 界面，RPC 返回 Host-v2，只有一份业务组件；前一版本 run ID 返回 stale-run。历史工具记录保留。
- 组合 Desktop 回归通过，日志 `/tmp/amiba-cordis-rpc-update-smoke.log`；包含命令历史重载、标准输入动作、图片和子会话续聊/停止/导航/重载。初次双端/重启验证日志 `/tmp/amiba-cordis-rpc-smoke.log` 也通过。本轮使用已构建产品，仅扩展探针与评估记录。
- 仍未把这些证据当成模型发起审批全流程、故意抛错后的界面回退或 Host 冷重启持久化已通过的证明；这些边界分别继续核对。


### 动态业务组件渲染失败隔离（2026-09-13）

- 真实双端测试包在 Host 计数到 3 后，Client 组件于 React 渲染阶段主动抛出 COMPAT_RENDER_FAILURE。官方 renderFailures 报告 tool.view.cordis 和 abdicated:true，截图确认失败业务区域撤下、原工具行和输入器保留。
- 同一原编辑器 DOM 可继续写入并展示新草稿；原工具组仍连接。停止该实例后，官方错误记录和插件 style[data-dyn] 都已清理。
- 官方 Host 会将渲染错误反馈给会话；截图同时显示测试环境缺少模型密钥时的原生凭据错误。这不是插件渲染边界失效，也不把它当作模型恢复生成成功的证据。
- 组合桌面验证完成到最终卸载成功标记，日志 /tmp/amiba-cordis-crash-smoke.log，截图 amiba-cordis-render-failure.png 已查看。覆盖命令重载、图片、输入、子会话续聊/停止/导航/重载及此前兼容项。只增加测试及记录，生产代码无需新增异常边界。

### 工具调用至官方轨迹的定位（2026-09-13）

- 实际 npm rc.2 的 tool.call.toolview.inspect 负责设置 callId 并打开 trajectory；conversation.view 的 owner 携带 inspect / onInspectDone，官方轨迹表选中匹配记录、滚动定位并确认消费。它不是文件打开动作，也不要求启动另一套 ConversationController。
- 原生视图区域增加可选受控选择。Shell 只在 trajectory 已注册且有当前会话时向工具扩展提供 inspect；沿用原工具行及资源打开控件。原 Chat 始终挂载，切回或卸载后保留同一编辑器及草稿。
- 请求由会话访问周期隔离；切换会话、卸载并重装视图后的旧回调失效。旧确认不能清除新请求。消费请求后保持选中 trajectory，用户仍可切回原 Chat。
- 官方组件首次渲染暴露缺少主题变量。新增局限于 data-conversation-view=trajectory 的颜色、字体和边框别名，没有启用全局 ui-theme。最终截图确认时间线、选中工具行、Payload/Result/Timing 正常，原侧栏保持。
- 官方工具行 45 项、定位状态 2 项、视图区域及工具入口 10 项测试通过；Shell/UI 类型检查和完整 Desktop 构建通过。真实官方编译包经 ModuleLoader 与 Cordis 注册后，使用 Host 中真实工具结果验证选中 pkg-2 而非旧 pkg-1。卸载后原编辑器对象、草稿、卡片高度、字体及未泄漏的主题变量均已验证。
- 日志：/tmp/amiba-trajectory-shell-tests.log（原工具行 45 项通过；新增 hook 测试缺少 jsdom 标记已修正）、/tmp/amiba-trajectory-shell-tests2.log（2 项）、/tmp/amiba-trajectory-ui-tests.log（10 项）、/tmp/amiba-trajectory-types2.log、/tmp/amiba-trajectory-ui-types.log、/tmp/amiba-trajectory-build2.log、/tmp/amiba-trajectory-smoke2.log。截图 amiba-trajectory-inspection.png 已查看。
- 桌面测试由测试端加载官方原包，再通过 ctx.plugin 注册。它证明真实组件、数据、定位和清理，不等同于完整插件配置启用、安装依赖图或所有新版轨迹扩展已经验证。默认 bundle 中 ui-trajectory 仍禁用，避免自行增加默认视图。下一步须验证可选插件通过正常 Host 配置进入 Client 图的路径。

### 官方轨迹插件的正常配置启停（2026-09-13）

- 新增隔离 profile 的 Host Loader 测试：通过 loader.create 添加实际官方 ui-trajectory 条目，通过 loader.remove 移除。不修改 bundled 配置，不在测试端注入官方 JS；插件包来自正常 Host 图和浏览器启动加载。
- 初次动态添加后 Host 图已出现 trajectory，但浏览器不消费图变化。复核实际 rc.2 的 dsh-client-hmr，graph 分支明确不处理，仅 rebuilt 分支热更新已有条目。这是官方刷新生效机制，不是轨迹组件的依赖失败。
- 重新加载 renderer 后，真实 trajectory Client fiber 启动，官方会话根 ui-conversation 仍不在 Host 图中。原工具折叠组按现有默认状态恢复；测试展开后点击工具扩展 inspect，官方轨迹选中实际 pkg-2 调用并显示原结果，局部字号为 13px。
- 正常移除条目并重新加载后，轨迹视图消失，唯一 Amiba 根页面及原 Chat 恢复。此路径验证配置和启动依赖，不声称新插件可以免刷新启用，也不将其当作跨刷新未发送草稿持久化的证据；输入状态持久化仍在完整输入适配范围内。上一项免刷新 ctx.plugin 卸载的原编辑器/草稿保留证据仍成立。
- 最终组合回归 /tmp/amiba-trajectory-loader-smoke5.log 退出 0，包含命令历史重载、输入状态、图片、子会话续聊/停止/导航/重载、产出文件、配置及清理。早期日志 1/3 验证了需刷新，日志 2 暴露测试 Host 未声明 clientModules 注入（已修正），日志 4 暴露重载后测试未展开原工具折叠组（已修正）。本轮仅扩展验证脚本和文档，复用已通过构建的生产代码。


### 原生会话草稿与引用持久化（2026-09-13）

- 原输入器改用按会话驻留的草稿源，通过平台 StorageAdapter 保存 version:1 的原生 token 文本。沿用 MentionSerializePlugin 的无损格式，保存 source、ref、label、clipboardText，不将公开显示字符串当作引用身份；首页草稿保持独立。
- 写入按会话串行，订阅释放存储监听；恢复读取带修订号和读取代次隔离，不能覆盖后续编辑或显式空草稿。离屏写入尚未完成时不读取旧磁盘值。异步 setter 绑定原会话，首次发送创建会话后工作目录失败则恢复到实际新会话。
- 官方编辑器绑定延后至序列化更新之后的微任务，避免将上一会话 Lexical 树短暂发布给新会话。早期桌面探针捕获该瞬态；最终验证第二会话收到的每一帧均为空。试验性的同步 Lexical flush 导致原触发管线回归，已完全撤销，保留原异步序列化机制。
- 真实官方触发源插入含中文、Emoji、分隔符的引用，经过会话切换和完整 renderer reload 后逐字段验证身份；第二会话普通草稿也独立恢复，两边显式清空均保留。截图 amiba-resident-reference-draft.png 已查看，原输入器和引用样式保持。
- 草稿源、RichComposerEditor、触发管线及待发送队列共 49 项测试通过（/tmp/amiba-resident-draft-tests5.log）；UI 类型检查通过（types5），完整 Desktop 构建通过（build4）。最终组合桌面回归 /tmp/amiba-resident-draft-smoke3.log 退出 0，涵盖本项、动态 Cordis、正常轨迹配置启停、命令、输入状态、图片和子会话续聊/停止/导航/重载。
- 本项补齐原生文本与引用的生命周期，没有改变附件策略或 UI 样式。官方 useInput、离屏 inputActions、图片驻留及队列恢复仍未全部接通；不据此声明完整输入兼容。


### 完整输入服务的转换边界与引用编码修正（2026-09-13）

- 再次核对实际 rc.2 的 input/contract.d.ts 与 client.js：inputActions.setDraft 接受完整可见文本，机器通过 draft-changed 的 diff scan 保留未编辑的引用。SessionStandardProps.useInput 是非空的 SnapshotSelectorHook；只有 SessionMaybeStandardProps 允许状态为空。因此不能给所有会话提供一个离屏时返回 undefined 的 hook，或把公开文本直接存进原生 token 源来宣称兼容。
- 当前 $setInputDraft 通过可见/原生坐标映射，编辑引用内部时仅解散命中的引用。后续离屏写入必须保留相同语义，并区分普通文本和引用节点；当前 parseTokens 会把识别到的合法 token 解释为引用，单纯将任意公开字符串交给它不是通用的纯文本写入接口。完整驻留输入还需统一 occurrence 身份、draftRev、命令 phase 及图片/队列状态。
- 本轮复现引用 payload 的反斜杠编码缺陷：token 扫描器把原始反斜杠及后一字符当作转义对，最后字段以反斜杠结尾会吞掉闭合方括号，反斜杠后换行同样导致匹配失败。新增 4 个 Windows 路径/换行/百分号及分隔符/Emoji 用例在修复前全部失败（/tmp/amiba-reference-backslash-before.log）。
- 编码器新增 %5C，解码在 %25 之前执行，避免将原有字面 %5C 二次解码。旧合法原始反斜杠路径和已有百分号转义仍有回归覆盖。UI 展示与操作路径未改。
- 相关序列化、驻留草稿、真实 Lexical 编辑操作与触发管线合计 88 项测试通过（/tmp/amiba-reference-backslash-tests.log），UI 类型检查通过（/tmp/amiba-reference-backslash-types.log）。桌面驻留草稿探针改为携带尾反斜杠的真实官方引用，并从同一个 expectedReference 对象生成浏览器注册及重载后的逐字段断言。
- 完整 Desktop 构建通过（/tmp/amiba-reference-backslash-build.log），最终组合桌面回归退出 0（/tmp/amiba-reference-backslash-smoke.log）。真实引用的路径和 clipboardText 末尾均含反斜杠，会话切换及 renderer 重载后逐字段一致；命令、图片、轨迹正常配置启停、动态 Cordis、子会话和插件开发生命周期回归均通过。此结果证明编码及现有链路，不代表完整离屏输入服务已实现。


### 输入公开修订号的跨绑定隔离（2026-09-13）

- 原 InputDraftProjection 生命周期属于一次 Lexical 操作绑定；新绑定会重新从本地 draftRev 和 occurrenceId 起算。公开接口此前直接转发本地值，旧回调可能在返回同一会话后撞上相同修订号，误通过 setInputDraft 的条件写入。
- Bridge 现在为每个会话保留公开修订号与引用编号游标。每次绑定都预留比上一绑定更高的公开修订号；编辑通知和解绑时读取最终本地修订号，即使没有外部订阅者也不丢失中间编辑。状态阶段变化不递增文本修订号，同一绑定中的引用编号保持稳定，新绑定重建的引用不复用旧编号。
- 带 expectedRevision 的公开写入先核对当前公开修订号，再转换回当前编辑器本地修订号，由原编辑器继续执行条件及阶段检查。未提供 expectedRevision 的原写入路径保持；slash/input-* 使用的触发坐标与修订号不改。引用编号目前只保证当前 renderer 内不会因编辑器重建而混用，不宣称跨 renderer 重启保持 occurrenceId。
- 36 项 Bridge、公开动作、输入状态和新绑定测试通过（/tmp/amiba-input-revision-tests2.log），包括无订阅者的最终编辑、旧清理回调、重复访问、引用编号不复用、状态阶段变化、编辑离开后返回相同文本、公开修订号转换及缺少可读状态时拒绝条件写入。Shell 类型检查通过（/tmp/amiba-input-revision-types.log）。
- 桌面驻留草稿探针增加：返回原会话后修订号必须递增，使用离开前修订号的写入必须拒绝，原引用草稿保持。完整 useInput、离屏输入操作及驻留图片状态仍需继续接通。
- 完整 Desktop 构建及最终组合桌面回归均退出 0（/tmp/amiba-input-revision-build.log、/tmp/amiba-input-revision-smoke.log）。真实会话返回后的过期写入被拒绝，既有 input-state 探针的最新修订号写入成功、旧修订号拒绝也通过；引用恢复、命令四阶段、图片、轨迹、动态 Cordis、子会话及插件开发生命周期保持通过。未修改 UI 结构或样式。


### 子会话的真实 Host 冷重启验证（2026-09-13）

- 新增 --child-cold-restart 组合探针，要求同时运行 compat、child-navigation 和 child-continuation。通过现有 agentDiagnostics.restart 更换实际 Host PID，确认旧 PID 已不存在，再完整刷新 renderer；不是只清理前端缓存或模拟断线。
- 重启标记使 Host 测试插件停止创建会话/工具记录，仅重新注册测试模型适配器及原探针。一次性子会话从持久化数据恢复历史、直接父地址和目录，原输入框只读；返回父会话正常。可续聊子会话也能读取原历史；实际官方 subagentAddress 仅返回已发现的地址，先刷新父目录再按 ID 打开可建立地址，不能假定读取历史就等于已发现目录关系。
- 首次完整续聊失败的确切原因来自实际 npm rc.2 dsh-host-apiproxy/lib/index.js 的 subagent.prompt：ctx.agents.get(parentSessionId) 缺失时返回 subagent-parent-unavailable。它要求直接父 Agent 已驻留，不会在此入口自动恢复父会话。错误已通过原输入器展示，不能改成成功或绕过父子归属检查。
- 测试接着通过 ctx.agents.resume({resumeSessionId:原父ID,agentOptions:原测试模型配置}) 恢复同一个已持久化父会话，未新建父/子会话、未注入回复。再次通过原输入框发送后，官方 subagents.coldResume 从原子会话描述恢复运行实例，测试模型生成 COMPAT_CONTINUABLE_REPLY COMPAT_COLD_FOLLOWUP。该结果证明条件满足后可冷恢复续聊；产品的自动父恢复入口、配置恢复及并发恢复管理仍需适配，不将测试端恢复父会话当成生产能力已补齐。
- 初次日志 /tmp/amiba-child-cold-restart-smoke.log 暴露目录地址未发现；第二次 /tmp/amiba-child-cold-restart-smoke2.log 记录父 Agent 不驻留的真实错误。最终 /tmp/amiba-child-cold-restart-smoke3.log 退出 0，包含上述父恢复后的真实续聊及原有完整兼容回归、插件卸载/原配置保留。本轮只增加验证脚本及文档，复用上一轮已验证的生产构建。


### 原发送流程中的直接父会话恢复（2026-09-13）

- prepareSubmit 在既有会话归属/轮换准备完成后，检查目标会话的持久化头与自身日志后缀。普通会话和未持久化的新会话走原路径；仅 version:2、mode:continuable 的子会话尝试恢复日志头指定的直接父会话，跳过 fork seed 中祖先的描述符。
- 已驻留父会话直接复用，包括仍由上层子代理拥有的父会话。冷父会话交给当前 Host 已配置的 typert.lookups.get('agent').resolve，复用官方 ApiProxy 的预设日志恢复、并发复用、缺失身份拒绝及子会话归属限制。不新建解析器、不调用 session.create、不猜测 cwd、模型或父会话 ID。
- 原发送准备接口仍返回原目标 ID；准备失败沿用原输入器的消息/附件恢复路径。父会话本身也是冷子会话时，官方 generic lookup 的 agent-busy 归属限制仍保留，不能把它伪装成普通根 Agent；该层级的 owner 恢复另需适配。
- Host 版 dsh-api-remotes 的直接类型导入会把 Host sessions 声明并入本包 Client 的 Context 类型，导致 SessionStore 与 Client session API 冲突；已移除该导入，改为读取实际服务的窄接口。没有修改官方类型声明或 Client 会话能力来消除报错。
- 9 项准备逻辑测试通过（/tmp/amiba-parent-recovery-tests2.log），覆盖真实身份传递、已驻留父复用、一次性/未知版本/祖先描述符跳过、普通新会话、存储错误、缺失 lookup、自指父身份及归属拒绝。Shell 类型检查通过（/tmp/amiba-parent-recovery-types2.log）。冷重启探针移除测试端 agents.resume，改为要求原生发送流程独立恢复父会话并续聊。
- 完整 Desktop 构建通过（/tmp/amiba-parent-recovery-build.log）；最终组合桌面回归 /tmp/amiba-parent-recovery-smoke.log 退出 0。真实 Host PID 更换并刷新 renderer 后，测试未调用 agents.resume，也未创建父/子会话；原输入框发送触发生产 prepareSubmit 自动恢复普通根父会话，子会话返回真实新回复。一次性子会话恢复、原有命令/图片/输入/轨迹/Cordis/文件/配置/插件生命周期均通过，UI 结构和样式未改。


### 嵌套子会话的驻留条件与草稿保留（2026-09-13）

- 核对实际 rc.2 dsh-subagent 的公共声明：followup 把冷恢复与一条新用户消息的 FIFO 投递合并；startContinuable 是建立新子会话，interrupt 不恢复冷实例，没有独立的无消息恢复入口。内部 continuation.coldResume/materialize 不是公开服务契约。不能为了自动唤醒嵌套父会话而注入额外用户消息，或用 generic Agent lookup 绕过归属。
- 新增 --child-nested-restart：在真实子 Agent 执行期间通过官方 startContinuable 建立真实孙会话，使用独立测试模型回复，再更换第二个真实 Host PID并刷新 renderer。孙会话的历史及目录来自持久化数据；初次发送因其直接父也为冷子会话而拒绝，原输入框中的 COMPAT_NESTED_FOLLOWUP 完整保留，未生成孙会话回复。
- 测试通过原输入框向父会话发送明确的新请求，测试模型模拟一个仍在运行的父任务。此时父会话确实驻留；返回孙会话，直接发送保留的草稿即可得到真实 COMPAT_NESTED_REPLY COMPAT_NESTED_FOLLOWUP。最后通过原停止按钮中止父任务，完成插件卸载检查。没有测试端直接恢复父/孙 Agent。
- 首轮 /tmp/amiba-nested-cold-smoke.log 暴露测试误以为已完成的子会话仍驻留：ctx.agents.get 返回 undefined。实际 continuation 的 settlement watcher 会在 Agent 空闲且无存活子实例时释放它。测试已改为在 Agent stream 执行期间创建孙会话、在父请求仍运行时重试孙会话，不再把历史可读或刚完成请求等同于驻留。
- 最终 /tmp/amiba-nested-cold-smoke2.log 退出 0，包含原有完整兼容回归及两次真实 Host 冷重启。只扩展测试与边界说明，复用已验证的生产构建；不宣称当前已具备无消息自动恢复冷嵌套父会话的能力。


### 发送时保留普通文本与真实引用的节点区别（2026-09-13）

- 原发送链把 Lexical 树先压成 token 字符串，再 parseTokens。因此用户实际输入的 `@[dsh.reference:...]` 示例文本也可能触发不存在的插件引用解析；这会阻断发送或替换原本的普通文本，不符合官方输入中的 occurrence 身份语义。
- 新增 $readComposerParts，从真实节点树读取 text/mention 分段，保留段落分隔和真实引用 payload。payload 是独立副本，调用者修改快照不会修改编辑器。RichComposerHandle 增加可选 getParts，保留原 getValue 和旧调用方式。
- Composer 在提交开始时捕获与本次 draft 一致的分段快照，普通发送仅对其中真实 mention 调用原解析器；旧嵌入器没有该接口或提交的不是当前编辑器值时，仍沿用原 token 解析路径。命令仲裁、提交条件、原字符串协议和所有样式未改。
- 真实 Lexical 节点及完整 Composer 测试区分同样 token 文本的字面内容与真实引用，验证只有真实引用被解析、普通文本按原样提交。44 项编辑器、触发管线及解析测试通过（/tmp/amiba-structured-submit-tests.log），UI 类型检查通过（/tmp/amiba-structured-submit-types.log）。
- 该分段快照目前接到发送路径，尚未替代 version:1 的字符串草稿保存；跨重载保留字面 token 文本与引用的区别，以及离屏编辑共享同一分段状态仍需继续实现，不能据此宣称完整驻留输入完成。
- 完整 Desktop 构建通过（/tmp/amiba-structured-submit-build.log）。首轮桌面日志 /tmp/amiba-structured-submit-smoke.log 中，输入 token 文本打开了原 @ 候选菜单，Enter 被菜单处理，尚未触发发送；探针改用官方 composerInputs.submitInput 进入原普通发送路径，未改变键盘行为。最终 /tmp/amiba-structured-submit-smoke2.log 退出 0，真实模型适配器收到完全一致的 COMPAT_LITERAL_ 文本；同时通过所有既有兼容项、普通和嵌套子会话的真实 Host 冷重启验证。


### 混合草稿的结构化持久化（2026-09-13）

- 原 v1 只保存 token 字符串，无法区分用户输入的普通 token 文字和真正的引用节点。本轮改为 version:2 文档，分别保存 text / mention 片段及完整引用字段；读取 v1 时保留旧解释方式，读取 v2 时不从普通文字推断引用。格式错误或不支持的版本忽略，原串行保存、读取代次和异步编辑隔离继续保留。
- 原 ChatSurface、Composer 和 RichComposerEditor 共享按会话驻留的不可变文档。编辑器直接读取实际节点，字符串 onChange 回写不重复解析；旧字符串 setter 只解释变更区，保留未编辑的普通文字及引用身份。初始化、切换或磁盘恢复使用带标记的原异步 Lexical 更新，避免恢复更新反向覆盖其他会话。
- 相同 canonical 字符串也可能由不同节点组成。文档变化直接取消旧引用序列化，提交前再次检查实际节点；触发修订号也读取结构身份，使旧触发范围失效。新增测试覆盖引用变成同文普通文字、延迟 codec 完成后不发送旧结果，并确认随后能原样发送普通文字。
- 草稿文档/存储、真实 RichComposerEditor、触发管线及节点读取合计 55 项测试通过（/tmp/amiba-document-draft-tests5.log）；UI 类型检查通过（/tmp/amiba-document-draft-types3.log），完整 Desktop 构建通过（/tmp/amiba-document-draft-build2.log）。
- 真实 Desktop 探针使用官方触发源插入含中文、Emoji、分隔符和尾反斜杠的引用，再通过公开编辑接口追加形似引用的普通文字。切换会话和 renderer reload 后确认仅有一个真实 occurrence，原引用逐字段一致、普通文字保留，另一会话不出现上一会话草稿；旧修订号写入仍拒绝，显式清空仍有效。
- 最终组合回归 /tmp/amiba-document-draft-smoke.log 退出 0，包含动态 Cordis、轨迹正常配置启停、命令、图片、输入状态、真实子会话及嵌套子会话 Host 冷重启，以及插件开发生命周期。已查看 amiba-resident-reference-draft.png，原输入框和引用样式保持；四个输入扩展区域卸载后的原编辑器、卡片尺寸及样式检查通过。
- 本轮不等于完整 useInput 实现：未挂载输入器的公开 inputActions、图片驻留、队列编辑/恢复和完整 phase 状态仍需适配。v2 不持久化公开 occurrenceId；发送准备失败后的草稿恢复仍使用原字符串链路，需另行统一结构化恢复语义。


### 原生队列与发送准备失败的结构化草稿恢复（2026-09-13）

- 原队列仅保留已展开的模型文本，编辑时引用身份丢失；编辑后经 Send 发送时，sendNow 又忽略 Composer 传入的已解析文本。本轮在原 PendingChatTurn / RunChatTurnArgs 增加可选原始文档，与 text 模型负载分开保存。旧条目没有文档时沿用旧行为，未替换队列 UI 或存储键。
- 正常发送、排队、自动出队及立即发送携带原始文档。编辑队列项恢复其实际 text / mention 节点；被暂存的输入草稿也保留节点元数据。编辑后的 Send 使用本次解析结果；点击队列的“立即发送”复用原 Composer 的准入、命令及引用解析链路，解析前不会清空、移除队列项或抢先中断当前生成。
- 发送准备失败和只读拒绝优先恢复原始文档；首次发送的工作目录失败按实际会话 ID 恢复文档。旧无文档调用仍保留字符串回退。会话交接继续传递同一 RunChatTurnArgs，不把结构化元数据发送给模型。
- 相关队列、触发管线和草稿存储 50 项测试通过（/tmp/amiba-queue-draft-tests.log），包括 JSON 边界、编辑恢复、编辑后解析文本传递、立即发送未准入时保留状态及出队恢复元数据。UI 类型检查和完整 Desktop 构建通过（/tmp/amiba-queue-draft-types.log、/tmp/amiba-queue-draft-build.log）。
- --queue-draft 桌面探针在真实可续聊子会话生成过程中排队混合草稿，直接读取实际 StorageAdapter 落盘条目，确认模型文本与一个真实引用及普通 token 文字分开保存。通过原队列 Edit / Send now 按钮恢复和编辑；codec 调用从 1 次增至 2 次，真实模型收到准确的新文本，队列项消失，旧生成被中断。
- 实际 Host 冷重启后的嵌套父会话拒绝场景验证：首次 codec 已执行，但发送准备失败后恢复原引用及普通文字；切换至父会话实际运行后返回，原草稿仍在；重试再次执行 codec，模型实际收到完整预期文本。没有投递虚构唤醒消息。
- 最终组合回归 /tmp/amiba-queue-draft-smoke3.log 退出 0，覆盖驻留草稿、动态 Cordis、轨迹正常启停、命令、图片、输入状态、子会话及嵌套 Host 冷重启和插件开发生命周期。首轮探针定位错误地查找输入卡片内的队列（原队列位于 context rail），第二轮用 Markdown 展示文本断言模型原文；修正为原队列位置及实际模型输入证据后通过，未为测试改动产品样式。
- 尚不声明完整官方队列兼容：原生待发送队列与官方 Host inbox 仍是不同状态来源，队列图片生命周期、离屏完整输入和尚未经过 Composer 解析就被编辑动作暂存的草稿发送语义需继续统一。本轮没有完整刷新恢复排队条目的桌面测试；已验证真实落盘及 JSON 恢复后的编辑，不能替代全部恢复生命周期证据。


### 整页刷新后的排队草稿恢复与立即发送（2026-09-13）

- 新增 --queue-reload 探针：真实可续聊子会话仍在生成时，保存含一个真实引用及普通 token 文字的排队消息，然后完整 Page.reload。通过官方目录重新定位原子会话，确认只有一条队列记录、已清空的输入框仍为空；重新注册同名测试引用源后编辑该条目，确认引用和普通文字都正确恢复。
- 首轮真实验证发现运行状态缺口：Host 中旧生成仍在等待，刷新后的原输入器却没有本地 busy 状态。原 sendNow 以 busy 为中断前提，导致新内容进入 Host 队列等待旧任务，而非立即抢先执行。诊断日志明确显示 stopVisible:false、queueRows:1；Host 未收到旧生成的中断。
- 原队列“立即发送”现在对有真实 sessionId 的会话始终发出原 client.abort 操作，由官方接口对已空闲会话处理无操作；本地停止标记、拒绝旧 pendingTurn 和 finally 防重仍只在本地 busy 时执行。只读、未准入及引用解析未完成的路径不触发中断；没有修改普通发送、停止按钮或任何 UI/CSS。
- 新增回归在修复前失败（/tmp/amiba-queue-reload-before.log：1 失败、11 通过），修复后队列及触发管线共 43 项通过（/tmp/amiba-queue-reload-tests.log）。UI 类型检查、完整 Desktop 构建通过（/tmp/amiba-queue-reload-types.log、/tmp/amiba-queue-reload-build.log）。
- 最终组合桌面验证 /tmp/amiba-queue-reload-smoke2.log 退出 0。刷新后编辑原条目、再次解析引用并点击原 Send now，真实 Host 旧生成被中断，模型收到准确的新文本，队列清空。驻留草稿、动态 Cordis、轨迹正常配置启停、命令、图片、输入状态、子会话及嵌套 Host 冷重启和插件开发生命周期一并通过。
- 本项补上上一轮缺少的实际 renderer 重载证据。尚未补齐刷新后执行中会话的全部状态：DshChatEngine 的新实例仅在观察到 turn 事件后建立被动运行态，subscribe 初始缺少状态时发出 absent；普通输入器 busy/Stop 的恢复仍需接入权威状态基线，不能把本次队列修正当成这项工作已完成。


### 官方会话运行状态的原生快照桥接（2026-09-13）

- 已有 conversationSource 返回真实 rc.2 SessionFace，其 ConversationSnapshot.running 由官方运行状态维护。ProductShell 将该现有来源提供给 DshChatEngineClient，不创建第二套 ConversationController，也不重新实现 Host 状态查询。
- 原生快照增加可选 hostRunning。当前 renderer 不拥有本地 turn controller 时读入官方 running；本地提交仍由本地 controller 保护，迟到的 idle 基线不能清空正在提交的任务。来源按会话隔离，重复布尔值不重复发快照；替换、clear 和 dispose 释放订阅，销毁后的回调忽略。
- ChatSurface 的原 busy/Stop 使用该快照字段；只有活动状态、没有本地 turn 内容时仍发 absent，不虚构 begin 或助手占位消息。原 SurfaceActivity 同时恢复 thinking/idle，用户问题与审批继续拥有 waiting 优先级，恢复标记仍保留。
- 原生聊天客户端 23 项、UI 活动/队列/触发管线 50 项，共 73 项测试通过（/tmp/amiba-running-baseline-tests2.log、/tmp/amiba-running-baseline-ui-tests.log）。Runtime、Shell 和 UI 类型检查通过；完整 Desktop 构建通过（/tmp/amiba-running-baseline-build.log）。
- 最终组合桌面回归 /tmp/amiba-running-baseline-smoke.log 退出 0。整页刷新时真实子会话仍在生成，恢复原 Stop 控件、空输入框和唯一队列项；点击原 Stop 后真实 Host 记录中断，队列保留；同一输入框可继续启动任务，排队草稿编辑和重新解析发送通过。动态 Cordis、轨迹配置、命令、图片、输入状态、子会话及嵌套 Host 冷重启、插件开发生命周期同时通过，未修改 JSX 结构或 CSS。
- 仍有需追查的观测：恢复后的 Stop / 新一轮提交已分别满足按钮出现条件，但之后编辑队列前的诊断仍记录 stopVisible:false。当前测试未在该点同步读取官方 running 与本地事件序列，不能据此确定具体竞态原因，也不能据整体退出 0 宣称所有再启动状态已完善。下一步须对照新一轮 Host 真实开始、官方 running 和原生终止事件，排除旧事件覆盖新一轮状态。
- 本桥接面向拥有官方 SessionFace 的 ProductShell；无该来源的独立客户端仍维持既有快照行为。中途刷新后的全部流内容恢复、完整官方 useInput/队列/图片状态继续单独核对。


### 再启动后的按钮模式核对（2026-09-13）

- 对上一轮 stopVisible:false 的观测增加同步证据：重启前记录真实模型开始次数；提交后等待 Host 中出现新的 COMPAT_WAIT_FOR_STOP 执行，再同时等待官方 SessionFace.running=true 和原 Stop 控件。
- 编辑队列项后同时读取官方 running、Stop 控件和原 Queue 控件。实际记录为 running:true、stopVisible:false、queueVisible:true。源码明确规定 busy + 空输入显示 Stop，busy + 可提交输入显示 Queue；因此该观测是保留的原有交互，不是旧终止事件覆盖新运行状态的证据。
- 新增严格断言已通过最终组合桌面回归 /tmp/amiba-running-mode-smoke.log（退出 0），包括真实停止、重启、排队草稿、再次解析、Host 冷重启、插件及既有兼容检查。未修改任何生产代码、UI 或样式，复用 f9a8c9a 的已验证构建。
- 撤销上一轮待查的这条疑似竞态；不将此结果扩展为所有断线/流内容恢复已经验证。后续继续核对完整输入、离屏操作、图片与官方队列生命周期。


### 可见草稿的共用编辑规则（2026-09-13）

- 从真实 Lexical 的 $setInputDraft 提取 atomicTextEdit，沿用 UTF-16 最小差异和完整原子边界扩展。现有编辑器仍用原坐标映射及 $spliceTriggerText；没有替换编辑器、引用样式或交互。段落分隔等结构原子仍由现有扫描器提供。
- 原生结构化文档增加可见文本投影与 updatePublicDraftDocument：有效官方引用投影为完整 @label，其他原生 mention 保留原 token 表达；编辑引用内部只解散被编辑的引用，新增文字始终保持普通文字，未修改的引用字段完整保留。与此前 legacy token setter 分开，保留旧原生调用的含义。
- ComposerDraftSource 新增内部 setDisplayText，使用该文档编辑并沿用修订隔离和串行存储。明确空草稿仍取消待完成恢复；普通 token 文字不会因保存/恢复而变成真实引用。此方法尚未接到官方离屏 inputActions，不声明公开入口已经可用。
- 新增 11 个逐例对照测试：同一结构化草稿分别经真实 Lexical public edit 和驻留文档 public edit，核对实际 text/mention 节点及最终可见文本完全一致；涵盖原样、前后追加、中文/Emoji 引用内部修改、跨引用替换、换行、删除、新增 token 文字及清空。另验证公开文档编辑的保存/恢复和引用解散。相关测试共 93 项通过（/tmp/amiba-public-document-tests.log），UI 类型检查通过（/tmp/amiba-public-document-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-public-document-build.log），最终组合回归 /tmp/amiba-public-document-smoke.log 退出 0，含现有公开输入、驻留引用、队列与整页刷新、运行状态、命令/图片、动态插件、轨迹及子会话冷重启。未修改样式或 JSX 结构。
- 后续仍需将驻留文档接到标准会话提供者，并统一离屏快照、公开修订号/occurrence 身份、phase、图片和官方队列；本项仅完成其可复用的文字/引用转换，不代表完整 useInput 兼容。


### 标准 inputActions 的离屏草稿写入（2026-09-13）

- Shell 通过 UI 根模块导出的 sessionComposerDraft 使用原输入器同一驻留文档。真实会话提供者持有和释放订阅；标准 inputActions.setDraft 在原编辑器离屏时按会话 ID 写入该文档，沿用前一轮可见文本编辑规则与串行保存。未绑定会话拒绝写入，旧提供者释放不会解除新提供者的所有权。
- 已挂载输入器始终走原编辑器操作，阶段或只读拒绝不能绕过；离屏的一次性子会话按真实 SessionFace 的 one-shot 地址拒绝。没有替换编辑器、JSX 或 CSS。
- 输入状态来源、触发桥与动作提供者共 37 项测试通过（/tmp/amiba-offscreen-input-tests3.log）；Shell 和 UI 类型检查通过（/tmp/amiba-offscreen-input-types2.log、/tmp/amiba-offscreen-input-ui-types.log）。完整 Desktop 构建通过（/tmp/amiba-offscreen-input-build.log）。
- 最终组合桌面回归 /tmp/amiba-offscreen-input-smoke.log 退出 0。探针保存官方 sessions.provide 的真实 inputActions，切换到另一会话后调用原会话 setDraft；当前输入框保持为空，切回及整页刷新后，原真实引用及新增普通文字完整保留。实际一次性子会话离屏后的标准写入也明确拒绝。原队列、刷新恢复、运行状态、命令与图片、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件生命周期一并通过。
- 范围限定：此次验证已有绑定、先前打开过的会话的离屏写入，不声明首次异步恢复前的同步写入已覆盖全部恢复情况。完整 useInput、离屏公开快照、严格修订号与 occurrence 身份、离屏图片和提交、完整官方队列仍待适配；不会生成虚假的离屏修订号或绕过原提交准入。

### 编辑时暂存的草稿在真实自动出队前解析（2026-09-13）

- 发现两个实际缺口：Edit 将输入框原草稿放入队尾时尚未执行引用 codec；ChatSurface 的 runChatTurn.finally 仍保留独立旧出队逻辑，绕过 usePendingQueue.drainHead 且未传递原始 draft。此前队列模块测试不能证明真实自动出队已接通，本轮补上该调用链。
- 新暂存的结构化草稿使用可持久化 needsResolution 标记。直接 Send now 和自动出队先调用原 Composer 的 expandMentionPartsAsync、providerRegistry 和真实 trigger resolver；普通文字不重新解析为引用。此前已提交并解析的队列项继续使用原模型文本，不重复执行 codec。
- 异步解析完成前不移除条目、不抢先中断旧生成、不更改当前输入框。失败或解析为空且没有附件时保留条目、暂停队列并使用原错误区域提示。停止、删除、编辑、切换会话、只读变化和卸载取消待完成解析；迟到结果检查原条目身份及会话所有权。
- 真实 finally 现调用当前会话的队列 drain，携带原始文档，避免旧会话结束触发新会话出队。同步消费 queue ref 避免渲染前连续 drain 重复发送同一条。新增回归先失败（/tmp/amiba-stashed-queue-drain-before.log：1 失败、19 通过），最终队列及 Composer 触发管线共 52 项通过（/tmp/amiba-stashed-queue-tests5.log）。UI 类型检查通过（/tmp/amiba-stashed-queue-types4.log）。
- 最终完整 Desktop 构建通过（/tmp/amiba-stashed-queue-build3.log）。新增 --queue-stash 使用真实引用源和普通 token 文字，点击原 Edit 暂存未提交草稿，再发送编辑项并等待原自动出队。实际模型日志逐字匹配 codec 输出和普通文字，调用次数准确。首轮探针同时添加前后缀，按原最小差异规则解散了引用；改为两次独立编辑后通过，未改变产品编辑规则。
- 最终组合回归 /tmp/amiba-stashed-queue-smoke2.log 退出 0，覆盖离屏草稿、排队及刷新恢复、运行状态、命令/图片、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件安装/HMR/卸载。原编辑器与卡片尺寸、样式检查继续通过，无 JSX 或 CSS 变更。
- JSON 测试覆盖新暂存标记持久化，桌面验证覆盖真实暂存后的自动出队；不将旧版本无标记记录猜测为待解析草稿。队列图片所有权及清理、完整 Host inbox 对齐、完整离屏输入和官方 useInput 仍需适配，不代表全部队列兼容。

### 队列和输入框共享附件的文件清理（2026-09-13）

- 实际问题：Edit 复制 Attachment 对象但共享 attachmentId。原 cancelEdit、图片移除、会话切换直接调用文件删除，会破坏仍留在队列中的原文件；删除编辑项又可能对同一文件重复删除。
- 增加 deleteUnretainedAttachments，按 Host staging ID 核对保留的队列与输入框附件，并对一次清理去重。取消编辑保留队列原附件、释放新添附件；删除行保留其他行及未清空输入框的文件；提交编辑后的附件列表释放弃用的旧文件，保留本次发送使用的文件。
- 原 useComposerAttachments 增加可选队列所有权查询，图片移除及清空仍更新原 UI 和浏览器注册，仅在队列没有持有同一文件时删除 Host 文件。无队列的调用方保持原行为。ChatSurface 的切换会话、新建会话及错误清理分别保留仍被队列或输入框持有的附件。没有改动 JSX 或 CSS。
- 队列、附件所有权和真实 Composer 触发管线共 59 项测试通过（/tmp/amiba-queue-files-tests2.log）；UI 类型检查通过（/tmp/amiba-queue-files-types2.log）。完整 Desktop 构建通过（/tmp/amiba-queue-files-build.log）。
- 新增 --queue-files：真实上传 PNG、排队、读取实际存储记录中的 attachmentId，定位对应 Host 原始文件；经取消编辑、移除图片及切换会话后逐字节比较，删除最后一条队列记录后确认 ENOENT。首轮只上传图片而等待带文字的排队按钮超时，按现有交互补入文字后通过，没有为探针更改按钮规则。
- 最终组合桌面回归 /tmp/amiba-queue-files-smoke2.log 退出 0，同时覆盖离屏草稿、引用队列与自动出队、刷新恢复、运行状态、命令及官方图片操作、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件安装/HMR/卸载。原编辑器、卡片尺寸及样式检查继续通过。
- 本项验证队列与输入框的文件所有权，不代表完整官方图片生命周期：浏览器 File/草稿图片 ID 在队列恢复时的重建、发送中所有权和完整 Host inbox 对齐仍需核对。测试仅暂存并删除子会话队列图片，没有发送图片至子会话，不改变 rc.2 子会话图片输入限制。

### 队列图片恢复后的浏览器注册（2026-09-13）

- 队列序列化保存 Attachment 和 Host staging ID，原上传时的浏览器 File 注册在清空输入框后释放。此前编辑恢复只显示原生缩略图，官方 inputImagesFor 仍为空。本轮在原 useComposerAttachments 中为缺少注册的就绪图片读取同一 Host 文件，重建 File 并调用原 registerDraftImage。
- 新草稿 ID 来自真实官方注册，不复用 Host staging ID；不重新上传文件。原生上传已有注册时不重复读取或注册。发布继续使用原同步图片快照和订阅，取消编辑、移除及卸载沿用原 release。
- 恢复按 native uiId、Host ID、注册提供者及当前附件集合检查所有权，迟到读取不重新添加已移除的图片。同一 native 行指向新 Host 文件时先释放旧注册，避免展示旧文件。身份不匹配或注册不可用时保留原生附件，不发布虚假图片；失败记录不在每次渲染时无限重试。
- 会话切换现在同时清空原 editingQueueId，避免把已离开的队列编辑状态带到另一个会话。该修正不改变输入框结构、原按钮样式或附件上传流程。
- 图片恢复、附件所有权、队列及 Composer 触发管线共 65 项测试通过（/tmp/amiba-queue-image-restore-tests3.log），覆盖准确字节、新 ID、无二次上传、快照稳定、清理、迟到读取、提供者/Host ID 更换及无效身份。UI 类型检查通过（/tmp/amiba-queue-image-restore-types4.log）；完整 Desktop 构建通过（/tmp/amiba-queue-image-restore-build.log）。
- --queue-files 增强验证真实 inputImagesFor 返回的 File、名称、MIME、完整字节、官方 registry 查找和 ID 与 Host ID 不同。新增 --queue-image-reload 完整刷新 renderer，从真实持久化队列重新编辑图片并执行同样检查，最后删除原行并确认浏览器注册和原文件均释放。另确认离开编辑中的会话后新会话不残留 Cancel edit。
- 最终组合桌面回归 /tmp/amiba-queue-image-restore-smoke.log 退出 0，含原有动态插件、输入/图片/命令、离屏引用、队列解析及刷新、运行状态、轨迹、子会话及嵌套 Host 冷重启和插件开发生命周期。原编辑器、卡片尺寸及样式检查通过。
- 本项重建 File 和新的浏览器 ID，不宣称持久化原 File 对象身份、原 lastModified 或跨 renderer 的浏览器 ID。发送中所有权、离屏图片操作和完整官方输入/Host inbox 状态仍需继续适配。子会话图片测试仍限于队列暂存、编辑和删除，不宣称 rc.2 支持子会话图片发送。

### 当前窗口发送期间的附件保留（2026-09-13）

- 原队列和输入框保留检查无法覆盖已离开草稿、仍等待发送准备的附件。原 runChatTurn 在会话交接、Agent/工作目录准备及实际发送前存在异步等待，此时删除共享队列副本可能提前删除正在使用的文件。
- 增加 withSendingAttachments，按 Host ID 对当前 renderer 中重叠的发送分别计数。原 runChatTurn 在进入既有发送函数前取得临时保留，覆盖早退、准备错误、交接和完整执行，在 finally 释放。没有改变原发送正文、附件身份或提交接口。
- deleteUnretainedAttachments 同时检查发送保留；原图片移除与清空也使用这项检查。发送结束只解除临时保留，不自动删除可能已进入历史或已恢复到草稿的文件；仍由原清理动作决定删除。
- 原生图片注册、图片恢复、附件所有权、队列和 Composer 触发管线共 79 项测试通过（/tmp/amiba-sending-files-tests2.log），包括受控等待期间删除队列副本和原图片、重叠发送、同一发送内重复 ID、准备拒绝后的释放及无自动删除。UI 类型检查通过（/tmp/amiba-sending-files-types2.log）。
- 完整 Desktop 构建通过（/tmp/amiba-sending-files-build.log）；组合桌面回归 /tmp/amiba-sending-files-smoke.log 退出 0，覆盖原有图片注册/恢复/清理、队列发送、刷新、离屏草稿、命令、动态插件、轨迹及子会话冷重启。未修改 JSX 或 CSS，原卡片尺寸及样式检查通过。受控暂停发送期间的竞争条件由上述 hook 测试验证，未把现有桌面组合探针宣称为该竞争条件的专用端到端验证。
- 本保留表仅属于当前 renderer，不是 Host 的持久化引用表。跨窗口同时操作、已发送历史中的长期文件引用、跨重启所有权仍需由 Host 层继续核对；完整官方图片及输入生命周期尚未全部完成。

### Host 持久化附件会话引用（2026-09-13）

- 确认原 Host removeAttachment 直接删除对象及元数据，无法识别另一窗口或会话已经引用该文件。本轮在原元数据增加可选 retainedBy，会话引用使用原文件 ID，不复制文件或改动消息展示。
- 新 retainForSession 原子替换元数据，对重复会话幂等；同一 Store 的同一文件按顺序处理引用登记与删除，登记成功后普通 remove 返回 deleted:false。元数据校验检查引用字段，未登记文件保持原删除流程。重新创建 Store 后仍读取持久化引用。
- 增加同名 Typert Remote 描述与 Host 方法，原桌面及通用 DSH 平台适配器调用该接口。AgentAttachmentsAdapter 使用可选方法维持其他宿主兼容；实际 Amiba 适配器提供它。原 DshChatEngine 在只读地址检查后、会话解析/创建和附件读取之前等待引用登记，涵盖图片及文本/PDF附件 ID，重复 ID 只登记一次。
- 存储 5 项测试通过（/tmp/amiba-host-file-refs-tests2.log），含多会话幂等引用、重建 Store 后保留原字节、登记与删除并发排序和普通草稿删除。运行时 32 项通过（/tmp/amiba-host-file-refs-runtime-tests3.log），其中真实引擎测试延迟登记回包，确认完成前既不读取图片也不调用 prompt。Runtime、附件插件及 Desktop 主进程类型检查通过（/tmp/amiba-host-file-refs-types.log、/tmp/amiba-host-file-refs-plugin-types.log、/tmp/amiba-host-file-refs-desktop-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-host-file-refs-build.log）。新增 --host-file-refs 使用原 Electron DSH HTTP 通道调用真实 put、retainForSession、removeAttachment、readForPrompt，确认删除返回 false 且完整字节仍可读取。首轮误把该原生 HTTP 服务声明为 Client Cordis 服务 remote.amibaAttachments，导致探针等待不存在的服务；修正为实际原生通道后通过，未添加虚构客户端服务。
- 最终组合回归 /tmp/amiba-host-file-refs-smoke2.log 退出 0，同时通过未登记队列图片最终清理、浏览器注册恢复、整页刷新、输入与命令、动态插件、轨迹、子会话及嵌套 Host 冷重启等原回归。Store 重建后的引用持久性由存储测试验证，不把组合中的 Host 冷重启等同于已专门复查该新增引用。
- 范围：新登记引用在模型执行前写入，提交失败也保留文件，以免损坏已记录或可重试内容。当前没有旧历史迁移或 release-session 回收流程，尚不能声明长期存储生命周期完整。引擎收到提交前的 UI 准备阶段仍只有当前窗口临时保留；多 Host 进程同时写同一目录不在本轮验证范围。没有 JSX/CSS 改动。

### 打开旧历史时补登记附件引用（2026-09-13）

- loadMessages 已分页读取完整日志并通过既有 projectRuntimeSessionHistory 生成 attachmentBadges。本轮复用该结构化结果，仅对符合真实 Host att_32位十六进制格式的 ID 去重登记引用；不按文件名、缩略图、裸文本 ID 或内联图片 hash 推测归属。
- 登记完成后返回原历史消息，消息正文、显示顺序和附件标记不变。历史文件可能已缺失，逐项登记失败只记录诊断，不阻止查看历史；无该可选平台接口的宿主保留原行为。
- Host 提取公共元数据校验，retain 和 remove 检查 ID、对象类型/大小及引用字段时不读取完整文件字节。实际 read 仍读取字节并核对长度；原有符号链接与路径限制保持。避免重复打开旧历史时为幂等登记加载大图片。
- 历史存储与投影共 24 项测试通过（/tmp/amiba-legacy-file-refs-tests.log），覆盖跨页去重、非 Host ID 排除、普通文字排除、缺失文件和原历史保留；Host 存储 5 项通过（/tmp/amiba-legacy-file-refs-store-tests.log）。Runtime 和附件插件类型检查通过（/tmp/amiba-legacy-file-refs-types.log、/tmp/amiba-legacy-file-refs-plugin-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-legacy-file-refs-build.log）。新增 --legacy-file-refs 使用真实 Host 创建未登记文件，检查原元数据没有 retainedBy；测试 Host 插件直接写入旧格式的规范历史事件，不经过新发送逻辑。刷新 renderer 后打开该历史，检查元数据新增原会话 ID，再请求删除并逐字节读取验证文件保留。
- 最终组合回归 /tmp/amiba-legacy-file-refs-smoke.log 退出 0，包含该迁移、原 Host 引用、队列/图片恢复及清理、输入/命令、动态插件、轨迹、子会话及嵌套 Host 冷重启。无 JSX/CSS 改动，原界面检查继续通过。
- 回收边界核对：当前 Amiba 的移出列表操作是 workspace.archiveSession；sessions-store 明确保留日志且归档视图仍可打开。因此不把归档接为 release-session，也不在兼容任务中新增永久删除能力。按需迁移不等于全库扫描，未打开旧会话的引用尚未预登记；其他窗口在引擎收到提交前的准备阶段仍需继续核对。


### 标准 useInput 与驻留输入快照（2026-09-13）

- 根据实际 rc.2 的 sessions.provide 契约注册 `hooks: ["input"]`，由官方渲染器生成 selector Hook；保留原输入器和 inputActions。
- 原生 ComposerDraftSource 增加只读输入投影：实际文字/引用使用完整 @label 的 UTF-16 坐标，普通 token 形状文字不被重新解释。持久化恢复和外部修改通过原订阅通知；连续修改即使没有中间读取，也会推进修订。未改动引用在驻留文本编辑中保留独立 ID。
- 挂载时继续使用真实 Lexical 状态、命令阶段、浏览器图片和 SessionFace 的 Host inbox；离屏时使用原生驻留草稿，遵循已有的退出命令和清空浏览器图片策略。离屏修订写入拒绝过期版本和一次性只读子会话。
- 保留 `inputDraftFor` 的原有“已挂载编辑器”含义。第一次桌面回归发现把该接口改成离屏可读会使既有就绪检查提前通过，已恢复旧语义；新增驻留读取经 `inputDraftSource`、`inputStateSource` 和标准 useInput 提供。编辑器重绑定会推进修订并重分配公共 occurrence ID，避免旧写入命中新绑定。
- 验证：40 项桥接测试、64 项原生草稿/真实 Lexical 编辑测试通过，补充验证异步恢复后的输入投影及迟到读取隔离；插件类型检查和完整桌面构建通过。桌面插件视图直接调用 useInput，四个输入区域同时比较标准 Hook 与真实 owner 状态；离屏写入、订阅、过期拒绝、切换/刷新以及原卡片样式尺寸均通过。
- 范围仍未全部完成：离屏图片修改和提交、跨挂载公共引用 ID 连续性、引用外观/失效/粘贴语义、原生队列与 Host inbox 的完整行为对齐仍需继续处理。

验证记录：`/tmp/amiba-resident-input-tests.log`、`/tmp/amiba-resident-input-ui-tests.log`、`/tmp/amiba-resident-input-hydration-tests.log`、`/tmp/amiba-resident-input-ui-types.log`、`/tmp/amiba-resident-input-build2.log`、`/tmp/amiba-resident-input-smoke3.log`。完整组合桌面回归退出码为 0，包含队列/图片刷新、Host 附件引用、旧历史附件迁移、Cordis、轨迹加载、命令展示、running 恢复及两级子会话冷重启。


### 离屏官方图片操作与原生交接（2026-09-13）

- 已绑定的离屏会话可通过标准 inputActions.addImages/removeImage/pruneImages 操作真实浏览器图片。整批 ID 校验成功后才取得注册表引用；保留原始 File、图片 ID 和预览地址，不把 Host 文件 ID 冒充浏览器 ID。
- 仅显式离屏新增图片驻留；原生上传附件仍遵循已有的会话切换/卸载清理。回到目标会话后，在父级切换清理完成的 microtask 中，且原编辑器允许接收时，交给原 addDraftImages 上传路径。上传结束、只读等可用性变化有独立通知，不依赖图片列表发生变化才能重试交接。
- 挂载编辑器拒绝接收时不另建驻留副本。过期绑定不能接管图片；未交接图片在实际 Session owner 解绑时释放。共享图片按现有租约计数，交接不重新创建 File，不释放已交给原生上传器的租约。
- 41 项桥接测试、39 项真实 Composer/命令图片测试、插件及 UI 类型检查、完整桌面构建通过。新增 --offscreen-images 桌面验证标准接口的添加/移除/裁剪、其他会话隔离、原附件条接管、原命令路径的确切 PNG 字节和最终注册释放；完整组合回归退出码为 0，原输入卡片样式尺寸及队列、附件引用、Cordis、轨迹、子会话冷恢复均通过。
- 日志：/tmp/amiba-offscreen-images-tests.log、/tmp/amiba-offscreen-images-ui-tests.log、/tmp/amiba-offscreen-images-types.log、/tmp/amiba-offscreen-images-ui-types.log、/tmp/amiba-offscreen-images-build.log、/tmp/amiba-offscreen-images-smoke.log。
- 边界：驻留的是本次浏览器运行中的图片注册，不跨浏览器重启持久化；离屏直接提交仍未接入。完整输入、引用和新版插槽/服务兼容目标继续保留。


### 离屏提交的引擎接收确认（2026-09-13）

原 ChatEngineClient.submit 返回 void，begin 又发生在准备和 Host 请求之前，不能作为离屏清空草稿的依据。本轮给真实 DshChatEngineClient 增加可选 submitWithReceipt，保留旧 submit 事件入口，共用实际准备、模型选择、附件引用/读取、事件订阅和 prompt 路径。

- accepted 来自实际 session.prompt 的 accepted 标志，或 subagent.prompt 的非空 messageId；Host 命令的 success/error 结果独立保留，不等同于模型任务完成。
- 准备前失败和明确 RPC 拒绝返回 rejected；请求发出后网络错误、取消或无效确认返回 unconfirmed，不能据此认定没有投递。回执只结算一次；后续流结束或中断不改写已经确认的接收结果。
- 新接口的重复提交拒绝只返回给该调用方，不发送会结束原回合的错误事件。引擎销毁会结算待确认请求，销毁后不再启动新提交。准备期间取消后，即使不响应 AbortSignal 的适配器随后返回，也不会继续发出 prompt。
- 36 项引擎测试通过，包括原发送路径、确认前等待、命令结果、两路子会话独立确认、重复提交、明确 RPC/不确定网络结果、异步准备取消、同步 begin 回调取消，以及确认失败不等待延迟的连接清理。运行时类型检查通过。
- 尚未将标准 inputActions.submit 接到离屏发送。原 ChatSurface.runChatTurn 同时依赖当前会话的工作目录、消息、检查点和交接闭包；后续必须使这些步骤按目标会话执行，并衔接驻留草稿/图片/命令事务。不能用直接调用 session.prompt、切换用户当前页面或创建另一套隐藏 ChatSurface 代替。

验证记录：/tmp/amiba-submission-receipt-tests.log、/tmp/amiba-submission-receipt-types.log、/tmp/amiba-submission-receipt-build.log、/tmp/amiba-submission-receipt-smoke.log。完整桌面构建及包含离屏图片、队列恢复、附件引用、Cordis、轨迹和子会话冷恢复的组合回归均通过，退出码 0；桌面回归验证原 submit 路径，新增接收确认的分支语义由引擎测试覆盖，尚未声称离屏标准提交已完成。


### 目标会话的检查点与原生文件搜索（2026-09-13）

- WorkspacePane 增加 beginTurnFor(sessionId, turnIndex)，直接调用该目标的原开发能力，并更新其检查点集合和活动检查点。旧 beginTurn(turnIndex) 委托到当前会话，原 UI 调用及默认行为保留；后台工具事件仍由现有 observeToolEvent 按事件会话标记修改。
- 每个目标的检查点创建请求独立跟踪；较旧请求晚到的成功、失败或非 Git 空结果，不能覆盖或删除较新请求的活动检查点。实际创建的历史检查点仍保留，不删除文件或恢复点。
- 原生 workspace-files provider 允许直接传入固定 sessionId，ProductShell 按会话构建实例；保留的提供者不会因当前页面选择改变而改查另一个会话。旧 getSessionId 回调形式仍支持。这里改的是搜索地址绑定，原有文件引用序列化仍返回相同路径。
- 19 项 React 工作区/文件提供者/目录选择测试、UI 与插件类型检查通过。测试覆盖后台创建期间切换前台、后台修改标记、迟到请求和现有面板行为。既有文件树测试缺少目录选择上下文，在 HEAD 的原 WorkspacePane 上也复现同样失败（/tmp/amiba-addressed-preparation-baseline-test.log）；仅为该夹具补齐实际上下文，未改产品按钮逻辑。
- 完整桌面构建和组合回归通过，退出码 0；原卡片样式、附件/队列、离屏图片、Cordis、轨迹及子会话冷恢复继续通过。后台检查点接口由 React/适配器测试覆盖；此次未声称标准 inputActions.submit 已能离屏发送。
- 记录：/tmp/amiba-addressed-preparation-tests.log、/tmp/amiba-addressed-preparation-ui-types.log、/tmp/amiba-addressed-preparation-plugin-types.log、/tmp/amiba-addressed-preparation-build.log、/tmp/amiba-addressed-preparation-smoke.log。

后续仍须接通按目标会话准备消息/模型/工作目录的原引擎发送，并处理驻留草稿、命令、图片和接收结果的事务。已确认原生文件 serialize 只返回路径，搜索的会话地址现已固定；不得把当前会话的 pendingModelSelection、activeMessages 或工作区 UI 状态用于其他目标。Host 附件 ID 由 randomUUID 生成，不能假定重复上传会按内容去重；离屏图片发送还需要保存和交接已暂存附件，避免失败重试重复上传和遗留文件。
# 离屏附件准备与原输入器交接：桌面验证通过

## 后续：目标会话后台发送器

内部 `sendResidentTurn` 已绑定原 ChatSurface 的引擎，不新建隐藏输入器或切换页面。发送前调用官方会话准备并处理重定向；从真实 Host 读取目标元数据和历史，按目标地址解析目录、创建检查点、准备 Markdown，再调用 `submitWithReceipt`。准备锁覆盖源和重定向目标，准备期间转到前台、已有本地发送或 Host 实际运行会拒绝；子会话的一次性只读及图片限制继续保留。派发后的未知异常返回 unconfirmed，已接收后的本地索引失败不改变接收事实。SessionsController 暴露原 store.getSnapshot，异步检查读取实时状态，不依赖旧 React 闭包。

验证：后台发送器 5 项测试、桥接/驻留附件 8 项测试，UI、运行时及插件类型检查通过；完整构建和桌面兼容回归通过。新增 `--resident-sender` 对真实可续聊子会话执行后台文本发送，检查 accepted 回执、目标模型日志、前台原编辑器及草稿不变、返回后真实回复。首次测试未把新文本加入假模型的识别列表，误选了之前的等待停止输入；补齐夹具标记后完整重跑通过。证据为 `/tmp/amiba-resident-sender-tests.log`、`/tmp/amiba-resident-sender-bridge-tests.log`、`/tmp/amiba-resident-sender-{ui,plugin,runtime}-types.log`、`/tmp/amiba-resident-sender-build.log`、`/tmp/amiba-resident-sender-smoke2.log`。

边界：该内部接口接收已完成判定和引用展开的文本，不消费草稿。标准 `inputActions.submit` 的离屏命令判定、状态、草稿消费/失败保留、完整队列对齐仍待接通。后台图片发送尚无真实模型端实测，不能由子会话文本用例推断全部支持。

## 附件准备与交接记录

### 后续进展：标准离屏输入事务

#### 再后续：原生队列共享数据源

原 usePendingQueue 已改为订阅 sessionPendingQueue；同一存储适配器和会话共用唯一数据源，原队列组件、编辑/停止/发送逻辑、存储键与记录格式保留。初次加载前的乐观追加、移除以数据差异合并到已有记录，不重复执行包含副作用的 updater；写入串行，并提供 ready/flush 供后续离屏事务等待存储确认。存储通知按会话应用，迟到初次读取不能覆盖更新通知。新建对话仅 resetView，切换会话由订阅切换清空视图，均不以删除共享队列实现面板重置。

32 项队列数据源及原生行为测试、UI 类型检查、完整桌面构建和全部兼容回归通过。桌面确认队列整页刷新恢复、暂存草稿自动出队、编辑后重新解析、图片恢复及文件所有权、会话切换和冷重启等原有流程正常。证据：/tmp/amiba-shared-queue-tests.log、/tmp/amiba-shared-queue-ui-types.log、/tmp/amiba-shared-queue-build.log、/tmp/amiba-shared-queue-smoke.log。

离屏排队、后台出队和 Host inbox 对齐仍待使用该源继续接入。当前只统一单渲染器内的队列所有权，并没有宣称跨窗口同时写入具备 Host 原子事务保证。

#### 标准离屏输入事务记录

标准 inputActions.submit 已连接驻留输入事务及上一节的后台发送器。事务直接读取原生结构化草稿，复用 expandMentionPartsAsync、真实会话 InputTriggerController、CommandClaimStore、commandImages 和原上传准备缓存。官方引用交给 codec；普通文字不重新解析成引用。首次 slash 提交判定命令，第二次执行原 claim；共享命令状态可以交回原输入器。新增无界面的 composer-runtime 导出入口，避免状态逻辑加载终端视图。

事务发布真实 adjudicating/submitting/claimed/plain 状态和错误提示，重复提交被阻止。草稿修改及编辑器返回会取消尚未派发的准备；后台发送器在实际引擎派发前调用 onDispatch，因此目录、检查点等准备期间也可以取消。已派发后仅在原文档身份未变时清空文本，仅消费捕获的图片注册，保留后来输入的新草稿。错误和未确认回执保留输入；命令失败保留 claim 供显式重试。原输入器订阅这份事务状态并阻止重复发送，沿用原布局和提示区域。

验证：输入及原触发管线 43 项测试、桥接/提供者/图片/快照 49 项测试通过；UI 与插件类型检查通过；完整构建、完整桌面兼容回归通过。--resident-input 实测标准离屏真实引用只解析一次、形似 token 的普通文字原样进入模型、前台编辑器和草稿不变、离屏图片命令收到原始 PNG 字节并释放注册、离屏 claim 切回原输入器后继续执行。原有队列、图片、子会话及冷重启等回归也通过。日志：/tmp/amiba-resident-transaction-tests.log、/tmp/amiba-resident-transaction-bridge-tests.log、/tmp/amiba-resident-transaction-ui-types.log、/tmp/amiba-resident-transaction-plugin-types.log、/tmp/amiba-resident-transaction-build.log、/tmp/amiba-resident-transaction-smoke2.log。

首次桌面用例同时改动引用前后的文本，触发现有单区间替换语义，把整个引用替换为普通文字；测试改为两次独立编辑并先确认引用仍存在后重跑通过，未修改原编辑语义。失败保留和派发后新草稿隔离由状态测试验证，桌面新用例侧重成功路径与原输入器交接。

仍未完成：忙碌目标的离屏排队及完整 Host inbox/原生队列对齐、跨挂载引用 ID 连续性和外观/失效/粘贴语义、后台模型图片输入的独立实测。当前没有将这些项目标记为完成。下面保留较早的附件准备阶段记录，其中当时尚未接通的标准提交现已推进到本节状态。

驻留图片增加按原始注册实例缓存的上传准备与引用持有。并发准备和失败重试复用同一 Host 文件；取消调用不会丢弃仍属于草稿的已上传文件。删除草稿图片后，待进行中的上传和发送持有释放再清理文件。发送持有期间暂缓交给原输入器，交接后文件清理由原输入器和队列负责。

原输入器增加已准备图片的接收路径：保留浏览器 File 和草稿 ID，采用原 Host 附件 ID，仅创建新的原生附件行 ID，不再次上传或解析会话。原上传路径和界面布局不变。

当前验证：驻留图片与上传准备 7 项测试、原输入器及触发管线 32 项测试通过；UI 和插件类型检查通过。完整桌面构建和兼容回归通过。新增真实检查确认两次准备生成同一个 Host 文件，持有期间切回会话不提前交接，释放后原输入器接收真实 File/ID 且不增加文件，原生命令收到准确图片字节。日志为 `/tmp/amiba-prepared-staging-tests.log`、`/tmp/amiba-prepared-native-tests.log`、`/tmp/amiba-prepared-ui-types.log`、`/tmp/amiba-prepared-plugin-types.log`、`/tmp/amiba-prepared-build.log`、`/tmp/amiba-prepared-smoke.log`。标准离屏提交尚未接通，不能据此标记完整输入兼容。


#### 架构检查与当前适配契约对齐

更新旧工具视图检查：解析真实 TSX 语法，要求完整保留行 owner，只允许附加已审核的图片 loader 和对应 callId 的 inspector，并强制按 wire toolName 分派、保留官方语义和原生行两层回退。检查不接受注释中的伪匹配，也拒绝额外字段、重复选项或 spread 覆盖。新增 14 项真实源码及破坏性变体测试，纳入 verify:architecture。

keyed 插槽白名单补入已实现的 main、命令视图和 Cordis 业务入口；不放开任意 keyed 声明。输入桥检查要求旧绑定失效保护；提交检查改为结构化 parts 经官方 codec 解析并传入本次取消信号，避免要求回退到重新解析普通文字。

完整架构检查及上述 14 项检查器测试通过；另运行输入桥 26 项和原输入触发管线回归。本次仅修改验证脚本、测试和记录，未改产品能力或样式。完整扩展兼容仍未完成，独立 Web、跨窗口与重启队列等范围继续保留。


#### 右侧标签菜单跨会话验证

真实桌面回归覆盖第 58 项：在 A 会话打开菜单并保存 owner/dismiss，切到 B 后旧菜单自动移除；B 的同类型标签菜单收到 B 的 sessionId 和真实 tab。重复调用旧 A dismiss，等待两帧后 B 菜单仍可操作；正常关闭 B 菜单并返回 A，没有过期菜单残留。

初次测试错误要求标签 ID 跨会话唯一，实测失败；store 的计数器明确是每个 surface 独立生成，故按 sessionId 与 tabId 联合核对身份，未修改产品 ID 语义。修正后的完整 `--compat --sidebar-right` 桌面回归退出 0，日志 `/tmp/amiba-sidebar-menu-session-smoke-2.log`。本次只增加测试与验证记录，没有改产品能力或样式；独立 Web 仍待验证。


#### 引用身份在未改动投影交接时保留

发现并修复 input-draft-binding 每次重建都分配全新 occurrenceId 的问题。会话级 cursor 现在保留最后的公开快照；新编辑器或离屏绑定的草稿及全部引用投影完全一致时，按出现位置承接原 ID。同名重复引用仍各有自己的 ID。绑定内部仍以原 NodeKey/局部 ID 为准，删除再创建不复用旧 ID；来源、引用、标签或剪贴板内容变化不套用旧身份。公开 draftRev 继续前进，旧 CAS 写入仍拒绝。

新增测试先复现交接 ID 变化，再通过修复；输入绑定、桥接和标准提供者共 47 项测试通过，插件类型检查通过。完整桌面构建及 `--compat --resident-draft` 回归退出 0，实测前台到离屏、离屏追加普通文字再恢复编辑器的 occurrenceId 不变，旧版本写入拒绝、原草稿和其他会话仍保留。日志 `/tmp/amiba-reference-handoff-tests-2.log`、`/tmp/amiba-reference-handoff-types-2.log`、`/tmp/amiba-reference-handoff-build.log`、`/tmp/amiba-reference-handoff-smoke.log`。

本次没有修改输入器、序列化格式或样式。交接投影不同情况下的部分引用连续性、跨重启 occurrenceId、离屏重复引用的精确删除/撤销身份仍需进一步适配；不能据本次验证宣称引用全语义兼容。


#### 离屏结构化草稿的重复引用身份

新增失败用例复现：两条内容相同的引用，结构化删除第一条后，原算法按文本偏移将第二条误认成第一条。文档规范化现保留未改动且深层冻结的引用 part；同一 part 重复插入仍复制成独立 occurrence。ResidentInputProjection 用 WeakMap 跟踪实际保留对象，先为保留对象预留 ID，防止新引用通过坐标匹配占用幸存引用的 ID。未带对象身份的输入仍沿用原坐标匹配；没有改持久化格式、输入器能力或样式。

测试覆盖删除第一条同名引用、前缀移动、重复插入独立 ID、删除后用原结构化文档恢复身份。草稿与原输入触发管线共 51 项测试、UI/插件类型检查通过。完整桌面构建、`--compat --resident-draft` 回归及架构检查均退出 0；真实桌面回归验证交接、恢复及旧版本写入保护，本次精确重复删除/结构化恢复由状态测试证明，不将其冒充真实键盘撤销实测。日志 `/tmp/amiba-resident-duplicate-tests-2.log`、`/tmp/amiba-resident-duplicate-ui-types.log`、`/tmp/amiba-resident-duplicate-plugin-types.log`、`/tmp/amiba-resident-duplicate-build.log`、`/tmp/amiba-resident-duplicate-smoke.log`、`/tmp/amiba-resident-duplicate-architecture.log`。

仍待核对：同文字的纯身份重排、仅凭文本推断重复引用删除位置、真实编辑器撤销与离屏交接组合、跨重启身份及完整粘贴/失效语义。完整兼容目标保持未完成。


#### 同文字引用的结构化重排

新增用例复现同名引用交换时被 JSON 去重忽略的问题。草稿源现在对保留引用对象的位置变化单独判定：显示文字不变也发布新文档及 occurrence 顺序、推进公开 draftRev；正常等价序列化回传不更新快照、不额外通知。恢复原结构化顺序恢复原 ID 顺序。沿用原存储格式与界面，没有根据相同标签猜测未知引用的身份。

草稿源、文档、离屏投影及原输入管线 51 项测试、UI 类型检查和完整架构检查通过。日志 `/tmp/amiba-reference-reorder-tests.log`、`/tmp/amiba-reference-reorder-types.log`、`/tmp/amiba-reference-reorder-architecture.log`。本次验证是源状态与输入管线测试，未重新运行完整桌面构建/回归。跨重启、丢失结构后的纯文本歧义、真实键盘撤销与交接组合仍未完成。


#### 官方引用的剪贴板文本

对照固定官方 chip-node：getTextContent 用 clipboardText 供复制，而 Amiba 的 MentionNode 使用内部 token 供原持久化。新增无界面的剪贴板插件，仅在选区包含 dsh.reference 时按插件 clipboardText 投影，其他文字（包括形似 token 的字面量）及原生引用保持原复制文本。普通选区继续原处理器。剪切先成功写剪贴板再删选区；原 getTextContent、存储格式、样式及附件粘贴路径不变。选区边界逻辑参照已安装 Lexical 的 MIT 实现，保留版权说明及 LICENSE.lexical。

45 项剪贴板和输入回归、UI 类型检查通过。完整桌面构建及 `--compat --resident-draft` 回归退出 0：通过真实桌面 DOM Selection、ClipboardEvent 和 DataTransfer 验证复制 owner 文本、原草稿不变、粘贴到另一会话且 token 状普通文字不误生成引用。该用例没有写系统剪贴板；不声称系统快捷键/操作系统剪贴板端到端已验证。正反向部分选区、剪切、多段落和原生引用混排由 Lexical 测试覆盖。日志 `/tmp/amiba-reference-clipboard-regression.log`、`/tmp/amiba-reference-clipboard-types.log`、`/tmp/amiba-reference-clipboard-build.log`、`/tmp/amiba-reference-clipboard-smoke.log`。完整粘贴 lexicon/附件混排、invalid/appearance、新旧撤销及跨重启仍继续核对。


#### 输入版本与粘贴能力边界重新核对

直接核对实际安装的 rc.2 `ui-conversation/lib/types/client/input/contract.d.ts`：Occurrence.offset/length 明确属于 display text；`machine.d.ts` 的 projectClipboard 另将引用范围展开成 clipboardText。固定新版 c291e796 的 `input/editor/projection.ts` 则使用 clipboardStart/clipboardLength，facade.compose 的 draft 也是 clipboardText。两版契约不同。当前 Amiba 的全标签投影符合运行基线，不应为追新版直接替换，破坏原 rc.2 插件的坐标。新版输入 facade 需要版本区分和完整适配，继续列为未完成；现有引用 ID/剪贴板修复不代表新版坐标已支持。

粘贴能力核对：实际 rc.2 `lib/client.js` onPaste 仅调用 keyboard.pasteBegin(text, sel)，没有传入 components/generation；InputTriggerController 的公开声明没有 paste matcher，ReferenceCodec 只有 clipboardText 与 serialize。固定新版的 facade.paste 也按普通文本插入，词表装饰另行处理。因而“插件任意复制文本自动恢复为结构化引用”不能仅凭内部 PasteAttempt/paste-upgrade 类型推断为官方已接线功能。前一轮纯文本粘贴不自动生成引用的桌面证据符合这一范围。

后续应继续适配公开 lexicon 的文本装饰、appearance/invalid、文件与文本混合粘贴、撤销边界和新旧版本输入协议。不能把所有粘贴相关内部类型逐个暴露当作完成条件，也不能据此取消以上真实缺口。本轮未修改产品代码或样式；结论来自已安装发布包与固定新版源码对照，未运行新测试。


#### 官方输入的文件与文字混合粘贴

原附件 handlePaste 在读取文件后 preventDefault，会消费随附文字；Lexical 的原生监听又先于 React 冒泡运行，不能只在冒泡回调追加文字。官方输入现使用捕获阶段协调：先尊重调用方 onPaste，交给原附件处理；若附件处理消费事件，插入随附普通文字并停止后续重复处理。无官方运行时的输入仍走原冒泡路径，纯文本未被消费时继续 Lexical；没有改附件上传、注册、移除、样式或储存格式。新增 pasteText 使用原选区插入字面文字并设单独 history-push 边界。

47 项输入与剪贴板回归通过，含调用方拦截优先、文字仅插一次和一次撤销文字；补充范围复跑原输入 33 项通过。UI 类型检查、完整桌面构建、架构检查通过。真实 `--compat --input-state --command-images` 退出 0：DOM ClipboardEvent 同带一张 PNG 和 token 状普通文字，只生成一张原生上传图片，文字出现一次且无引用 occurrence；图片移除后注册清零，原编辑器仍连接、卡片 class 保留。原官方输入四阶段、图片命令原始字节、卸载尺寸保留等也通过。使用 DOM DataTransfer，未读写系统剪贴板。

日志 `/tmp/amiba-mixed-paste-tests-5.log`、`/tmp/amiba-mixed-paste-undo-tests.log`、`/tmp/amiba-mixed-paste-final-types.log`、`/tmp/amiba-mixed-paste-build.log`、`/tmp/amiba-mixed-paste-smoke.log`、`/tmp/amiba-mixed-paste-architecture.log`。首次测试缺少会话 ID 未进入官方路径，后续补齐；JSDOM 缺少 Range 几何接口的测试环境问题使用局部替身解决，未用替身替代实际桌面上传验证。系统剪贴板快捷键、文件与引用混合的完整撤销、词表装饰、invalid/appearance、新版坐标仍待核对。


#### 官方引用 appearance 保留与展示

补齐 ReferenceInsert 公开的 file/folder/session 可选 appearance：插入时写入原 mention payload，前台和离屏 Occurrence 都投影该值，交接比较包含该字段。仅带 appearance 的引用显示对应小图标，原按钮 class、标签、点击事件及无标记默认展示不变。图标 aria-hidden，不改变可访问名称或复制文本。

持久化采用 dsh.reference token 的可选第五段；旧四段 token 编码完全不变，新解析器只接受三种已声明值。结构化草稿自然保留 payload，旧式字符串恢复也恢复标记。没有用未知字符串生成图标或服务。

76 项投影/序列化/引用 UI 测试及 21 项输入提供者测试通过，UI 和插件类型检查、完整桌面构建通过。`--compat --resident-draft` 真实回归退出 0：插件提供 file 外观，现场 DOM 存在图标，会话往返、renderer 重载后的 Occurrence 仍保留 file；复制、纯文本粘贴和旧版本写入保护保持通过。已查看 `/var/folders/w1/6rt3z_zs1395fn30txrlysvr0000gn/T/amiba-reference-appearance.png`，图标与标签正常对齐，原输入器布局保留。folder/session 由组件和状态测试覆盖，未声称所有主题/平台均已实测。日志 `/tmp/amiba-reference-appearance-tests.log`、`/tmp/amiba-reference-appearance-provider-tests.log`、`/tmp/amiba-reference-appearance-ui-types.log`、`/tmp/amiba-reference-appearance-plugin-types.log`、`/tmp/amiba-reference-appearance-build.log`、`/tmp/amiba-reference-appearance-smoke.log`。

同轮核对 invalid：rc.2 set-invalid 是内部状态机分支，实际 facade 没有公开接线，固定新版仅保留节点字段/恢复。不能自行将来源暂时不可用永久写成 invalid；原提交 codec 失败拒绝发送和引用保留继续有效。完整失效展示与恢复的兼容语义仍需进一步核对，未标记完成。


#### 引用剪切与真实键盘撤销/重做

扩展 --resident-draft 桌面用例：选中包含一条 file 外观引用及 token 状字面文字的草稿，以 DOM ClipboardEvent/DataTransfer 剪切，确认剪贴文本是 owner 投影、草稿及 occurrence 清空；通过 CDP 原生键盘事件撤销，逐字段恢复原 occurrence（含 ID、范围、appearance），公开 draftRev 前进；重做清空、再次撤销仍恢复相同 ID。随后继续既有离屏交接、返回会话及重载验证，全部退出 0。

首次重做测试错把 CDP modifier 1（Alt）当作 Shift；更正为 8 后通过，没有修改产品历史实现。当前用例在当前平台选择 Meta/Control，重做额外加 Shift；剪切只写本地 DataTransfer，不读写操作系统剪贴板。日志 `/tmp/amiba-reference-history-smoke-2.log`。本轮只增加桌面验证与记录，沿用最近一次完整构建；没有改能力或样式。

这证明当前编辑器中的引用剪切/恢复及其后续会话交接，不证明编辑器卸载后仍保留整个 undo/redo 栈，也不证明跨重启恢复历史栈。多引用/附件混合撤销、其他平台快捷键、词表装饰、新版输入协议等仍待完成。

#### 会话切换保留输入历史

新增 ComposerHistoryPlugin，继续使用 Lexical 公共 HistoryPlugin，在相同 ComposerDraftSource 的未变更文档上保存、恢复历史。缓存仅保留 EditorState，恢复时将历史项绑定到当前 editor；各次挂载获得独立栈，避免指向已卸载编辑器或共享可变栈。恢复同一节点树时跳过字符串重建，保留引用 NodeKey。后台文档已变化时不恢复旧树；原输入器、控件和样式未改动。

首次桌面回归在会话返回后的 redo 等待失败（/tmp/amiba-session-history-smoke.log）：保存校验直接比较原始 parts JSON，而引用字段的顺序与规范化 document 不同，误判为内容变化并丢弃历史。改用 composerDraftDocument 规范化后比较。新增带引用的两个回归场景，分别覆盖复用 editor 和重新挂载：在另一会话撤销不影响原稿，返回后先 redo 再 undo，完整文档及节点键一致；已有测试覆盖文本历史和后台新稿保护。

55 项相关测试、UI 类型检查、架构检查及完整桌面构建通过。真实 --compat --resident-draft 退出 0：原生键盘 redo/undo 跨会话保留，引用 ID、范围、appearance 恢复一致；随后后台编辑、返回、renderer 重载及其他既有回归仍通过。日志：/tmp/amiba-session-history-fix-regression.log、/tmp/amiba-session-history-fix-types.log、/tmp/amiba-session-history-fix-architecture.log、/tmp/amiba-session-history-fix-build.log、/tmp/amiba-session-history-fix-smoke.log。

范围仍有限：这是进程内未变更草稿的历史保留，不是跨 renderer 重载/进程重启的历史持久化，也未完成后台编辑与既有历史的合并、多引用与附件混合撤销或其他平台验证。这些仍属于可继续适配项。

#### 历史恢复排队期间的后台写入保护

补齐挂载恢复的提交前校验：useMemo 选中历史缓存后，后台写入可能在 layout 阶段到达，而旧 EditorState 在下一微任务才恢复。新增可复现测试在同一挂载阶段写入新稿；修复前实际得到 cached 而非 incoming（/tmp/amiba-history-race-red.log）。恢复微任务现在重新检查源文档身份，变化则放弃旧树并清空此次挂载携带的旧历史，交由正常文档同步应用新稿。覆盖非空新稿及显式清空，随后 undo/redo 均不会恢复旧缓存。

57 项编辑器、触发器和文档测试通过，UI 类型检查通过，git diff --check 通过。日志 /tmp/amiba-history-race-regression.log、/tmp/amiba-history-race-types.log。本次未重新运行完整桌面构建或桌面回归；竞态证据来自实际 React/Lexical 生命周期测试，上一提交的桌面通过记录仍仅代表上一提交。

另外确认后台写入历史不能无差别套用新版本：实际 rc.2 InputFacade.setDraft 派发 draft-changed 事件，固定 c291e796 的 setDraft 明确使用 HISTORY_MERGE_TAG。两版 commitSend 均单独切断已发送内容的历史。后续完整后台历史合并必须区分程序写入、用户编辑和提交消费，不能把所有文档变化都作为可撤销编辑，也不能把尚未完成的版本适配宣称为已兼容。

#### 成功命令与后台提交的历史消费

原生 ComposerDraftSource 增加可选 commitSend/getHistoryVersion：只消费提交时捕获的同一文档，原子推进历史版本并清空草稿。普通 set/setDisplayText 仍保持原有含义。ComposerHistoryPlugin 监听消费版本，清除对应活动历史，缓存恢复也核对版本；纯图片发送可能没有文字变化，仍切断旧历史，并保留当前空状态作为下一次编辑的撤销起点。

官方前台命令成功且草稿仍匹配时调用消费及公共 CLEAR_HISTORY_COMMAND；失败、草稿已更新、旧会话回调不清新稿。标准后台输入事务在成功消费路径调用同一接口；拒绝/未确认结果不消费，异步结果与较新草稿不匹配时也不切断新历史。两个新方法在公共草稿接口上保持可选，旧嵌入方和只有草稿读写的 bridge 继续使用原路径，未声称没有历史接口的第三方宿主也获得持久历史控制。

71 项编辑器/触发器/文档/后台提交测试及 39 项输入提供者/桥接测试通过，UI 与插件类型检查、架构检查、最终完整桌面构建通过。测试覆盖活动及离屏消费、文字已空的图片消费、消费后新输入正常 undo/redo、旧草稿源、失败和较新草稿保护。中间发现纯图片消费后 current 为 null 导致第一次新输入无法撤销，已修复并保留回归用例。初次构建发现 bridge 源类型缺少消费接口，已接通并重新验证。

最终真实 --compat --resident-draft --input-state --command-images 退出 0：图片命令完成后原生键盘 undo/redo 仍为空；会话切换引用历史、输入状态四阶段、混合文件文字粘贴、原控件样式和卸载回退等既有回归同时通过。日志 /tmp/amiba-send-history-regression-3.log、/tmp/amiba-send-history-provider-tests.log、/tmp/amiba-send-history-types-2.log、/tmp/amiba-send-history-plugin-types-2.log、/tmp/amiba-send-history-architecture-final.log、/tmp/amiba-send-history-build-3.log、/tmp/amiba-send-history-smoke.log。

尚未覆盖原生普通发送和所有队列交接的成功边界，未将它们统一改成消费操作；完整后台编辑历史合并、跨重启和跨窗口历史仍待适配。本轮没有改变原输入框及附件栏的样式。

#### 后台排队持久化确认与收尾管理

核对发现 bridge 的 enqueue 原先只等待 queue.ready()，追加后立即返回，从而可能在存储失败前消费草稿和历史。新增 appendPersisted：新条目在写入成功后才发布给可发送队列，失败不发布。与原生同步编辑共用写入串行链，后续写入在执行时读取当前快照，避免覆盖等待期间已确认的新条目；写入成功后合并等待期间的原生编辑。后台入口在确认后才转移图片文件所有权、返回消费成功。原生同步队列入口保持原有行为，尚未统一改造。

恢复队列暂停状态与此次 admission 一起处理；通过暂停操作版本保留等待期间新按下的 Stop，即使此前已暂停、再次 Stop，也不被旧提交解除暂停。失败保留原暂停状态。

52 项队列存储/原生操作/后台事务测试和 40 项桥接/提供者测试通过，涵盖延迟及失败写入、失败后一次重试、并发 admission、保存期间原生编辑、保存期间 Stop；前端/插件类型、架构检查及完整桌面构建通过。真实 --compat --child-continuation --resident-queue 退出 0，验证两条后台持久队列、图片所有权、会话返回后 undo/redo 不复活已入队草稿且两条队列不变，原 Stop/Edit/Delete/Send now 行为继续通过。日志 /tmp/amiba-queue-admission-tests-2.log、/tmp/amiba-queue-admission-provider-tests.log、/tmp/amiba-queue-admission-types.log、/tmp/amiba-queue-admission-plugin-types.log、/tmp/amiba-queue-admission-architecture.log、/tmp/amiba-queue-admission-build.log、/tmp/amiba-queue-admission-smoke-2.log。首轮脚本将新断言放在返回目标会话之前，访问未挂载输入失败；移到正确阶段后复用构建重跑通过，未修改产品以绕过该错误。

普通发送仍调用无接收确认的 client.submit，不能把该调用返回等同于成功确认；其确认边界及全部队列/历史协调仍待完成。根据用户反馈新增 dsh-extension-closeout.zh-CN.md，统一按功能组收尾，减少零散阶段和重复完整构建，不改变原 64 项目标及保留现有能力/样式的要求。

#### 普通发送接收确认、失败队列保留与历史消费

普通发送现在优先调用已有 submitWithReceipt，通过 nativeSubmissionAdmission 区分 pending、accepted、failed 与旧宿主 legacy。只有真实 accepted 才调用普通直接发送的 onAccepted；原输入已清空且文档仍未变更时消费历史，新草稿不受旧回执影响。旧宿主没有回执接口时继续原 submit 路径，不伪造成功。

接收前错误不会再清掉整个待发送队列。拒绝或未确认的本次载荷（含原始结构化草稿与附件）保留为暂停队列项，原 backlog 保留；未确认提示先核对会话，不自动重发。保留 admission 失败状态以处理晚到的流错误，避免新保留的队列再次被错误处理清掉；没有流事件的 disposed/busy 拒绝路径也能结算本次 pending。通过最新 streamHandlerRef 处理异步结果，避免旧会话闭包清理当前会话。真正已接收后的模型流错误沿用原处理路径。

43 项 admission/原生队列/会话交接测试和 13 项真实引擎接收确认测试通过，UI 类型检查、架构检查、完整桌面构建通过。真实 --compat --child-continuation --native-admission --resident-queue 退出 0：已接收的普通输入不能经键盘 undo/redo 恢复；以实际 rc.2 子会话图片拒绝验证，本次图片载荷与旧 backlog 均保留为两条暂停队列，旧项没有自动进入模型，原删除操作正常；后台队列确认/历史、子会话运行/停止及既有兼容回归同时通过。

日志 /tmp/amiba-native-admission-tests-2.log、/tmp/amiba-native-admission-engine-tests.log、/tmp/amiba-native-admission-types-2.log、/tmp/amiba-native-admission-architecture.log、/tmp/amiba-native-admission-build.log、/tmp/amiba-native-admission-smoke.log。未确认和旧宿主行为由状态测试覆盖，未声称在所有网络故障或平台实测。编辑队列发送的历史消费、接收前已输入新稿后的完整历史分界、跨窗口/重启、双队列协调仍未完成。本轮未修改组件布局或样式。

#### 提交前历史边界与编辑队列发送

新增 composer-history-state 共享历史登记：提交前捕获当时的 EditorState 集合；收到真实确认后仅从当前或缓存的 undo/redo 中移除这一集合。确认不改草稿文档，也不清掉提交之后产生的编辑。当前已空的纯图片输入保留空基线，尚未提交到编辑器的清空不重新种入旧正文。重复确认幂等；未确认则不执行消费。历史缓存仍只保留 EditorState，编辑器登记在卸载时释放。

普通直接发送与编辑队列发送均在清空输入之前捕获边界，并通过现有 onAccepted 回执回调消费。成功命令也清理其提交前历史，在用户已经编辑新稿时不会清掉新稿内容和较新的编辑历史。此前普通发送仅对未变更空稿 commitSend 的限制已被这条边界路径替代。

97 项编辑器、触发器、队列和 admission 测试通过，涵盖确认期间新稿的两步 undo/redo、离屏确认、返回后确认、未确认保留旧引用历史、重复确认及纯图片空基线；UI 类型检查、架构检查、完整桌面构建通过。真实 --compat --child-continuation --native-admission --resident-queue --input-state --command-images 退出 0：编辑队列接受后旧稿不能经原生键盘恢复，随后新输入仍可正常 undo/redo；普通发送、真实拒绝、后台持久队列、图片命令、混合粘贴、原输入区样式和尺寸同时通过。接收前新稿多步历史和缓存恢复由实际 React/Lexical 测试覆盖，不冒充桌面网络延迟实测。日志 /tmp/amiba-history-boundary-regression.log、/tmp/amiba-history-boundary-types-final.log、/tmp/amiba-history-boundary-architecture.log、/tmp/amiba-history-boundary-build.log、/tmp/amiba-history-boundary-smoke.log。

#### 纠正无依据的跨重启撤销栈要求

核对实际 rc.2 发布包 lib/client.js：InputMachine 初始化 log=[]、redoStack=[]（约 450 行），InputFacade 每次新建该机器（约 978 行）；ConversationSession 恢复 storedDraft 并绑定字符串镜像（约 7404 行），没有导入历史栈。固定 c291e796 的 input/facade.ts 构造器明确 registerHistory(editor, createEmptyHistoryState(), ...)，bindMirror 只写 draft 字符串。两条已核对的官方初始化/持久化路径均不承诺重启后恢复整套 undo/redo。

因此此前将“历史跨重启”列为兼容必做项是不准确的，移出必做清单；这是纠正超出官方支持范围的额外增强，不是省略原审计的扩展契约。草稿、队列、附件的真实持久化和恢复要求仍保留；同一渲染器的会话历史兼容和上述已实现能力也不回退。早期记录中笼统把跨重启撤销列为未完成的文字，以本条纠正为准。


## 2026-09-14 — 公开词表驱动原生文本装饰

核对实际 rc.2 controller.lexicon 和 InputBar scanTextRefs：词表只驱动普通文本装饰，并非粘贴生成 occurrence 的入口。useLexicon 属于 composer.bar 的 registrant hooks，本次没有向 sessions.provide 添加错误的会话 hook。

OfficialTriggerPlugin 订阅公开词表，以编辑器所在窗口的 CSS Custom Highlight 绘制真实文本范围；更新、根节点替换和卸载均处理订阅与范围释放。沿用原 muted/foreground 颜色，不修改 Lexical 节点、正文、选择、历史和布局。不支持 Highlight API 的浏览器保留原输入行为，独立 Web 待验证。当前遵循 rc.2 的 /plan.md 前缀匹配；新版词边界、点击、claim 优先级及其他输入协议仍需成组核对，不能将本次视为整套引用兼容完成。

27 项词表及 RichComposerEditor 测试、UI typecheck、架构检查和完整 Desktop 构建通过。真实 Desktop --compat --input-state --command-images 通过：注册后高亮出现，空词表移除，更新恢复，卸载移除；draftRev、occurrences 和输入框 DOMRect 保持一致。已查看 amiba-lexicon-native.png 截图；同轮图片命令、混合粘贴和输入区回归通过。日志为 /tmp/amiba-lexicon-{tests,types,architecture,build,smoke}.log。

详细表同步纠正后台自动出队和后台入队落盘的两条过时描述。


## 2026-09-14 — 新旧图片命令契约并行适配

依据固定 c291e796 的 client/ui-conversation/src/client/contract/input.ts 和 service.ts，新版 claim 以 attachments 接受附件，图片载荷增加 type:image，来源判定使用 envelope.attachments；rc.2 使用 images 与无 type 的图片载荷。新增 command-contract 在调用边界区分显式 attachments 声明，不替换原 claim、submit 回调或会话 scope。旧图片数组原样传递，新载荷创建独立对象；新版明确 attachments:false 即使同时出现旧 images:true 也拒绝图片。无图片的文字命令仍可运行。

前台判定同时提供图片数和完整附件数，避免新版来源忽略普通文件；后台当前注册对象均为图片，提供相同的两项计数。claim 状态保留新版 name/attachments，同时保留现有组件使用的 images 能力。原始字节校验、拒绝时保留原稿与附件、成功消费仍经过原有链路。

验证：UI 四组 54 项测试及 bridge/provider 41 项测试通过，共 95 项；UI 和 ui-shell typecheck、架构检查、完整 Desktop 构建通过。Desktop --compat --input-state --command-images exit 0：同次运行旧图片命令与使用新版字段的真实注册来源，分别收到对应载荷；新版可观察正确附件总数、claim 状态和原始图片字节，成功释放浏览器注册并清空原稿；原生撤销、输入卡片尺寸、图片混合粘贴等同轮通过。日志 /tmp/amiba-command-dialects-{ui,bridge,types,architecture,build,smoke}.log。

边界：这是固定新版图片命令字段的运行时接入，不代表完整新版插件依赖已经迁移。新版普通文件需 ctx.fileUpload.upload 返回真实 receiptId，不能伪造或借用 Host 文件 ID；完整 addAttachments/attachmentIds、输入 clipboardText 坐标仍待实现。详细评估表增加七行新旧输入契约对照，避免以字段相似推断已兼容。


## 2026-09-14 — 文件 receipt 依赖审计与准确诊断

已实际加载受管 app 的 rc.2 commands 模块确认缺少 registerFileReceiptResolver，并确认 file-upload 包未安装；同时核对附件服务公开类型只有图片。新版普通文件需要附件存储、命令解析、上传授权和接收回收整体迁移，详细表新增六行依赖核对，明确下一步工作顺序。

另发现固定 c291e796 的文件上传 commit 明确拒绝 origin=subagent（SUBAGENT_FILE_UNSUPPORTED），已与普通根会话尚未迁移分开。没有借此缩小整体兼容目标，也没有改变 Amiba 原有子会话附件能力。

修正新版声明 attachments:true 的命令遇到普通文件时的提示：说明当前运行时尚未接入，而不是错误声称命令仅接受图片。旧命令诊断保留，仍在读取文件前拒绝，原有失败保留链路不变。9 项 command-attachments 测试通过，涵盖新版文件诊断和拒绝时不读取字节。本次仅诊断文案及证据更新，没有重复完整构建或桌面回归。


## 2026-09-14 — 官方文件存储能力接入现有 Host 服务

在 dsh-plugin-attachments 内迁入固定 c291e796 的 file-store 和不可变文件发布部分，以及结构化附件错误；保留 DeepSeek MIT 许可证。新文件以 sha256 引用，保存原始字节、清理文件名、流式写入和读取、校验摘要与长度，支持空文件和规范 base64。通过 Cordis attachments 注入，只为没有文件接口的旧服务实例添加文件方法，已有后端不覆盖；原图片服务和 att_* 存储不替换。文件根目录是原插件配置下的 official-files/v1。

卸载按原始属性描述符识别自己添加的方法；Cordis 每次读取会包装函数，不能比较读取到的函数身份。真实 Cordis 服务作用域测试和后续替换不被删除的测试均通过。此处只连接存储，尚未创建 receipt 或开放普通文件命令输入。

运行时打包器修复了根许可证文件的遗漏：复制 package.files 声明的 LICENSE/NOTICE，纳入源摘要和产物存在性校验，复用安装时移除旧声明残留。受管安装中的 LICENSE.deepseek 已与源文件逐字节比较一致。

验证：11 项文件存储、Cordis 清理及原生文字/PDF/附件测试通过；插件 typecheck、架构检查、runtime:prepare 和 runtime:verify 通过。真实 Desktop --compat --input-state --command-images exit 0：ctx.attachments 保存二进制、分块写入同内容并去重、读回原字节，同时实际调用旧图片 saveImage/readImage 成功；新旧图片命令、原输入卡片样式与尺寸和混合粘贴同轮通过。没有重建桌面前端。日志 /tmp/amiba-official-file-store-{tests,types,architecture,build,verify,smoke}.log。

验证中发现并修正：Cordis 包装方法导致旧清理判断失效；安装目录遗漏根许可证。Host 图片探针最初使用损坏 PNG，被严格后端正确拒绝，改用已有持久图片测试的有效 PNG 后通过，未放宽生产解码校验。

下一步仍是命令 receipt 解析、上传授权及生命周期，再连接浏览器普通文件；原 64 插槽和相关服务总体目标不变。


### 2026-09-14 Host 文件上传凭据授权

- 为现有附件插件接入 fileUploads 服务，按真实 Agent scope 与精确 Session 身份保管凭据；落盘后检查 Agent 仍驻留，才签发凭据。
- 保留官方接收绑定的 commit/rollback、按请求回收及会话释放语义，保持新版子会话文件上传的明确拒绝。未改动原生子会话附件能力。
- rc.2 没有新版 RemoteError，使用 Host FileUploadError 明确保留 code/data；远程通道与错误映射、命令 resolver 和接收调用方仍待接通。
- 验证：16 项附件测试（含 5 项授权测试），插件 typecheck、verify:architecture、runtime:prepare 和 runtime:verify 通过；真实 Desktop --compat --input-state --command-images 通过，覆盖安装后的 Host 文件凭据解析、回滚保留与成功回收，以及旧图片能力。
- 日志：/tmp/amiba-receipts-{tests,types,architecture,build,verify,smoke}.log。首次桌面失败为探针遗漏 agents 注入，修复探针后同一生产构建通过。


### 2026-09-14 文件凭据命令接收

- 固定 rc.2 的 dsh-commands 补丁新增 registerFileReceiptResolver 与有顺序的图片/文件接收；所有文件授权先于图片写入。原 images 声明与旧图片载荷保留，显式 attachments 声明优先，取消和命令生命周期保留。
- Host 网关通过 executeWire 接受 images 或 submittedAttachments，保持公开 execute 四参数签名；可选字段显式 acceptsUndefined，拒绝同时提供两份载荷。修正官方 dsh-api-remotes 浏览器包内嵌的旧参数校验和列表投影。
- fileUploads 自动注册并按 Cordis scope 卸载命令解析器。解析器状态使用对象保存，修复 Cordis 函数包装导致注销身份比较失效；Agent 恢复解析器同样处理。
- 证据：命令 11 项、附件 17 项测试通过，包含实际浏览器发布包加载和解析；类型、架构、runtime prepare/verify 通过。真实 Desktop --compat --input-state --command-images 验证旧客户端、新版 HTTP 字段传入真实上传文件并执行，未知凭据拒绝，新旧图片命令和混合粘贴等原能力通过。
- 仍未完成：浏览器文件上传承载、输入器普通文件注册/调用/成功消费、模型文件提交及队列接收绑定；上述命令成功不能替代这些证据。
- 日志：/tmp/amiba-file-commands-{tests,attachments-tests,adapter-types,types,architecture,build,verify,smoke}.log。


### 2026-09-14 浏览器编码文件上传

- 新增 fileUploads/upload 的严格 Host/Client 描述，通过现有 Agent lookup 选择真实会话，携带取消信号；FileUploadError 在远程边界映射为 rc.2 TypertLookupFailure 的 code/message/details。
- 附件客户端提供 fileUpload 服务，支持 Uint8Array 精确视图及 Blob 的编码上传。调用使用创建时的远程授权上下文，避免消费者作用域替换导致权限丢失；已有 fileUpload 服务保留。
- 声明共享 Cordis 客户端模块，保持单例，不修改原输入器和样式。
- 23 项附件/上传测试、类型和架构检查、runtime prepare/verify 通过；真实 Desktop --compat --input-state --command-images 验证浏览器 Blob 上传取得新凭据，再通过官方命令执行，取消生效，新旧图片、混合粘贴和输入历史回归通过。
- 限制与剩余：available=false 表示尚无后台流式承载，ReadableStream 显式拒绝；原生输入器的普通文件命令调用与成功消费、流式上传、模型文件及队列仍需适配。本地桥接可用不等于整个新版 dsh-client-file-upload 包已迁移。
- 日志：/tmp/amiba-upload-remote-{tests,types,architecture,build,verify,smoke}.log。


### 2026-09-14 原输入器普通文件命令

- 原生附件准备按整批验证身份、大小和图片类型，再按原顺序生成图片字节/文件凭据；普通文件通过 fileUpload 获取真实会话凭据。旧图片声明仍拒绝普通文件，显式新版 attachments 声明启用文件路径。
- 新增内部混合命令载荷与上传桥接，不修改原附件条和样式；原成功消费流程处理对应 UI 附件，错误保留草稿和附件。会话切换使准备失效时不再继续派发原命令。
- 修复实际 dsh-client-ui-commands 发布包丢弃 attachments 声明的问题，按总附件数拒绝不接受文件的命令/弹窗入口；命令实际回调、会话上下文及 this 保留。架构检查同时识别这一类型兼容调用写法。
- 证据：UI 23 项、桥接与官方发布包 29 项测试通过；UI/插件类型检查、架构检查、Desktop build 和 runtime prepare/verify 通过。真实 Desktop --compat --input-state --command-images 使用原文件选择器和官方命令入口，Host 第一次返回错误后正文和附件保留，第二次成功后对应内容清理；两次实际文件内容一致。新旧图片、混合粘贴、输入历史等原能力同轮通过。
- 仍待完成：离屏普通文件注册/恢复、队列绑定与跨窗口生命周期、后台流式上传、模型文件提交等；此处前台文件命令成功不是整个附件组完成。
- 日志：/tmp/amiba-composer-files-{ui-tests,bridge-tests,ui-types,shell-types,architecture,build,runtime-build,verify,smoke}.log。


2026-09-14 流式 Host 通道进展：为 rc.2 Connection 增加按调用插件生命周期注册的精确 Fetch 路由和 streaming 请求模式；普通 RPC 继续缓冲并执行原大小上限，上传继续经过现有 Host/Origin 来源检查。注意 rc.2 的来源检查不是新版浏览器 token/cookie 认证，本次没有声称迁入新版认证。新增 /api/session/uploadFileBinary，将请求分块直接交给精确会话授权的 fileUploads.uploadStream，连接断开传递取消，失败返回结构化错误。实际 HTTP 测试证明请求 EOF 前已接收分块，并验证跨站拒绝、普通 RPC 上限及卸载回退；真实桌面安装后的路由签发凭据并成功执行官方文件命令。附件原有 23 项测试与新增 2 项 HTTP 测试通过，类型、架构、运行时构建/校验和桌面回归通过。浏览器后台 Worker/ReadableStream 调用仍待接入，客户端 available 仍为 false；不能据此宣布端到端后台流式上传完成。


2026-09-14 后台客户端上传进展：fileUpload 服务新增 Blob/ReadableStream 后台承载，保留 Uint8Array 编码 Remote 回退。网页端适配官方 Worker 的 Blob XHR 与流式 fetch；桌面通过预启动 __DSH_FILE_UPLOAD__ hook 使用窗口隔离的 IPC，每块最多 64 KiB，等待写入确认再读取，Host 地址和路径固定校验。窗口关闭/导航、调用取消及提供服务的插件卸载会取消对应上传，回收 IPC 状态；进度和结构化结果已接通。实际桌面 Blob 与分块 ReadableStream 上传均获得有效凭据并执行官方文件命令；多块传输中取消触发 AbortError 并取消源读取，原文件/图片命令、粘贴和历史回归通过。28 项附件测试、9 项运输/分块测试、插件与桌面类型检查、架构检查、完整构建及运行时/桌面包验证通过。桌面客户端 available 为 true；网页 Worker 有逻辑测试，独立 Web 实际部署、浏览器网络协议条件仍待验收，不能把桌面结果外推到所有 Web 环境。普通文件模型输入、离屏注册、队列及跨窗口文件语义仍未完成。


2026-09-14 模型文件表示进展：核对固定 c291e796 后确认，官方普通文件从不以原生文件块发送给模型提供方，而是在最终 adapter 调度前转换为只读文件路径文本。已给 rc.2 LLM 补齐 contentHasFile、fileHandleText、projectFilesToText 和 fileRequestText，递归覆盖工具结果，保留不可变原消息及不相关消息身份；先转换文件，再按原策略处理不支持图片的模型。补齐 FileAttachmentRef/FileBlock 类型，以及 FS 的保守默认路径映射和 Local FS 的绝对路径映射；未知执行环境或坏引用明确返回无法读取路径的说明，未扩大文件写权限。4 项新增真实 LLM/存储测试及全部 32 项附件测试、类型/架构、运行时构建/校验通过；真实桌面 Host 的 fileRequestText 返回实际存储文件路径，同轮流式上传、命令及原输入能力回归通过。新增开发测试依赖不改变受管运行时的 DSH 版本。模型提交入口、token 统计、队列和完整文件历史仍待接通，不能将请求转换层完成等同端到端文件模型提交完成。


2026-09-14 文件模型提交 API 进展：rc.2 session.prompt 的 Host 与实际浏览器发布包均接受 {type:'file',receiptId}；公共 PromptContentPart 类型同步扩展。Host 在任何图片持久化前验证整批文件的精确会话凭据，保持文字/文件/图片及重复文件的原顺序，生成结构化 UserMessage；接收时按 request.rpcId 绑定文件，失败回滚、成功提交，接收前核对 Agent 仍驻留。未知凭据返回 attachment-error/FILE_NOT_STAGED。33 项附件测试、类型/架构和运行时构建/校验通过；真实桌面安装后的 session.prompt 首次受控拒绝、同凭据重试成功及原输入回归通过。该桌面用例在 Agent 接收边界使用受控接收器，不调用外部模型；不覆盖真实模型整轮、持久历史和队列出队。原输入器模型文件发送、离屏注册、队列、token 统计及历史展示仍待闭环。


2026-09-14 文件计量和历史进展：TokenMeter.measure 使用与 LLM 相同的文件路径文本估算模型请求；已有路径映射变化时重放该会话计量，保留正常文本行为、嵌套文件、历史替换及 provider 用量基准。公共 estimateMessage 仍维持原结构估算，用于工具结果裁剪；当请求值与结构值不同时，节点额外携带 heuristicTokens，官方 basic compaction 写入结构 shadowedTokenCount，避免持久化投影扣减错位。4 项新增测试覆盖上述行为和压缩准备/投影联动；全部 37 项附件测试、类型、架构和运行时构建/校验通过。补丁合并为从原始包到最终内容的一份差异，独立应用和实际打包均通过。真实桌面中，受控接收器将成功的文件消息实际写入 Session，再经 session.history 读回，文件标识、顺序和来源保持；真实 Host 的文件请求计量与同份路径文本一致，同轮原输入回归通过。没有外部模型调用；历史 API 读回不代表重启恢复或 UI 文件展示完成。原输入器模型文件发送、重复请求确认、队列/重启/跨窗口生命周期与文件展示仍待闭环。
