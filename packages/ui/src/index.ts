/**
 * Amiba UI — single barrel for every renderer-side concern.
 *
 * Organised into domain folders under ``src/``:
 *   - ``primitives/`` — shadcn-style atoms (Button, Input, Select, …) +
 *                       the Amiba-branded logo
 *   - ``theme/``      — theme preference + resolution hooks (light/dark/auto)
 *   - ``models/``     — model identity helpers and provider-aware icon rendering
 *   - ``chat/``       — chat surface (Composer, MessageList, ChatSurface, …)
 *   - ``home/``       — Home page (composer hand-off, recents, shortcuts)
 *   - ``settings/``   — settings panes (DSH models, skills, memory, …)
 *
 * Internally each folder owns a barrel (``./<folder>/index.ts``); this
 * root re-exports the lot so consumers always say
 * ``import { … } from "@amiba/ui"`` regardless of which domain a
 * symbol comes from. Tree-shaking handles the unused branches.
 *
 * ``./locales`` is deliberately NOT re-exported here. It is its own entry
 * point (``@amiba/ui/locales``) because the dictionary must not be reachable
 * from the component graph — see that folder's header. The line below is the
 * one thing this barrel takes from it, and it is ``import type``: the key
 * union, so ``t("…")`` stays typo-checked wherever ``@amiba/ui`` is on the
 * program. It is erased before any bundler sees it.
 */
import type {} from "./locales/keys";

export * from "./primitives";
export * from "./theme";
export * from "./time-format";
export * from "./models";
export * from "./chat";
export * from "./home";
export * from "./settings";
export * from "./viz";
export {
  PaneHeaderBar,
  type PaneHeaderBarProps,
} from "./navigation/PaneHeaderBar";

export * from "./directory-chooser";

// Native session state shared with the product shell's standard input adapter.
export { sessionComposerDraft } from "./chat/composer-draft-store";

export { TranscriptScrollPositionContext } from "./chat/transcript-scroll-position";
