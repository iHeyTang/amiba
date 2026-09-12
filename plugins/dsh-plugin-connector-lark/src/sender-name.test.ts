import { afterEach, expect, it, vi } from "vitest";
import { createSenderNameResolver } from "./sender-name.js";
afterEach(() => vi.useRealTimers());

it("coalesces profile requests and refreshes cached names after expiry", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue(" 张三 ");
  const resolve = createSenderNameResolver(load);
  expect(await Promise.all([resolve("ou_1"), resolve("ou_1")])).toEqual(["张三", "张三"]);
  expect(load).toHaveBeenCalledOnce();
  load.mockResolvedValue("新名字");
  expect(await resolve("ou_1")).toBe("张三");
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(await resolve("ou_1")).toBe("新名字");
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds lookup delays, caches failures briefly, and can recover after permission changes", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockImplementation(() => new Promise(() => {}));
  const resolve = createSenderNameResolver(load);
  const pending = resolve("ou_1");
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toBeUndefined();
  load.mockResolvedValue("张三");
  expect(await resolve("ou_1")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await resolve("ou_1")).toBe("张三");
  expect(vi.getTimerCount()).toBe(0);
});
it("does not share names between separately connected applications", async () => {
  const one = createSenderNameResolver(async () => "张三");
  const two = createSenderNameResolver(async () => "李四");
  expect(await one("same-id")).toBe("张三");
  expect(await two("same-id")).toBe("李四");
});
