import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

export const webhookI18n: PluginCatalogOverlay = {
  en: {
    "webhook.back": "Choose a connector",
    "webhook.close": "Close",
    "webhook.title": "Connect a custom service",
    "webhook.description":
      "Receive messages over HTTP and optionally send replies to your service.",
    "webhook.callback": "Reply URL",
    "webhook.callbackHint":
      "Optional. Use HTTPS for remote services; HTTP is allowed on loopback only.",
    "webhook.senders": "Allowed senders",
    "webhook.sendersHint":
      "Comma-separated IDs. Leave empty to accept any sender with the credential.",
    "webhook.create": "Create connection",
    "webhook.done": "Done",
    "webhook.endpoint": "Request URL",
    "webhook.token": "Bearer credential",
    "webhook.once":
      "Copy this credential now. It is not shown again; you can generate a new one here.",
    "webhook.rotate": "Generate a new credential",
    "webhook.rotateHint":
      "The current credential will stop working immediately.",
    "webhook.save": "Save settings",
    "webhook.copy": "Copy",
    "webhook.copied": "Copied",
    "webhook.example": "Request example",
    "webhook.local":
      "This address belongs to your runtime. A remote service needs a securely reachable runtime address; never expose an unauthenticated local port.",
    "webhook.privacy":
      "Credentials stay in the local credential store and are never sent to the model.",
    "webhook.details":
      "Connect your own service, script or automation. Each account has its own request URL, credential, sender policy and conversation routing. Messages with the same conversation value share a session; repeated message IDs are deduplicated within that account.",
    "webhook.failed":
      "Could not save the connection. Check the reply URL and try again.",
  },
  "zh-CN": {
    "webhook.back": "选择连接器",
    "webhook.close": "关闭",
    "webhook.title": "接入自定义服务",
    "webhook.description":
      "通过 HTTP 接收消息，也可以将智能体回复发送回你的服务。",
    "webhook.callback": "回复地址",
    "webhook.callbackHint":
      "选填。远程地址须使用 HTTPS，仅本机回环地址允许 HTTP。",
    "webhook.senders": "允许的发送者",
    "webhook.sendersHint":
      "多个 ID 用逗号分隔。留空时，持有凭证的发送者均可访问。",
    "webhook.create": "创建连接",
    "webhook.done": "完成",
    "webhook.endpoint": "请求地址",
    "webhook.token": "Bearer 访问凭证",
    "webhook.once":
      "请现在复制凭证，关闭后不再显示。需要时可以在这里重新生成。",
    "webhook.rotate": "重新生成凭证",
    "webhook.rotateHint": "生成后，原凭证立即失效。",
    "webhook.save": "保存设置",
    "webhook.copy": "复制",
    "webhook.copied": "已复制",
    "webhook.example": "请求示例",
    "webhook.local":
      "这是当前运行实例的地址。远程服务需要安全可达的运行实例地址，请勿直接暴露未受保护的本机端口。",
    "webhook.privacy": "凭证只保存在本机凭据库，不会发送给模型。",
    "webhook.details":
      "连接你自己的服务、脚本或自动化。每个连接都有独立的请求地址、访问凭证、发送者限制和会话映射。相同 conversation 的消息进入同一会话；同一连接内重复的消息 ID 不会被重复处理。",
    "webhook.failed": "保存连接失败，请检查回复地址后重试。",
  },
};
