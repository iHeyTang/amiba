import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";
import { ConversationViewRegion } from "../ConversationViewRegion";

it("preserves native chat DOM and draft across view registration, switching and removal", async () => {
  const mounted = vi.fn();
  const disposed = vi.fn();
  function Chat() {
    useEffect(() => {
      mounted();
      return disposed;
    }, []);
    return <textarea aria-label="Draft" defaultValue="Unsent text" />;
  }
  const renderView = vi.fn((id: string) => <p>View {id}</p>);
  const props = { sessionId: "s1", chatLabel: "Chat", renderView };
  const { container, rerender } = render(
    <ConversationViewRegion {...props} entries={[]}>
      <Chat />
    </ConversationViewRegion>,
  );
  const baseline = container.innerHTML;
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(container.firstElementChild?.tagName).toBe("MAIN");
  await userEvent.type(screen.getByRole("textbox"), " plus draft");
  const entries = [{ id: "chat", label: "Plugin view" }];
  rerender(
    <ConversationViewRegion {...props} entries={entries}>
      <Chat />
    </ConversationViewRegion>,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Plugin view" }));
  expect(screen.getByText("View chat")).toBeVisible();
  expect(screen.getByLabelText("Draft")).not.toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Chat" }));
  expect(screen.getByRole("textbox")).toHaveValue("Unsent text plus draft");
  rerender(
    <ConversationViewRegion {...props} entries={[]}>
      <Chat />
    </ConversationViewRegion>,
  );
  expect(container.innerHTML).toBe(baseline);
  expect(screen.getByRole("textbox")).toHaveValue("Unsent text plus draft");
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(disposed).not.toHaveBeenCalled();
});

it("supports keyboard selection and withdraws a removed view or changed session", async () => {
  const disposed = vi.fn();
  function Panel() {
    useEffect(() => disposed, []);
    return <p>External panel</p>;
  }
  const renderView = () => <Panel />;
  const entries = [{ id: "external", label: "External" }];
  const props = { entries, renderView, chatLabel: "Chat" };
  const { rerender } = render(
    <ConversationViewRegion {...props} sessionId="one">
      <p>Native chat</p>
    </ConversationViewRegion>,
  );
  screen.getByRole("tab", { name: "Chat" }).focus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "External" })).toHaveFocus();
  expect(screen.getByText("External panel")).toBeVisible();
  rerender(
    <ConversationViewRegion {...props} sessionId="two">
      <p>Native chat</p>
    </ConversationViewRegion>,
  );
  expect(screen.getByText("Native chat")).toBeVisible();
  expect(disposed).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("tab", { name: "External" }));
  rerender(
    <ConversationViewRegion {...props} entries={[]} sessionId="two">
      <p>Native chat</p>
    </ConversationViewRegion>,
  );
  expect(disposed).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("tablist")).toBeNull();
  rerender(
    <ConversationViewRegion {...props} sessionId="two">
      <p>Native chat</p>
    </ConversationViewRegion>,
  );
  expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  rerender(
    <ConversationViewRegion {...props} sessionId={null}>
      <p>Native chat</p>
    </ConversationViewRegion>,
  );
  expect(screen.queryByRole("tablist")).toBeNull();
});

it("accepts external trajectory selection without remounting the native editor", async () => {
  const onSelect = vi.fn();
  const props = { sessionId: "session", entries: [{ id: "trajectory", label: "Trajectory" }], chatLabel: "Chat", renderView: () => <p>Exact call record</p>, onSelect };
  const { rerender } = render(<ConversationViewRegion {...props} selection={null}><textarea aria-label="Resident draft" defaultValue="keep me" /></ConversationViewRegion>);
  const editor = screen.getByRole("textbox");
  rerender(<ConversationViewRegion {...props} selection={{ sessionId: "session", id: "trajectory" }}><textarea aria-label="Resident draft" defaultValue="keep me" /></ConversationViewRegion>);
  expect(screen.getByText("Exact call record")).toBeVisible();
  expect(editor).not.toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Chat" }));
  expect(onSelect).toHaveBeenCalledWith(null);
  rerender(<ConversationViewRegion {...props} selection={null}><textarea aria-label="Resident draft" defaultValue="keep me" /></ConversationViewRegion>);
  expect(screen.getByRole("textbox")).toBe(editor);
  expect(editor).toHaveValue("keep me");
});

it("uses external header navigation for trajectory while preserving other plugin tabs and drafts", () => {
  const props = { sessionId: "one", chatLabel: "Chat", headerViewIds: ["trajectory"], entries: [{ id: "trajectory", label: "Transcript" }], renderView: (id: string) => <p>Records: {id}</p> };
  const chat = <textarea aria-label="Draft" defaultValue="Keep this draft" />;
  const { rerender } = render(<ConversationViewRegion {...props}>{chat}</ConversationViewRegion>);
  const editor = screen.getByRole("textbox");
  expect(screen.queryByRole("tablist")).toBeNull();
  const selection = { sessionId: "one", id: "trajectory" };
  rerender(<ConversationViewRegion {...props} selection={selection}>{chat}</ConversationViewRegion>);
  expect(screen.getByRole("region", { name: "Transcript" })).toBeVisible();
  expect(editor).not.toBeVisible();
  expect(screen.queryByRole("tablist")).toBeNull();
  rerender(<ConversationViewRegion {...props} selection={null}>{chat}</ConversationViewRegion>);
  expect(screen.getByRole("textbox")).toBe(editor);
  expect(editor).toHaveValue("Keep this draft");
  rerender(<ConversationViewRegion {...props} entries={[...props.entries, { id: "extra", label: "Extra" }]}>{chat}</ConversationViewRegion>);
  expect(screen.getByRole("tab", { name: "Extra" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Transcript" })).toBeNull();
});
