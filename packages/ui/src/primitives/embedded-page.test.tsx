import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmbeddedPage } from "./embedded-page";

describe("native embedded management page", () => {
  it("reports an unavailable desktop host without opening a browser", async () => {
    const open = vi.spyOn(window, "open");
    const view = render(<EmbeddedPage url="http://127.0.0.1:18801/" title="Memory" loadingLabel="Loading" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("requires the Amiba desktop app");
    expect(open).not.toHaveBeenCalled();
    view.unmount();
    open.mockRestore();
  });

  it("mounts one native page and releases it on settings navigation", async () => {
    const requests: Array<{ action: string; id: string; url?: string }> = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      requests.push(detail.request);
      detail.accepted = true;
      detail.respond();
    };
    window.addEventListener("amiba:embedded-page", listener);
    try {
      const view = render(<EmbeddedPage url="http://127.0.0.1:18801/" title="Memory" loadingLabel="Loading" />);
      await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
      expect(requests[0]).toMatchObject({ action: "mount", url: "http://127.0.0.1:18801/" });
      expect(document.querySelector("iframe")).toBeNull();
      view.unmount();
      expect(requests.at(-1)).toEqual({ action: "unmount", id: requests[0].id });
    } finally { window.removeEventListener("amiba:embedded-page", listener); }
  });

  it("releases a pending load and ignores its late completion", async () => {
    const requests: Array<{ action: string; id: string }> = [];
    let complete: (() => void) | undefined;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      detail.accepted = true;
      requests.push(detail.request);
      if (detail.request.action === "mount") complete = detail.respond;
      else detail.respond();
    };
    window.addEventListener("amiba:embedded-page", listener);
    try {
      const view = render(<EmbeddedPage url="http://127.0.0.1:18801/" title="Memory" loadingLabel="Loading" />);
      view.unmount();
      complete?.();
      await Promise.resolve();
      expect(requests.map(r => r.action)).toEqual(["mount", "unmount"]);
    } finally { window.removeEventListener("amiba:embedded-page", listener); }
  });
});
