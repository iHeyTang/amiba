import { describe, expect, it, vi } from "vitest";
import { MemoryCorrections } from "./correction.js";
import type { MemosDashboardService } from "./dashboard-service.js";
function setup() {
  const service = {
    detail: vi.fn().mockResolvedValue({ entry: { title: "A memory" } }),
    update: vi.fn().mockResolvedValue({ id: "one", title: "Corrected" }),
  };
  let now = 1000;
  const corrections = new MemoryCorrections(
    service as unknown as MemosDashboardService,
    () => now,
  );
  return {
    service,
    corrections,
    expire: () => {
      now += 31 * 60_000;
    },
  };
}
const input = {
  kind: "policies" as const,
  id: "one",
  session: "memos_sess=private-cookie",
  language: "zh" as const,
};
const ticketFrom = (prompt: string) =>
  JSON.parse(prompt.split("\n").at(-1)!).ticket as string;
describe("agent memory correction", () => {
  it("hands off one record without disclosing the Viewer session and only writes on explicit tool edits", async () => {
    const { service, corrections } = setup();
    const prompt = await corrections.begin(input);
    expect(prompt).not.toContain(input.session);
    const ticket = ticketFrom(prompt);
    await corrections.execute({ ticket });
    expect(service.update).not.toHaveBeenCalled();
    await corrections.execute({ ticket, title: "Corrected" });
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "policies",
        id: "one",
        session: input.session,
        action: "correct",
        title: "Corrected",
      }),
    );
    await expect(
      corrections.execute({ ticket, title: "Again" }),
    ).rejects.toThrow("expired");
  });
  it("rejects attempts to target another record and expired authorizations", async () => {
    const { corrections, service, expire } = setup();
    const ticket = ticketFrom(await corrections.begin(input));
    await expect(
      corrections.execute({ ticket, id: "another", title: "Wrong target" }),
    ).rejects.toThrow();
    expire();
    await expect(
      corrections.execute({ ticket, title: "Expired" }),
    ).rejects.toThrow("expired");
    expect(service.update).not.toHaveBeenCalled();
  });
  it("does not grant access when the current session cannot read the memory", async () => {
    const { corrections, service } = setup();
    service.detail.mockRejectedValue(new Error("MEMOS_AUTH_REQUIRED"));
    await expect(corrections.begin(input)).rejects.toThrow(
      "MEMOS_AUTH_REQUIRED",
    );
  });
});
