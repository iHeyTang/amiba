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
 */
export * from "./primitives"
export * from "./theme"
export * from "./models"
export * from "./chat"
export * from "./home"
export * from "./settings"
export * from "./skills"
export * from "./usage"
export * from "./viz"
export { PaneHeaderBar, type PaneHeaderBarProps } from "./navigation/PaneHeaderBar";
