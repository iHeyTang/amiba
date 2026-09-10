import { afterEach, describe, expect, it, vi } from "vitest";
import { createCronSessionGroup } from "./session-group.js";

afterEach(() => vi.useRealTimers());

describe("cron sidebar group", () => {
  it("refreshes membership, retains it on failure, and disposes subscriptions and timers", async () => {
    vi.useFakeTimers();
    const classify = vi.fn().mockResolvedValue(["old", "new"]);
    const group = createCronSessionGroup(classify);
    for (const id of ["old", "new", "ordinary"]) group.face.claim({ id, title: "" });
    const notify = vi.fn();
    group.face.subscribe!(notify);
    await vi.advanceTimersByTimeAsync(0);
    expect(group.face.claim({ id: "old", title: "renamed" })).toBe(true);
    expect(group.face.claim({ id: "ordinary", title: "daily digest" })).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    classify.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(15000);
    expect(group.face.claim({ id: "old", title: "" })).toBe(true);
    classify.mockResolvedValue(["new"]);
    await vi.advanceTimersByTimeAsync(15000);
    expect(group.face.claim({ id: "old", title: "" })).toBe(false);
    group.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
