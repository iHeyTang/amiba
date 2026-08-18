import type { Context } from "@deepseek-ai/cordis";

export const name = "amiba-ui-shell";

/**
 * The Host half intentionally owns no UI. Its presence lets DSH discover the
 * package's `dsh.client` declaration and serve the browser bundle as a normal
 * DSH plugin. Electron remains a platform host, not a reverse plugin source.
 */
export function apply(_ctx: Context): void {}
