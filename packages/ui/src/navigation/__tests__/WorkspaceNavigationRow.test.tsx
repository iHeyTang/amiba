import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceNavigationRow } from "../WorkspaceNavigationRow";

const activity = {
  sessions: [],
  visibleSessionId: "steward-session",
  markUnread: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
};

function Navigation({ view, sessionId = "steward-session" }: { view: string; sessionId?: string }) {
  const navigation = { activeView: view, sessionActivity: { ...activity, visibleSessionId: sessionId } };
  return <>
    <WorkspaceNavigationRow icon={null} label="Steward" navigation={navigation} target={{ kind: "session", sessionId: "steward-session" }} />
    <WorkspaceNavigationRow icon={null} label="Cron" navigation={navigation} target={{ kind: "workspace", viewId: "cron" }} />
    <WorkspaceNavigationRow icon={null} label="Memory" navigation={navigation} target={{ kind: "workspace", viewId: "memory" }} />
  </>;
}

describe("workspace navigation selection", () => {
  it("moves selection between destinations even when the previous session is retained", () => {
    const view = render(<Navigation view="chats" />);
    const selected = () => screen.getAllByRole("button").filter(row => row.getAttribute("aria-current") === "page").map(row => row.textContent);
    expect(selected()).toEqual(["Steward"]);
    view.rerender(<Navigation view="cron" />);
    expect(selected()).toEqual(["Cron"]);
    view.rerender(<Navigation view="memory" />);
    expect(selected()).toEqual(["Memory"]);
    view.rerender(<Navigation view="chats" />);
    expect(selected()).toEqual(["Steward"]);
    view.rerender(<Navigation view="chats" sessionId="ordinary-session" />);
    expect(selected()).toEqual([]);
  });
});
