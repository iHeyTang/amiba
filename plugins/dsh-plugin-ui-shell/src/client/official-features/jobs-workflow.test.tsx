// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobsAction } from "./jobs";
import { WorkflowRun } from "./workflow";
import { mountOfficialFeature } from "./mount";
import { apply as workflow } from "@deepseek-ai/dsh-client-ui-workflow-run/client";
import { apply as jobs } from "@deepseek-ai/dsh-client-ui-jobs/client";
import { createConversationRowsSource } from "../conversation-rows-source";
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({}));
afterEach(cleanup);
const t = (key: string, vars: Record<string, unknown> = {}) =>
  key + (vars.count === undefined ? "" : ` ${vars.count}`);
it("hides empty jobs and resets an open list when the session changes", () => {
  const state = {
    jobsBySession: {
      a: [
        {
          id: "j",
          label: "compile",
          kind: "process",
          status: "failed",
          startedAt: 0,
          finishedAt: 2000,
          detail: "compiler failed",
        },
      ],
      b: [],
    },
  };
  const props = {
    sessionId: "a",
    t,
    useSessions: (select: any) => select(state),
  };
  const view = render(<JobsAction {...(props as any)} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("compiler failed")).toBeTruthy();
  view.rerender(<JobsAction {...(props as any)} sessionId={"b" as any} />);
  expect(screen.queryByText("compile")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
it("only opens live local child sessions, preserves collapsed state across unrelated updates", () => {
  const state = {
    ids: ["child"],
    byId: {
      child: { origin: "subagent", parentId: "a", running: true },
      remote: { origin: "subagent", parentId: "a", running: true },
    },
  };
  const node = {
    key: "run",
    data: {
      name: "Review",
      status: "running",
      phases: [
        {
          key: "p",
          phase: "Audit",
          members: [
            { seq: 1, label: "Local", childId: "child", status: "running" },
            { seq: 2, label: "Remote", childId: "remote", status: "running" },
          ],
        },
      ],
    },
  };
  const openSession = vi.fn();
  const props = {
    node,
    sessionId: "a",
    useSessions: (select: any) => select(state),
    openSession,
    t,
  };
  const view = render(<WorkflowRun {...(props as any)} />);
  fireEvent.click(screen.getByRole("button", { name: "member.open" }));
  expect(openSession).toHaveBeenCalledWith("child");
  expect(screen.getByText("Remote").tagName).toBe("SPAN");
  fireEvent.click(screen.getByRole("button", { name: /Review/ }));
  view.rerender(<WorkflowRun {...(props as any)} node={{ ...node } as any} />);
  expect(screen.queryByRole("button", { name: "member.open" })).toBeNull();
});
it("mounts official event definitions and both renderers without selecting the official transcript", () => {
  let definition: any;
  const entries: any[] = [];
  const ctx = {
    uiConversation: {
      events: {
        register: (d: any) => {
          definition = d;
        },
      },
    },
    locale: { register: () => () => {} },
    effect: (fn: any) => fn(),
    sessions: { open: vi.fn() },
    slots: {
      inject: (_: any, fn: any) => fn(),
      register: (opts: any, component: any) => {
        const entry = { ...opts, component };
        entries.push(entry);
        return () => entries.splice(entries.indexOf(entry), 1);
      },
    },
  };
  mountOfficialFeature(ctx as any, "workflow", workflow);
  mountOfficialFeature(ctx as any, "jobs", jobs);
  expect(definition.kind).toBe("workflow-run");
  expect(
    entries.find((e) => e.name === "conversation.chat.node").registrant,
  ).toBe("amiba:rc2-feature-defaults");
  expect(
    entries.find((e) => e.name === "amiba.conversation.workflow").component,
  ).toBe(WorkflowRun);
  expect(entries.find((e) => e.id === "job-list").component).toBe(JobsAction);
  const event = {
    type: "tool-workflow/run-start",
    seq: 12,
    data: { runId: "r", name: "Persisted run" },
  };
  const match = { event };
  const context: any = {
    key: "run:r",
    id: "r",
    state: definition.start({}, match),
    start: { event, location: { kind: "turn", turn: { status: "closed" } } },
  };
  context.state = definition.update(context, {
    event: {
      type: "tool-workflow/agent-start",
      data: { seq: 13, label: "member", childId: "child" },
    },
  });
  const node = definition.buildViewNode(context);
  expect(node.data.status).toBe("interrupted");
  expect(node.data.phases[0].members[0].status).toBe("interrupted");
  const snapshot: any = {
    chat: {
      order: [node.key],
      nodes: new Map([[node.key, node]]),
      timeline: { turnOrder: [], turns: new Map() },
    },
  };
  const source = createConversationRowsSource(
    { getSnapshot: () => snapshot, subscribe: () => () => {} },
    { getSnapshot: () => [], subscribe: () => () => {} },
    () => null,
    (n) => n.key,
  );
  expect(source.getSnapshot().timelineRows).toEqual([
    { id: node.key, seq: 12, content: node.key },
  ]);
});
