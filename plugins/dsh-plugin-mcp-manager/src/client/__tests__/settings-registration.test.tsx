import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { expect, it, vi } from "vitest";
import { apply } from "../index";

it("registers independent MCP settings and keeps authorization in Connections", async () => {
  const registrations: Array<{ name: string; id: string; children?: unknown }> = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const disposeRemote = vi.fn();
  const context = {
    remote: { $mount: vi.fn().mockResolvedValue(disposeRemote), amibaMcp: {} },
    layout: { openSettings: vi.fn() },
    slots: {
      inject: (_slot: string, callback: () => unknown) => callback(),
      register: (entry: (typeof registrations)[number]) => {
        registrations.push(entry);
        const dispose = vi.fn();
        disposers.push(dispose);
        return dispose;
      },
    },
    inject: (_services: string[], callback: (ctx: unknown) => () => void) => {
      const dispose = callback(context);
      return Object.assign(Promise.resolve(), { dispose });
    },
  };
  const dispose = await apply(context as unknown as ClientContext);
  expect(registrations.map(({ name, id }) => [name, id])).toEqual([
    ["amiba.connection.access", "mcp"],
    ["settings.section", "mcp"],
  ]);
  await dispose();
  for (const cleanup of disposers) expect(cleanup).toHaveBeenCalledOnce();
  expect(disposeRemote).toHaveBeenCalledOnce();
});
