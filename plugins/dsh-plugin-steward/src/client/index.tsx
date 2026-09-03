import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

export const name = "amiba-steward-ui";
export const inject: string[] = [];

export async function apply(_ctx: ClientContext): Promise<() => Promise<void>> {
  return async () => {};
}
