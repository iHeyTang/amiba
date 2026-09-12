import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DingtalkPersonalSettings } from "../DingtalkPersonalSettings.js";
import type { DingtalkPersonalRemote } from "../../personal-remote.js";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
vi.mock("@amiba/ui/plugin", () => ({
  usePluginT: (catalog: any) => ({
    t: (key: string) => catalog.en[key] ?? key,
  }),
  Button: ({ asChild, children, ...props }: any) =>
    asChild ? children : <button {...props}>{children}</button>,
  Switch: ({ onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      aria-label="AI access"
      {...props}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}));
const capabilities = [
  "dingtalk:documents:search",
  "dingtalk:documents:read",
].map((id) => ({ id, available: true }));
const unauthorized = {
  access: { identity: "application", state: "unauthorized", capabilities: [] },
  modelAccess: false,
};
const authorized = (modelAccess = false) => ({
  access: {
    identity: "user",
    state: "authorized",
    label: "Alice",
    capabilities,
  },
  modelAccess,
  work: modelAccess ? "ready" : "unavailable",
});
const host = {
  connect: { id: "a", enabled: true, status: { state: "ready" } },
  settings: {},
  save: vi.fn(),
} as unknown as ConnectSettingsHost;
const flow = {
  id: "f",
  connectionId: "a",
  state: "pending",
  verificationUrl: "https://example.com/authorize",
  userCode: "123",
  expiresAt: 999999,
};
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function fixture(initial: any = unauthorized) {
  let status = initial;
  const manage = vi.fn(async (input: any) => {
    if (input.action === "begin")
      return { ok: true, value: { authorization: flow } };
    if (input.action === "poll") {
      status = authorized();
      return {
        ok: true,
        value: { authorization: { ...flow, state: "completed" } },
      };
    }
    if (input.action === "complete-connection") status = authorized(true);
    return { ok: true, value: { status } };
  });
  const remote = { manage } as unknown as DingtalkPersonalRemote;
  return { manage, remote };
}
describe("Dingtalk connection experience", () => {
  it("opening existing settings preserves the user's paused AI access", async () => {
    vi.useFakeTimers();
    const h = fixture(authorized());
    render(<DingtalkPersonalSettings host={host} remote={h.remote} />);
    await flush();
    expect(
      screen.getByRole("button", { name: "Complete connection and enable AI" }),
    ).toBeInTheDocument();
    expect(h.manage.mock.calls.map((c) => c[0].action)).toEqual(["status"]);
  });
  it("one explicit continuation enables AI after scanning, without a second switch", async () => {
    vi.useFakeTimers();
    const h = fixture();
    render(<DingtalkPersonalSettings host={host} remote={h.remote} />);
    await flush();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete connection and enable AI",
      }),
    );
    await flush();
    expect(
      h.manage.mock.calls.some((c) => c[0].action === "complete-connection"),
    ).toBe(false);
    await flush(5000);
    expect(h.manage).toHaveBeenCalledWith({
      action: "complete-connection",
      connectionId: "a",
    });
    expect(
      screen.getByText("AI can now find and summarize your documents"),
    ).toBeInTheDocument();
  });
  it("resumes a previously authorized account without another scan", async () => {
    vi.useFakeTimers();
    const h = fixture(authorized());
    render(<DingtalkPersonalSettings host={host} remote={h.remote} />);
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: "Complete connection and enable AI" }),
    );
    await flush();
    expect(h.manage.mock.calls.some((c) => c[0].action === "begin")).toBe(
      false,
    );
    expect(
      screen.getByText("AI can now find and summarize your documents"),
    ).toBeInTheDocument();
  });
  it("does not present partial platform permissions as ready", async () => {
    vi.useFakeTimers();
    const value = authorized(true);
    value.access.capabilities = [];
    const h = fixture(value);
    render(<DingtalkPersonalSettings host={host} remote={h.remote} />);
    await flush();
    expect(
      screen.getByText("Document access is incomplete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("AI can now find and summarize your documents"),
    ).not.toBeInTheDocument();
  });
  it("cancelling a scan does not enable AI", async () => {
    vi.useFakeTimers();
    const h = fixture();
    render(<DingtalkPersonalSettings host={host} remote={h.remote} />);
    await flush();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete connection and enable AI",
      }),
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this scan" }));
    await flush(10000);
    expect(h.manage).toHaveBeenCalledWith({
      action: "cancel",
      flowId: "f",
      connectionId: "a",
    });
    expect(
      h.manage.mock.calls.some((c) => c[0].action === "complete-connection"),
    ).toBe(false);
  });
  it("cancels a flow that arrives after closing the page", async () => {
    vi.useFakeTimers();
    const h = fixture();
    let resolve: any;
    h.manage.mockImplementation(async (input: any) =>
      input.action === "begin"
        ? await new Promise((r) => {
            resolve = r;
          })
        : { ok: true, value: { status: unauthorized } },
    );
    const view = render(
      <DingtalkPersonalSettings host={host} remote={h.remote} />,
    );
    await flush();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete connection and enable AI",
      }),
    );
    await flush();
    view.unmount();
    await act(async () => {
      resolve({ ok: true, value: { authorization: flow } });
    });
    expect(h.manage).toHaveBeenCalledWith({
      action: "cancel",
      flowId: "f",
      connectionId: "a",
    });
  });
  it("only shows the completion action when document access is ready", async () => {
    vi.useFakeTimers();
    const h = fixture(authorized(true)),
      done = vi.fn();
    render(
      <DingtalkPersonalSettings host={host} remote={h.remote} onDone={done} />,
    );
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: "Done, start using AI" }),
    );
    expect(done).toHaveBeenCalledTimes(1);
  });
});

it("automatically continues a newly created connection to the platform scan", async()=>{vi.useFakeTimers();const h=fixture();render(<DingtalkPersonalSettings host={host} remote={h.remote} autoStart/>);await flush();expect(h.manage).toHaveBeenCalledWith({action:"begin",connectionId:"a"});expect(h.manage.mock.calls.some(c=>c[0].action==="complete-connection")).toBe(false);await flush(5000);expect(h.manage).toHaveBeenCalledWith({action:"complete-connection",connectionId:"a"});});
it("does not claim completion while work tools are still starting",async()=>{vi.useFakeTimers();const h=fixture({...authorized(true),work:"pending"});render(<DingtalkPersonalSettings host={host} remote={h.remote} onDone={vi.fn()}/>);await flush();expect(screen.queryByRole("button",{name:"Done, start using AI"})).not.toBeInTheDocument();expect(screen.getAllByText("Finishing connection setup…").length).toBeGreaterThan(0);});
