import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectAddToolview } from "../ConnectAddToolview";

const base = { callId: "k1", toolName: "amiba_connect_add", openFile: () => {} };
const running = { callId: "k1", name: "amiba_connect_add", argsRaw: "{}", turn: 1, step: 1, time: 1, callView: null, subCalls: [] };
function settled(text: string, isError = false) {
  return { kind: "tool-result", seq: 1, time: 2, callId: "k1", call: { name: "amiba_connect_add", argsRaw: "{}" }, callTime: 1, content: [{ type: "text", text }], isError, callView: null, resultView: null, subCalls: [] };
}

describe("ConnectAddToolview", () => {
  it("shows the waiting line while running", () => {
    render(<ConnectAddToolview {...base} block={running as never} />);
    expect(screen.getByText(/等待你在下方完成接入|Waiting for you/)).toBeInTheDocument();
  });
  it("summarizes a connected result", () => {
    render(<ConnectAddToolview {...base} block={settled(JSON.stringify({ status: "connected", connect: { id: "c1", provider: "lark", name: "飞书助手", status: "ready" } })) as never} />);
    expect(screen.getByText(/lark · 飞书助手/)).toBeInTheDocument();
  });
  it("summarizes a cancel", () => {
    render(<ConnectAddToolview {...base} block={settled(JSON.stringify({ status: "cancelled" })) as never} />);
    expect(screen.getByText(/已取消|Cancelled/)).toBeInTheDocument();
  });
});
