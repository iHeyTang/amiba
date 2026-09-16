import { usePluginT } from "@amiba/i18n/plugin";

export const browserMessages = {
  en: {
    "embeddedBrowser.title": "Browser",
    "embeddedBrowser.open": "Open browser",
    "embeddedBrowser.close": "Close browser",
    "embeddedBrowser.newTab": "New tab",
    "embeddedBrowser.back": "Back",
    "embeddedBrowser.forward": "Forward",
    "embeddedBrowser.stop": "Stop loading",
    "embeddedBrowser.addressPlaceholder": "Type a URL",
    "embeddedBrowser.openExternal": "Open in default browser",
    "embeddedBrowser.emptyTitle": "Browse and verify",
    "embeddedBrowser.emptyDescription":
      "Amiba can browse, click, type, and take screenshots here. Enter a URL above to start.",
    "embeddedBrowser.previewPrompt": "Preview your app instead?",
    "embeddedBrowser.detectDevServer": "Detect dev server",
    "embeddedBrowser.detecting": "Detecting…",
    "embeddedBrowser.noDevServer": "No local dev server detected",
    "embeddedBrowser.agentOperating": "Agent is browsing",
    "embeddedBrowser.summary.empty": "No open tabs",
    "embeddedBrowser.summary.expand": "Show all tabs",
    "embeddedBrowser.summary.collapse": "Show less",
  },
  "zh-CN": {
    "embeddedBrowser.title": "浏览器",
    "embeddedBrowser.open": "打开浏览器",
    "embeddedBrowser.close": "关闭浏览器",
    "embeddedBrowser.newTab": "新标签页",
    "embeddedBrowser.back": "后退",
    "embeddedBrowser.forward": "前进",
    "embeddedBrowser.stop": "停止加载",
    "embeddedBrowser.addressPlaceholder": "输入网址",
    "embeddedBrowser.openExternal": "在默认浏览器中打开",
    "embeddedBrowser.emptyTitle": "浏览和验证",
    "embeddedBrowser.emptyDescription":
      "Amiba 可以在这里浏览、点击、输入和截图。在上方输入网址即可开始。",
    "embeddedBrowser.previewPrompt": "要预览正在开发的页面？",
    "embeddedBrowser.detectDevServer": "检测开发服务器",
    "embeddedBrowser.detecting": "正在检测…",
    "embeddedBrowser.noDevServer": "没有检测到本地开发服务器",
    "embeddedBrowser.agentOperating": "Agent 正在操作",
    "embeddedBrowser.summary.empty": "暂无标签页",
    "embeddedBrowser.summary.expand": "展开全部标签页",
    "embeddedBrowser.summary.collapse": "收起",
  },
};
export const useBrowserT = () => usePluginT(browserMessages);
