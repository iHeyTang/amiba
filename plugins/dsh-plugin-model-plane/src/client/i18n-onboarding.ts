import type { PluginCatalogOverlay } from "@amiba/ui/plugin";
export const providerOnboardingI18n: PluginCatalogOverlay = {
  en: {
    "setup.choose":
      "First, choose a model service. Amiba recommends TokenDance, or the official DSH DeepSeek provider.",
    "setup.token":
      "Amiba recommendation · Multiple model families through your TokenDance account.",
    "setup.deepseek":
      "DSH official · Connect directly with your DeepSeek account.",
    "setup.configure": "Configure",
    "setup.model": "Default model",
    "setup.continue": "Use this model and continue",
    "setup.working": "Saving your default model…",
    "setup.saved": "Your model is ready. Let's continue!",
    "setup.failed":
      "That didn't work yet. Check the configuration and try again.",
    "setup.loading": "Let me check which services are available…",
    "setup.retry": "Refresh services",
    "setup.missing":
      "This service is not available. Enable its provider plugin in Settings.",
    "setup.other": "Other services",
    "setup.hint":
      "Configure your API key first, then choose a default model. A saved key does not verify account access or balance.",
    "setup.ready": "Configured",
    "setup.fix": "Configure credentials and enable models to continue.",
  },
  "zh-CN": {
    "setup.choose":
      "先选一个模型服务吧。Amiba 推荐 TokenDance，也可以使用 DSH 官方的 DeepSeek。",
    "setup.token": "Amiba 推荐 · 使用你的 TokenDance 账号接入多种模型。",
    "setup.deepseek": "DSH 官方 · 使用你的 DeepSeek 账号直接接入。",
    "setup.configure": "配置服务",
    "setup.model": "默认模型",
    "setup.continue": "使用这个模型并继续",
    "setup.working": "正在保存默认模型…",
    "setup.saved": "模型已经准备好，我们继续吧！",
    "setup.failed": "还差一点，检查配置后再试一次吧。",
    "setup.loading": "让我看看有哪些服务可以接入…",
    "setup.retry": "刷新服务状态",
    "setup.missing": "这个服务暂不可用，请先到设置中启用对应的 provider 插件。",
    "setup.other": "其他服务",
    "setup.hint":
      "先配置 API Key，再选择默认模型。保存密钥不会验证账号权限或余额。",
    "setup.ready": "已配置",
    "setup.fix": "请先配置凭据并启用模型，再继续。",
  },
};
