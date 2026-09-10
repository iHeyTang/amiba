# 模型与服务商图标来源

图标只用于品牌识别，不参与 Provider 注册、协议选择或模型能力判断。

大部分图标来自项目已有依赖 `@lobehub/icons-static-svg`。单色标志采用主题文字颜色渲染；已有彩色标志保持原有处理。

本目录额外随应用打包的品牌资源（2026-09-08 核对）：

- `tokendance.svg`：来自 [TokenDance 官网](https://tokendance.space/) 声明的 [SVG favicon](https://tokendance.space/TokenDance%E5%93%81%E7%89%8C%E5%9B%BE%E6%A0%87-%E5%8D%95logo.svg)。保留标志路径，移除黑色背景矩形，以便作为单色遮罩适配深浅主题。
- `unifuncs.png`：来自 [UniFuncs 官网](https://www.unifuncs.com/) 的 [favicon](https://www.unifuncs.com/common/favicon.png)，保留原图及背景。
- `dots.png`：来自 [dots 官方模型卡](https://huggingface.co/dots-studio/dots3-note-prev) 链接的 [组织头像](https://cdn-avatars.huggingface.co/v1/production/uploads/683f0a13218449ec8f707047/K8V6vNs42cvpaTq_s6snK.png)，保留原图及背景。

品牌权利属于各自所有者。运行时不访问这些外部网址，图标通过本地资源加载。

归属参考：

- [InclusionAI Ling 官方项目](https://github.com/inclusionAI/Ling)：Ling/Ring 使用蚂蚁集团标志。
- [腾讯官方 Hy3 模型卡](https://huggingface.co/tencent/Hy3)：Hy 系列使用混元标志。
- [UniFuncs 官网](https://www.unifuncs.com/)：U3/S3 系列使用 UniFuncs 标志。

`__tests__/fixtures/provider-icon-catalog.json` 固定本次核对的 37 个 pi-ai 官方 Provider ID、两个额外内置 Provider ID，以及 TokenDance 随包模型 ID，用于防止映射遗漏。另有聚合平台命名空间、深浅主题和相似字符串不误匹配的测试。
