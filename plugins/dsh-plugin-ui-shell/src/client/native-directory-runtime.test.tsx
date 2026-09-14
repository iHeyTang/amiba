// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import React, { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bundle = readFileSync(
  "node_modules/@deepseek-ai/dsh-client-ui-directory-picker-native/lib/client.js",
  "utf8",
);
const start = bundle.indexOf("function NativeDirectoryFlow(props)");
const end = bundle.indexOf("\n\t\t//#endregion", start);
if (start < 0 || end < 0)
  throw new Error("Native directory component not found");
const Flow = Function(
  "react",
  `${bundle.slice(start, end)};return NativeDirectoryFlow`,
)(React);
const callbacks = () => ({
  onPicked: vi.fn(),
  onCancel: vi.fn(),
  onError: vi.fn(),
});
function deferred() {
  let resolve!: (path: string | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string | null>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
afterEach(cleanup);
describe("actual native directory picker component", () => {
  it.each(["picked", "cancelled", "failed"])(
    "ignores an old %s result after close and reopen",
    async (outcome) => {
      const old = deferred(),
        next = deferred();
      const pick = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      const first = callbacks(),
        second = callbacks();
      const view = render(<Flow open busy={false} pick={pick} {...first} />);
      await act(async () => {});
      view.rerender(<Flow open={false} busy={false} pick={pick} {...first} />);
      view.rerender(<Flow open busy={false} pick={pick} {...second} />);
      await act(async () => {
        if (outcome === "failed") old.reject(new Error("old failure"));
        else old.resolve(outcome === "picked" ? "/old" : null);
      });
      for (const callback of [
        ...Object.values(first),
        ...Object.values(second),
      ])
        expect(callback).not.toHaveBeenCalled();
      await act(async () => {
        next.resolve("/new");
      });
      expect(second.onPicked).toHaveBeenCalledWith("/new");
      expect(pick).toHaveBeenCalledTimes(2);
    },
  );
  it("starts only one chooser in StrictMode and keeps the original request callbacks during adoption", async () => {
    const pending = deferred(),
      first = callbacks(),
      replacement = callbacks();
    const pick = vi.fn(() => pending.promise);
    const view = render(
      <StrictMode>
        <Flow open busy={false} pick={pick} {...first} />
      </StrictMode>,
    );
    await act(async () => {});
    view.rerender(
      <StrictMode>
        <Flow open busy pick={() => pending.promise} {...replacement} />
      </StrictMode>,
    );
    await act(async () => {
      pending.resolve("/chosen");
    });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(first.onPicked).toHaveBeenCalledWith("/chosen");
    expect(replacement.onPicked).not.toHaveBeenCalled();
  });
  it("ignores results after unmount", async () => {
    const pending = deferred(),
      owner = callbacks();
    const view = render(
      <Flow open busy={false} pick={() => pending.promise} {...owner} />,
    );
    await act(async () => {});
    view.unmount();
    await act(async () => {
      pending.resolve("/late");
    });
    for (const callback of Object.values(owner))
      expect(callback).not.toHaveBeenCalled();
  });
  it("reports synchronous picker failure through the owner error callback", async () => {
    const owner = callbacks();
    render(
      <Flow
        open
        busy={false}
        pick={() => {
          throw new Error("unavailable");
        }}
        {...owner}
      />,
    );
    await act(async () => {});
    expect(owner.onError).toHaveBeenCalledWith("unavailable");
  });
});

it("uses an embedding shell's native chooser when supplied", async () => {
  const owner = callbacks();
  const pick = vi.fn(),
    native = vi.fn().mockResolvedValue("/local");
  render(
    <Flow
      open
      busy={false}
      pick={pick}
      amibaNativePicker={native}
      {...owner}
    />,
  );
  await act(async () => {});
  expect(native).toHaveBeenCalledTimes(1);
  expect(pick).not.toHaveBeenCalled();
  expect(owner.onPicked).toHaveBeenCalledWith("/local");
});
