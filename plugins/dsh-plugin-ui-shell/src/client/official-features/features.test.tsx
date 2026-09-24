// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackActions, FeedbackDialog } from "./feedback.js";
import { GoalDock } from "./goal.js";
import { SubagentLineage, SubagentReadOnly } from "./subagent.js";
import type {
  MessageFeedbackActionProps,
  FeedbackDialogProps,
} from "@deepseek-ai/dsh-client-ui-message-feedback/client";
import type { GoalDock as OfficialGoalDock } from "@deepseek-ai/dsh-client-ui-goal/client";
import type { SubagentHeaderLineageProps } from "@deepseek-ai/dsh-client-ui-subagent/client";

afterEach(cleanup);
const t = (key: string) => key;
it("opens the official feedback draft, retracts an existing rating, and reports conflicts", async () => {
  let rating: "positive" | undefined;
  const openDialog = vi.fn();
  const retract = vi.fn(async () => ({
    ok: false,
    error: { code: "version-conflict" },
  }));
  const props = {
    messageId: "m1",
    ensure: async () => ({ ok: true }),
    current: () => (rating ? { rating } : undefined),
    retract,
    openDialog,
    useFeedback: (select: (s: unknown) => unknown) =>
      select({
        items: new Map(rating ? [["m1", { rating }]] : []),
        status: "ready",
      }),
    t,
  } as unknown as MessageFeedbackActionProps;
  const view = render(<FeedbackActions {...props} />);
  fireEvent.click(screen.getByLabelText("action.like"));
  await waitFor(() =>
    expect(openDialog).toHaveBeenCalledWith("m1", "positive"),
  );
  rating = "positive";
  view.rerender(<FeedbackActions {...props} />);
  fireEvent.click(screen.getByLabelText("action.likeActive"));
  await waitFor(() => expect(retract).toHaveBeenCalledWith("m1", "positive"));
  expect((await screen.findByRole("alert")).textContent).toBe("error.conflict");
});
it("does not open a stale message feedback dialog after unmount", async () => {
  let settle!: (value: { ok: true }) => void;
  const openDialog = vi.fn();
  const props = {
    messageId: "m1",
    ensure: () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
    current: () => undefined,
    openDialog,
    useFeedback: (select: (s: unknown) => unknown) =>
      select({ items: new Map(), status: "ready" }),
    t,
  } as unknown as MessageFeedbackActionProps;
  const view = render(<FeedbackActions {...props} />);
  fireEvent.click(screen.getByLabelText("action.like"));
  view.unmount();
  settle({ ok: true });
  await Promise.resolve();
  expect(openDialog).not.toHaveBeenCalled();
});
it("keeps feedback draft visible on failure and forwards category/text edits", () => {
  const edit = vi.fn();
  const submit = vi.fn();
  const state = {
    target: { kind: "session" },
    category: null,
    text: "draft",
    submitting: false,
    failure: "note-too-large",
    toast: 0,
  };
  render(
    <FeedbackDialog
      {...({
        useDialog: (select: (s: unknown) => unknown) => select(state),
        edit,
        submit,
        dismiss: vi.fn(),
        dismissToast: vi.fn(),
        t,
      } as unknown as FeedbackDialogProps)}
    />,
  );
  fireEvent.click(screen.getByText("category.task-result"));
  expect(edit).toHaveBeenCalledWith({ category: "task-result" });
  fireEvent.change(screen.getByLabelText("dialog.detail"), {
    target: { value: "new note" },
  });
  expect(edit).toHaveBeenCalledWith({ text: "new note" });
  expect(screen.getByRole("alert").textContent).toBe("error.noteTooLarge");
  fireEvent.click(screen.getByText("submit"));
  expect(submit).toHaveBeenCalledOnce();
});
it("matches goal activation by revision, edits trimmed text, and preserves a failed action", async () => {
  const goal = {
    id: "g1",
    revision: 2,
    phase: "active",
    objective: "Original",
  };
  let activation = { id: "g1", revision: 1, activation: "armed" };
  const onPause = vi.fn(async () => ({
    ok: false,
    error: { message: "Revision changed" },
  }));
  const onEdit = vi.fn(async () => ({ ok: true }));
  const props = {
    useProjection: () => ({ goal }),
    useGoalActivation: (select: (s: unknown) => unknown) => select(activation),
    onPause,
    onEdit,
    onResume: vi.fn(),
    onClear: vi.fn(),
    t,
  } as unknown as Parameters<typeof OfficialGoalDock>[0];
  const view = render(<GoalDock {...props} />);
  expect(view.container.querySelector(".amiba-dock-sheet [data-amiba-goal]")).toBeTruthy();
  expect(screen.queryByLabelText("action.pause")).toBeNull();
  activation = { ...activation, revision: 2 };
  view.rerender(<GoalDock {...props} />);
  fireEvent.click(screen.getByLabelText("action.pause"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Revision changed",
  );
  fireEvent.click(screen.getByLabelText("action.edit"));
  fireEvent.change(screen.getByLabelText("objective.aria"), {
    target: { value: "  New goal  " },
  });
  fireEvent.click(screen.getByLabelText("action.save"));
  await waitFor(() => expect(onEdit).toHaveBeenCalledWith("New goal"));
});
it("canceling goal edit never submits the form", () => {
  const onEdit = vi.fn();
  render(
    <GoalDock
      {...({
        useProjection: () => ({
          goal: {
            id: "g",
            revision: 1,
            phase: "paused",
            objective: "Original",
          },
        }),
        useGoalActivation: () => undefined,
        onEdit,
        t,
      } as unknown as Parameters<typeof OfficialGoalDock>[0])}
    />,
  );
  fireEvent.click(screen.getByLabelText("action.edit"));
  fireEvent.click(screen.getByLabelText("action.cancel"));
  expect(onEdit).not.toHaveBeenCalled();
});
it("uses the official child address and releases catalog subscriptions when closed", async () => {
  const setCatalogOpen = vi.fn();
  const openChild = vi.fn();
  const refresh = vi.fn();
  const state = {
    byId: { root: { id: "root" } },
    subagentsByParent: {
      root: {
        state: "ready",
        entries: [
          {
            kind: "child",
            id: "child",
            label: "Worker",
            mode: "continuable",
            activity: "inactive",
            hasChildren: true,
          },
        ],
      },
      child: { state: "error", entries: [] },
    },
  };
  const props = {
    lineageSessionId: "root",
    displayTitle: "Root",
    useSessions: (select: (s: unknown) => unknown) => select(state),
    setCatalogOpen,
    openChild,
    refresh,
    t,
  } as unknown as SubagentHeaderLineageProps;
  render(<SubagentLineage {...props} />);
  fireEvent.click(screen.getByLabelText("count.total.one"));
  await waitFor(() =>
    expect(setCatalogOpen).toHaveBeenCalledWith("root", true),
  );
  fireEvent.click(screen.getByLabelText("branch.expand"));
  await waitFor(() =>
    expect(setCatalogOpen).toHaveBeenCalledWith("child", true),
  );
  fireEvent.click(screen.getByText("retry"));
  expect(refresh).toHaveBeenCalledWith("child");
  fireEvent.click(screen.getByText("Worker"));
  expect(openChild).toHaveBeenCalledWith({
    parentSessionId: "root",
    childSessionId: "child",
    mode: "continuable",
  });
  await waitFor(() =>
    expect(setCatalogOpen).toHaveBeenCalledWith("root", false),
  );
  expect(setCatalogOpen).toHaveBeenCalledWith("child", false);
});
it("renders the selected one-shot read-only explanation without an input", () => {
  render(
    <SubagentReadOnly
      {...({ matched: { reason: "one-shot" }, t } as unknown as Parameters<
        typeof SubagentReadOnly
      >[0])}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "readonly.oneShot.body",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});
