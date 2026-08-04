import type { MessageKey } from "@amiba/i18n";

export type PostSetupKind = "configure" | "connect" | "install";

export interface PostSetupInfo {
  descriptionKey: MessageKey;
  detailKeys: MessageKey[];
  kind: PostSetupKind;
  noteKey?: MessageKey;
  titleKey: MessageKey;
}

const POST_SETUP_INFO: Record<string, PostSetupInfo> = {
  agent_browser: {
    kind: "install",
    titleKey: "tools.detail.setup.info.agentBrowser.title",
    descriptionKey: "tools.detail.setup.info.agentBrowser.description",
    detailKeys: [
      "tools.detail.setup.info.agentBrowser.detail.cli",
      "tools.detail.setup.info.agentBrowser.detail.chromium",
      "tools.detail.setup.info.agentBrowser.detail.session",
    ],
    noteKey: "tools.detail.setup.info.agentBrowser.note",
  },
  browserbase: {
    kind: "install",
    titleKey: "tools.detail.setup.info.cloudBrowser.title",
    descriptionKey: "tools.detail.setup.info.cloudBrowser.description",
    detailKeys: [
      "tools.detail.setup.info.cloudBrowser.detail.cli",
      "tools.detail.setup.info.cloudBrowser.detail.hosted",
    ],
  },
  camofox: {
    kind: "install",
    titleKey: "tools.detail.setup.info.camofox.title",
    descriptionKey: "tools.detail.setup.info.camofox.description",
    detailKeys: [
      "tools.detail.setup.info.camofox.detail.package",
      "tools.detail.setup.info.camofox.detail.engine",
      "tools.detail.setup.info.camofox.detail.service",
    ],
  },
  cua_driver: {
    kind: "install",
    titleKey: "tools.detail.setup.info.cuaDriver.title",
    descriptionKey: "tools.detail.setup.info.cuaDriver.description",
    detailKeys: [
      "tools.detail.setup.info.cuaDriver.detail.installer",
      "tools.detail.setup.info.cuaDriver.detail.process",
      "tools.detail.setup.info.cuaDriver.detail.permissions",
    ],
  },
  faster_whisper: {
    kind: "install",
    titleKey: "tools.detail.setup.info.fasterWhisper.title",
    descriptionKey: "tools.detail.setup.info.fasterWhisper.description",
    detailKeys: [
      "tools.detail.setup.info.fasterWhisper.detail.package",
      "tools.detail.setup.info.fasterWhisper.detail.model",
      "tools.detail.setup.info.fasterWhisper.detail.local",
    ],
  },
  kittentts: {
    kind: "install",
    titleKey: "tools.detail.setup.info.kittenTts.title",
    descriptionKey: "tools.detail.setup.info.kittenTts.description",
    detailKeys: [
      "tools.detail.setup.info.kittenTts.detail.package",
      "tools.detail.setup.info.kittenTts.detail.model",
      "tools.detail.setup.info.kittenTts.detail.local",
    ],
  },
  piper: {
    kind: "install",
    titleKey: "tools.detail.setup.info.piper.title",
    descriptionKey: "tools.detail.setup.info.piper.description",
    detailKeys: [
      "tools.detail.setup.info.piper.detail.package",
      "tools.detail.setup.info.piper.detail.voice",
      "tools.detail.setup.info.piper.detail.local",
    ],
  },
  ddgs: {
    kind: "install",
    titleKey: "tools.detail.setup.info.ddgs.title",
    descriptionKey: "tools.detail.setup.info.ddgs.description",
    detailKeys: [
      "tools.detail.setup.info.ddgs.detail.package",
      "tools.detail.setup.info.ddgs.detail.scope",
      "tools.detail.setup.info.ddgs.detail.limits",
    ],
  },
  spotify: {
    kind: "connect",
    titleKey: "tools.detail.setup.info.spotify.title",
    descriptionKey: "tools.detail.setup.info.spotify.description",
    detailKeys: [
      "tools.detail.setup.info.spotify.detail.browser",
      "tools.detail.setup.info.spotify.detail.client",
      "tools.detail.setup.info.spotify.detail.storage",
    ],
  },
  langfuse: {
    kind: "configure",
    titleKey: "tools.detail.setup.info.langfuse.title",
    descriptionKey: "tools.detail.setup.info.langfuse.description",
    detailKeys: [
      "tools.detail.setup.info.langfuse.detail.sdk",
      "tools.detail.setup.info.langfuse.detail.plugin",
      "tools.detail.setup.info.langfuse.detail.restart",
    ],
  },
  xai_grok: {
    kind: "connect",
    titleKey: "tools.detail.setup.info.xaiGrok.title",
    descriptionKey: "tools.detail.setup.info.xaiGrok.description",
    detailKeys: [
      "tools.detail.setup.info.xaiGrok.detail.oauth",
      "tools.detail.setup.info.xaiGrok.detail.key",
      "tools.detail.setup.info.xaiGrok.detail.install",
    ],
  },
};

const FALLBACK_POST_SETUP_INFO: PostSetupInfo = {
  kind: "configure",
  titleKey: "tools.detail.setup.info.unknown.title",
  descriptionKey: "tools.detail.setup.info.unknown.description",
  detailKeys: ["tools.detail.setup.info.unknown.detail"],
};

export function getPostSetupInfo(setupKey: string): PostSetupInfo {
  return POST_SETUP_INFO[setupKey] ?? FALLBACK_POST_SETUP_INFO;
}

export const knownPostSetupKeys = Object.freeze(Object.keys(POST_SETUP_INFO));
