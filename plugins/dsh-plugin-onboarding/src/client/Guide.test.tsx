import type { GuideStepOwner } from "./contracts.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Guide, type GuideProps } from "./Guide.js";
import type { ProgressStore } from "./progress.js";
afterEach(cleanup);
function fixture(initial = { completed: [] as string[], finished: false }) {
  let saved = initial;
  const store: ProgressStore = {
    read: vi.fn(async () => saved),
    mark: vi.fn(
      async (id) => (saved = { ...saved, completed: [...saved.completed, id] }),
    ),
    finish: vi.fn(async () => (saved = { ...saved, finished: true })),
  };
  const rows = [
    { id: "models", label: "Model service" },
    { id: "extra", label: "Extra integration" },
  ];
  const close = vi.fn();
  const renderSlot: GuideProps["renderSlot"] = ((
    name: string,
    props: { complete(): Promise<void> },
    filter?: { only?: string },
  ) =>
    name === "amiba.onboarding.companion" ? (
      <span>Pet</span>
    ) : (
      <button onClick={() => void props.complete().catch(() => {})}>
        Save {filter?.only}
      </button>
    )) as GuideProps["renderSlot"];
  const props: GuideProps = {
    store,
    close,
    steps: { getSnapshot: () => rows, subscribe: () => () => {} },
    renderSlot,
    openSection: vi.fn(),
  };
  return { props, store, close };
}
describe("persistent guide", () => {
  it("paints no welcome for a finished profile", async () => {
    const { props, close } = fixture({ completed: ["models"], finished: true });
    render(<Guide {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("resumes remaining steps after remount, finishes only explicitly, and can be revisited", async () => {
    const { props, store, close } = fixture();
    const view = render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    fireEvent.click(screen.getByText("Save models"));
    await screen.findByText("Save extra");
    expect(store.finish).not.toHaveBeenCalled();
    view.unmount();
    const second = render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    expect(screen.queryByText("Save models")).toBeNull();
    fireEvent.click(screen.getByText("Save extra"));
    fireEvent.click(await screen.findByText("Start using Amiba"));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    second.unmount();
    render(<Guide {...props} revisit />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    expect(screen.getByText("Save models")).toBeInTheDocument();
  });
  it("does not mark a step on dismissal and keeps a failed save retryable", async () => {
    const { props, store, close } = fixture();
    vi.mocked(store.mark).mockRejectedValueOnce(new Error("disk unavailable"));
    render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    fireEvent.click(screen.getByText("Save models"));
    await screen.findByRole("alert");
    expect(screen.getByText("Save models")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save models"));
    await screen.findByText("Save extra");
    fireEvent.click(screen.getByText("Continue later"));
    expect(close).toHaveBeenCalledOnce();
    expect(store.finish).not.toHaveBeenCalled();
  });
  it("shows a retryable read error without silently marking onboarding complete", async () => {
    const { props, store, close } = fixture();
    vi.mocked(store.read).mockRejectedValueOnce(new Error("offline"));
    render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Retry"));
    await screen.findByText("Let's get set up");
    expect(close).not.toHaveBeenCalled();
  });
  it("records skipped steps without claiming the setup is ready", async () => {
    const { props, store } = fixture();
    render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    fireEvent.click(screen.getByText("Skip this step"));
    await screen.findByText("Save extra");
    fireEvent.click(screen.getByText("Skip this step"));
    await screen.findByText(/We skipped some setup/);
    expect(store.mark).toHaveBeenCalledWith("models", true);
    expect(screen.queryByText(/You're all set/)).toBeNull();
  });
  it("picks up new contributed steps and recovers a failed final save", async () => {
    const { props, store, close } = fixture({
      completed: ["models", "extra"],
      finished: false,
    });
    let rows = props.steps.getSnapshot();
    let changed = () => {};
    props.steps = {
      getSnapshot: () => rows,
      subscribe: (listener) => {
        changed = listener;
        return () => {};
      },
    };
    vi.mocked(store.finish).mockRejectedValueOnce(new Error("offline"));
    render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    expect(screen.getByText("Start using Amiba")).toBeInTheDocument();
    act(() => {
      rows = [...rows, { id: "new-integration", label: "New integration" }];
      changed();
    });
    fireEvent.click(screen.getByText("Save new-integration"));
    fireEvent.click(await screen.findByText("Start using Amiba"));
    await screen.findByRole("alert");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Start using Amiba"));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it("renders step actions in the shared footer and submits the body form from there", async () => {
    const { props, store } = fixture();
    props.renderSlot = ((
      name: string,
      owner: GuideStepOwner,
      filter?: { only?: string },
    ) =>
      name === "amiba.onboarding.companion" ? null : (
        <>
          <form
            id="test-guide-form"
            onSubmit={(e) => {
              e.preventDefault();
              void owner.complete();
            }}
          >
            <span>Body {filter?.only}</span>
          </form>
          {owner.renderActions(
            <button type="submit" form="test-guide-form">
              Next {filter?.only}
            </button>,
          )}
        </>
      )) as GuideProps["renderSlot"];
    render(<Guide {...props} />);
    fireEvent.click(await screen.findByText("Let's get set up"));
    const button = await screen.findByText("Next models");
    expect(button.closest("footer")).not.toBeNull();
    expect(
      screen.getByText("Skip this step").compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(button);
    await screen.findByText("Next extra");
    expect(screen.queryByText("Next models")).toBeNull();
    expect(store.mark).toHaveBeenCalledWith("models", false);
  });
});
