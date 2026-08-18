import type { Context } from "@deepseek-ai/cordis";

export const name = "amiba-agent-preset";

/**
 * The Host half intentionally owns no logic: agent-preset DATA stays
 * engine-native (the official `@deepseek-ai/dsh-agent-presets` host row and
 * its `agentPreset.*` wire face). This entry only lets DSH discover the
 * package's `dsh.client` declaration and serve the browser bundle as a
 * normal DSH plugin (the `dsh-plugin-ui-shell` precedent).
 */
export function apply(_ctx: Context): void {}
