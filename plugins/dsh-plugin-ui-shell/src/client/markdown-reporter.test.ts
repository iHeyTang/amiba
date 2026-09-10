import { Context, Service } from "@deepseek-ai/cordis";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { expect, it, vi } from "vitest";
import { createMarkdownReporter } from "./markdown-reporter.js";

it("uses the mounted namespace's Cordis scope and propagates report failures", async () => {
  const root = new Context();
  const call = vi.fn().mockResolvedValue({ ok: true });
  class Remote extends Service { constructor(ctx: Context) { super(ctx, "remote"); } }
  class Namespace extends Service {
    report = call;
    constructor(ctx: Context) { super(ctx, "remote.amibaMarkdown"); }
  }
  const remote = await root.plugin(Remote);
  const namespace = await root.plugin(Namespace);
  let report!: Awaited<ReturnType<typeof createMarkdownReporter>>;
  const shell = await root.inject(["remote"], async ctx => {
    // This is the former shell call: mounting alone does not authorize access.
    expect(() => (ctx as unknown as ClientContext).remote.amibaMarkdown).toThrow('without inject');
    report = await createMarkdownReporter(ctx as unknown as ClientContext);
  });
  try {
    const capabilities = [{ id: "chart", version: "1", languages: ["chart"] }];
    await report("session-one", capabilities);
    expect(call).toHaveBeenCalledWith("session-one", capabilities);
    call.mockResolvedValueOnce({ ok: false, error: { message: "Unavailable" } });
    await expect(report("session-one", [])).rejects.toThrow("Unavailable");
    await namespace.dispose();
    await expect(report("session-one", [])).rejects.toThrow("unavailable");
  } finally {
    await shell.dispose();
    await namespace.dispose();
    await remote.dispose();
  }
});
