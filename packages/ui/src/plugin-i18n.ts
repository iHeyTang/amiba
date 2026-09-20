/**
 * Narrow plugin entry: translation helpers only.
 *
 * `@amiba/ui/plugin` is the plugin-facing barrel, and it re-exports the chat
 * surfaces (`chat/bubble/*`, `chat/ComposerDockSheet`, …) alongside these
 * helpers. Those re-exports reach `@amiba/markdown` → `streamdown`, whose own
 * `mermaid` chunk is ~1 MB. A window that only needs a translated label — the
 * standalone desktop pet window is the extreme case — therefore paid for
 * markdown, Mermaid, KaTeX and Shiki on its first paint, because a barrel's
 * unused re-exports cannot be dropped while the package declares no
 * `sideEffects` map.
 *
 * Import from `@amiba/ui/plugin/i18n` when the only thing you need is `t`.
 */
export {
  usePluginT,
  type MessageKey,
  type PluginCatalogOverlay,
  type PluginLanguage,
  type PluginTranslateFn,
} from "@amiba/i18n/plugin";
