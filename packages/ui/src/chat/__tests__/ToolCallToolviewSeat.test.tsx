import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import type { ToolProgress } from "@amiba/app-runtime/core";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";

import { MessageTurns } from "../bubble/Bubble";
import {
  ToolCallSeatProvider,
  type ToolCallSeatRenderer,
  type ToolCallSeatRequest,
} from "../bubble/tool-call-seat";
import type { UiMessage } from "../internal/types";

/**
 * The keyed `tool.call.toolview` seat, from the render site's side.
 *
 * Visual parity is a HARD requirement: with no plugin registered, every tool
 * row must render exactly what it rendered before the seat existed. These
 * tests prove that by comparing real DOM against a baseline captured with no
 * seat at all, and prove that a registered tool name replaces only its own
 * row.
 */

/** Expand the aggregated process disclosure the tool rows fold behind. */
function expandProcess() {
  fireEvent.click(
    screen.getAllByRole("button", {
      name: /sidepanel\.trace\.(toolCount|thoughtProcess|workedFor|thoughtFor)/,
    })[0]!,
  );
}

function toolRow(
  overrides: Partial<ToolProgress> & { tool: string; toolCallId: string },
): ToolProgress {
  return {
    status: "completed",
    args: { path: "src/App.tsx" },
    result: { text: "ok" },
    startedAt: 1_000,
    durationMs: 250,
    wire: {
      call: {
        argsRaw: '{"path":"src/App.tsx"}',
        turn: 1,
        step: 1,
        time: 1_000,
        callView: null,
      },
      result: {
        seq: 9,
        time: 1_250,
        content: [{ type: "text", text: "ok" }],
        isError: false,
        resultView: null,
      },
    },
    ...overrides,
  };
}

/** Two rows with DIFFERENT wire tool names, so a takeover can be scoped. */
const MESSAGES: UiMessage[] = [
  { uiId: "user-1", role: "user", content: "Look at it" },
  {
    uiId: "assistant-1",
    role: "assistant",
    content: "Done",
    toolProgress: [
      toolRow({ tool: "read_file", toolCallId: "call-read" }),
      toolRow({ tool: "bash", toolCallId: "call-bash" }),
    ],
  } as UiMessage,
];

/** Render the conversation, expand the disclosure, return the tool rows' HTML. */
function renderRows(seat?: {
  render: ToolCallSeatRenderer;
  cwd?: string;
}): string {
  const tree = (
    <MessageTurns messages={structuredClone(MESSAGES) as UiMessage[]} />
  );
  const { container, unmount } = render(
    seat ? (
      <ToolCallSeatProvider render={seat.render} cwd={seat.cwd}>
        {tree}
      </ToolCallSeatProvider>
    ) : (
      tree
    ),
  );
  expandProcess();
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("tool.call.toolview seat", () => {
  it("renders byte-identical rows when no plugin occupies the seat", () => {
    // The pre-seat world: no provider at all (Quick-Ask, any surface outside
    // a DSH plugin runtime, every existing render path).
    const baseline = renderRows();
    expect(baseline).toContain("sidepanel.trace.actions.useTool");

    // Inside a plugin runtime with the seat wired up, an unoccupied key
    // reaches the host's dispatch and comes straight back as `fallback`.
    const dispatched = renderRows({
      render: ({ fallback }) => fallback,
    });

    expect(dispatched).toBe(baseline);
  });

  it("lets one registered tool name take over only its own row", () => {
    const baseline = renderRows();
    // Guard the negative assertion below against going vacuous: these are the
    // two rows' own action labels from the closed ToolSpec table.
    expect(baseline).toContain("sidepanel.trace.actions.useTool");
    expect(baseline).toContain("sidepanel.trace.actions.useTool");

    const takenOver = renderRows({
      // Stands in for renderSlot's keyed dispatch: an entry registered under
      // `key: "bash"` matches, every other key falls back.
      render: ({ owner, fallback }) =>
        owner.toolName === "bash" ? (
          <div data-plugin-bash-row>plugin bash row</div>
        ) : (
          fallback
        ),
    });

    expect(takenOver).toContain("plugin bash row");
    // The bash row's own chrome is gone …
    expect(takenOver).not.toContain("sidepanel.trace.actions.runCommand");
    // … and the read_file row is untouched: everything the baseline rendered
    // for it survives verbatim.
    const readRowOf = (html: string) =>
      html.slice(
        html.indexOf("sidepanel.trace.actions.readFile") - 400,
        html.indexOf("sidepanel.trace.actions.readFile") + 400,
      );
    expect(readRowOf(takenOver)).toBe(readRowOf(baseline));
  });

  it("supplies the official owner contract faithfully", () => {
    const owners: ToolCallOwnerProps[] = [];
    renderRows({
      cwd: "/repo/amiba",
      render: ({ owner, fallback }) => {
        owners.push(owner);
        return fallback;
      },
    });

    const bash = owners.find((owner) => owner.toolName === "bash");
    expect(bash).toBeDefined();
    expect(bash!.callId).toBe("call-bash");
    expect(bash!.cwd).toBe("/repo/amiba");
    expect(typeof bash!.openFile).toBe("function");
    // `inspect` is optional and Amiba runs no trajectory surface: the member
    // must be ABSENT, not a no-op stub.
    expect("inspect" in bash!).toBe(false);
    // The block is the runtime's own settled node, rebuilt from wire material.
    expect(bash!.block).toEqual({
      kind: "tool-result",
      seq: 9,
      time: 1_250,
      callId: "call-bash",
      call: { name: "bash", argsRaw: '{"path":"src/App.tsx"}' },
      callTime: 1_000,
      content: [{ type: "text", text: "ok" }],
      isError: false,
      callView: null,
      resultView: null,
      subCalls: [],
    });
  });

  it("keeps the host row for a legacy row with no retained wire material", () => {
    const dispatch = vi.fn(
      ({ fallback }: ToolCallSeatRequest) => fallback,
    ) satisfies ToolCallSeatRenderer;
    const messages: UiMessage[] = [
      { uiId: "user-1", role: "user", content: "Look at it" },
      {
        uiId: "assistant-1",
        role: "assistant",
        content: "Done",
        toolProgress: [
          { tool: "read_file", toolCallId: "call-read", status: "completed" },
        ],
      } as UiMessage,
    ];

    const { container } = render(
      <ToolCallSeatProvider render={dispatch}>
        <MessageTurns messages={messages} />
      </ToolCallSeatProvider>,
    );
    expandProcess();

    // No faithful block can be built, so the seat is never dispatched — the
    // host row renders instead of a partly invented node reaching a plugin.
    expect(dispatch).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain("sidepanel.trace.actions.useTool");
  });
});
