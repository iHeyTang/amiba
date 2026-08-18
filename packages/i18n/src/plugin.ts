import { useEffect, useMemo, useState } from "react";

import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

export type PluginLanguage = "en" | "zh-CN";
export type PluginTranslateFn = (
  key: MessageKey,
  params?: Record<string, unknown>,
) => string;

const CATALOG: Record<PluginLanguage, Record<string, string>> = {
  en: { ...en },
  "zh-CN": { ...zhCN },
};

function currentLanguage(): PluginLanguage {
  const declared = document.documentElement.lang.toLowerCase();
  if (declared.startsWith("zh")) return "zh-CN";
  if (declared.startsWith("en")) return "en";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function interpolate(template: string, params?: Record<string, unknown>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

/**
 * Client-safe locale hook for DSH plugins.
 *
 * It intentionally observes only the document-level language contract. This
 * keeps browser plugins independent from Electron and from Amiba's React root
 * while still following the language selected in Appearance settings.
 */
export function usePluginT(): {
  t: PluginTranslateFn;
  language: PluginLanguage;
} {
  const [language, setLanguage] = useState<PluginLanguage>(currentLanguage);

  useEffect(() => {
    const observer = new MutationObserver(() => setLanguage(currentLanguage()));
    observer.observe(document.documentElement, {
      attributeFilter: ["lang"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);

  const t = useMemo<PluginTranslateFn>(() => {
    const catalog = CATALOG[language] ?? en;
    return (key, params) => {
      const template = catalog[key] ?? en[key] ?? key;
      return interpolate(template, params);
    };
  }, [language]);

  return { t, language };
}

export type { MessageKey } from "./en";
