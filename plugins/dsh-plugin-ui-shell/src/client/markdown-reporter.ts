import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { MarkdownCapabilities } from "@amiba/markdown";
import type {} from "../markdown-remote.js";

/** The namespace is a separate Cordis service, mounted after shell startup. */
export async function createMarkdownReporter(ctx: ClientContext) {
  let report: ((sessionId: string, capabilities: MarkdownCapabilities[]) => Promise<void>) | undefined;
  await ctx.inject(["remote.amibaMarkdown"], child => {
    report = async (sessionId, capabilities) => {
      const result = await child.remote.amibaMarkdown.report(sessionId, capabilities);
      if (!result.ok) throw new Error(`Markdown capability report failed: ${JSON.stringify(result.error)}`);
    };
    return () => { report = undefined; };
  });
  return async (sessionId: string, capabilities: MarkdownCapabilities[]) => {
    if (!report) throw new Error("Markdown capability service is unavailable");
    await report(sessionId, capabilities);
  };
}
