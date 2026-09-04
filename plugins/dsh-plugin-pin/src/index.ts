import type { Context } from "@deepseek-ai/cordis";

export const name = "amiba-pin";

/**
 * The Host half intentionally owns no logic: session pinning is a purely
 * client-side, per-device preference (a set of session ids under the
 * platform storage key `pin.sessionIds` — see `src/client/state.ts`). This
 * entry only lets DSH discover the package's `dsh.client` declaration and
 * serve the browser bundle as a normal DSH plugin (the `dsh-plugin-ui-shell`
 * / `dsh-plugin-agent-preset` precedent).
 */
export function apply(_ctx: Context): void {}
