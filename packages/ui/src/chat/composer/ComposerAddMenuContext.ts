import { createContext, type Context } from "react";
import type { MenuItem } from "./providers/types";

// The editor and the official overlay can be rendered from separate plugin
// bundles. Share the context identity across those bundles, while each
// Composer provider keeps its own actions isolated in the React tree.
const key = Symbol.for("amiba.composer.add-menu-context.v1");
const realm = globalThis as typeof globalThis & { [key]?: Context<readonly MenuItem[]> };
export const ComposerAddMenuContext = realm[key] ??= createContext<readonly MenuItem[]>([]);
