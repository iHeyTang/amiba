import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LarkConnectFlow } from "../LarkConnectFlow.js";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";
import type { LarkPersonalRemote } from "../../personal-remote.js";
vi.mock("../LarkWizard.js", () => ({
  LarkWizard: ({ host }: any) => (
    <button
      onClick={() =>
        host.done({ id: "created", enabled: true, status: { state: "ready" } })
      }
    >
      Complete message connection
    </button>
  ),
}));
vi.mock("../LarkPersonalSettings.js", () => ({
  LarkPersonalSettings: ({ host, onDone }: any) => (
    <button onClick={onDone}>Finish documents for {host.connect.id}</button>
  ),
}));
it("keeps creation and document setup in one flow without finishing early", () => {
  const done = vi.fn();
  const host = {
    done,
    adapter: {},
    presets: [],
  } as unknown as ConnectWizardHost;
  render(<LarkConnectFlow host={host} remote={{} as LarkPersonalRemote} />);
  fireEvent.click(screen.getByText("Complete message connection"));
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Finish documents for created"));
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: "created" }));
});
it("allows an explicit messaging-only completion without creating another account", () => {
  const done = vi.fn();
  const host = {
    done,
    adapter: {},
    presets: [],
  } as unknown as ConnectWizardHost;
  render(<LarkConnectFlow host={host} remote={{} as LarkPersonalRemote} />);
  fireEvent.click(screen.getByText("Complete message connection"));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Use messaging first; connect documents later",
    }),
  );
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: "created" }));
});
