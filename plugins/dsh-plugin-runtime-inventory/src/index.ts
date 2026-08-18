import type { Context } from "@deepseek-ai/cordis";

/**
 * Amiba plugin-management presentation module. Live state remains owned by
 * @deepseek-ai/dsh-host-plugin-inventory. The Client may additionally call
 * Amiba's narrow native process boundary, which delegates every mutation to
 * the official `dsh plugin --profile web` command before restarting DSH.
 */
export const name = "amiba-runtime-inventory";
export const inject: string[] = [];

export function apply(_ctx: Context): void {}
