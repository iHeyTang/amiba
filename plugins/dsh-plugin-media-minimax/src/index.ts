import type { Context } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-media";
import { MiniMaxMediaProvider } from "./adapter.js";
import { minimaxConnection } from "./connection.js";
export const name = "amiba-media-minimax";
export const inject = ["llm", "settings", "credentials"];
export function apply(ctx: Context) {
  return ctx.inject(["amibaMedia"], (child) => {
    let dispose: (() => void) | undefined;
    const sync = () => {
      const active = child.llm
        .listProviders()
        .some((p) => p.id === "minimax-cn");
      if (active && !dispose)
        dispose = child.amibaMedia.registerProvider(
          new MiniMaxMediaProvider(() => minimaxConnection(child)),
        );
      if (!active && dispose) {
        dispose();
        dispose = undefined;
      }
    };
    sync();
    child.on("llm/adapters-updated", sync);
    return () => dispose?.();
  });
}
