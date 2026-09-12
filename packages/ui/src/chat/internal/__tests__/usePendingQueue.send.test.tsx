import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { pickSendText } from "../pickSendText"

// --- Stub the platform + i18n the hook reaches for at import/runtime. The
// queue hook only touches storage (persist effects) and useT (kept stable);
// neither matters for the text-selection assertion. ---
const storage = {
  get: vi.fn(async () => ({})),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  watch: vi.fn(() => () => {}),
}
vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({ storage }),
}))
vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (k: string) => k }),
}))

import {
  usePendingQueue,
  type RunChatTurnArgs,
  type UsePendingQueueArgs,
} from "../usePendingQueue"

/** Spy typed with the real runner signature so `.mock.calls[0][0]` narrows
 *  to `RunChatTurnArgs` (not the param-less `() => Promise<void>` default). */
const makeRunChatTurn = () =>
  vi.fn<(args: RunChatTurnArgs) => Promise<void>>(async () => {})

/** Minimal args so the hook mounts; `runChatTurn` is the spy we assert on. */
function makeArgs(
  overrides: Partial<UsePendingQueueArgs> = {},
): UsePendingQueueArgs {
  const runChatTurn = makeRunChatTurn()
  return {
    sessions: {
      ready: true,
      activeId: "s1",
      ensureActive: async () => "s1",
    } as unknown as UsePendingQueueArgs["sessions"],
    client: { abort: vi.fn() } as unknown as UsePendingQueueArgs["client"],
    input: "@[skill:translate] hi",
    setInput: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    setAttachmentError: vi.fn(),
    attachmentUploading: false,
    setPendingSourceApp: vi.fn(),
    busy: false,
    markCurrentAssistantStopped: vi.fn(),
    rejectPendingTurn: vi.fn(),
    runChatTurn,
    ...overrides,
  }
}

describe("usePendingQueue.send — dispatches the mention-expanded text", () => {
  beforeEach(() => vi.clearAllMocks())

  it("preserves the draft and queue while read-only and resumes normal sending after switching back", async () => {
    const args = makeArgs();
    const { result, rerender } = renderHook(({ readOnly }) => usePendingQueue({ ...args, readOnly }), { initialProps: { readOnly: true } });
    await act(async () => { result.current.setQueue([{ queueId: "queued", text: "Later", attachments: [] }]); });
    await act(async () => {
      await result.current.send("New text");
      result.current.sendNow("queued");
      result.current.drainHead();
      result.current.stop();
    });
    expect(args.runChatTurn).not.toHaveBeenCalled();
    expect(args.client.abort).not.toHaveBeenCalled();
    expect(args.setInput).not.toHaveBeenCalled();
    expect(args.setAttachments).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([{ queueId: "queued", text: "Later", attachments: [] }]);
    rerender({ readOnly: false });
    await act(async () => { result.current.sendNow("queued"); });
    expect(args.runChatTurn).toHaveBeenCalledWith({ text: "Later", attachments: [] });
  });

  it("dispatches the passed (expanded) textArg, NOT the raw input", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ runChatTurn })),
    )

    // The Composer passes the expanded text (raw `@[skill:translate]` token
    // has been turned into agent-facing text). The raw `input` still holds
    // the un-expanded token — the bug was dispatching THAT instead.
    await act(async () => {
      await result.current.send("(skill: translate) hi")
    })

    expect(runChatTurn).toHaveBeenCalledTimes(1)
    expect(runChatTurn.mock.calls[0][0]).toMatchObject({
      text: "(skill: translate) hi",
    })
    // Regression guard: the raw mention token must never reach the engine.
    expect(runChatTurn.mock.calls[0][0].text).not.toContain("@[")
  })

  it("queues the passed (expanded) textArg when busy", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ busy: true, runChatTurn })),
    )

    await act(async () => {
      await result.current.send("(skill: translate) hi")
    })

    // Busy → enqueued, not dispatched. The queued item must carry the
    // expanded text.
    expect(runChatTurn).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    expect(result.current.queue[0].text).toBe("(skill: translate) hi")
    expect(result.current.queue[0].text).not.toContain("@[")
  })

  it("falls back to raw input when no override is passed", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ input: "plain message", runChatTurn })),
    )

    await act(async () => {
      await result.current.send()
    })

    expect(runChatTurn.mock.calls[0][0]).toMatchObject({ text: "plain message" })
  })
})

describe("pickSendText", () => {
  it("prefers the override and trims it", () => {
    expect(pickSendText("  expanded  ", "raw")).toBe("expanded")
  })
  it("falls back to raw input (trimmed) when override is undefined", () => {
    expect(pickSendText(undefined, "  raw  ")).toBe("raw")
  })
  it("treats an empty-string override as an intentional empty payload", () => {
    // `expandMentions("")` could legitimately return "" — an override of ""
    // must win over stale raw input rather than silently dispatching it.
    expect(pickSendText("", "raw")).toBe("")
  })
})
