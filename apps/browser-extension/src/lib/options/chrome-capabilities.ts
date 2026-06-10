import type {
  BridgeCapability,
  OptionsCapabilities,
  UserScriptCapability,
} from "@amiba/ui";

export const chromeBridgeCapability: BridgeCapability = {
  async refresh(): Promise<void> {
    await chrome.runtime.sendMessage({ action: "bridge.refresh" });
  },
};

export const chromeUserScriptCapability: UserScriptCapability = {
  async list() {
    const r = (await chrome.runtime.sendMessage({ action: "userscript.list" })) as {
      ok?: boolean;
      scripts?: unknown[];
    };
    return {
      scripts: Array.isArray(r?.scripts) ? (r.scripts as never) : [],
    };
  },
  async get(id) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.get",
      id,
    })) as { ok?: boolean; script?: unknown };
    return { script: (r?.ok && r.script ? (r.script as never) : null) };
  },
  async setEnabled(id, enabled) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.setEnabled",
      id,
      enabled,
    })) as { ok?: boolean; error?: string };
    return { ok: !!r?.ok, error: r?.error };
  },
  async remove(id) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.remove",
      id,
    })) as { ok?: boolean; error?: string };
    return { ok: !!r?.ok, error: r?.error };
  },
  async save({ id, source }) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.save",
      id,
      source,
    })) as { ok?: boolean; id?: string; error?: string };
    return { ok: !!r?.ok, id: r?.id, error: r?.error };
  },
  async installFromSource(source) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.installFromSource",
      source,
      enabled: true,
    })) as { ok?: boolean; id?: string; error?: string };
    return { ok: !!r?.ok, id: r?.id, error: r?.error };
  },
  async installFromUrl(url) {
    const r = (await chrome.runtime.sendMessage({
      action: "userscript.installFromUrl",
      url,
      enabled: true,
    })) as { ok?: boolean; id?: string; error?: string };
    return { ok: !!r?.ok, id: r?.id, error: r?.error };
  },
};

export const chromeOptionsCapabilities: OptionsCapabilities = {
  bridge: chromeBridgeCapability,
  userscripts: chromeUserScriptCapability,
};
