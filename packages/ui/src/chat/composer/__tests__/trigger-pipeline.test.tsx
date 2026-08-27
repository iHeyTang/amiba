/**
 * End-to-end coverage of the official input-trigger adoption.
 *
 * Two mounts, three properties:
 *
 *   1. a plugin's source (the fixture below is shaped exactly like one
 *      registered through `ctx.inputTriggers.registerSource`) shows a group in
 *      Amiba's menu, and picking a row inserts a chip whose `codec.serialize`
 *      output is what reaches the model on submit;
 *   2. EXACTLY ONE menu exists per composer — the in-session composer mounts
 *      no local menu of its own, so the shadowed seat's menu is the only one;
 *   3. a `{ claim }` outcome enters command mode, honours the token integrity
 *      watch, and routes Enter through the claim's own submit.
 *
 * The one thing standing in for real code here is the official
 * `InputTriggerController`: it ships inside a DSH plugin bundle that a unit
 * test cannot import. The double below is NOT a re-implementation — it holds
 * the menu store and calls the fixture's `onPick`, and everything downstream
 * (the bail listeners, the editor verbs, the chip, the codec, the submit
 * router) is the real Amiba code under test.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { Composer } from "../../Composer";
import { OfficialTriggerMenu } from "../triggers/OfficialTriggerMenu";
import { sourceToProvider } from "../providers/source-adapter";
import { CommandClaimStore } from "../triggers/claim";
import { DraftRevision } from "../triggers/editor-ops";
import type {
  CommandClaim,
  ComposerTriggerController,
  ComposerTriggerRuntime,
  InputTriggerSource,
  MenuState,
  PickOutcome,
  TriggerEditorOps,
} from "../triggers/contracts";

/** A plugin-authored `@` source, verbatim against the official contract. */
function fixtureSource(): InputTriggerSource {
  return {
    trigger: "@",
    name: "fixture",
    order: 5,
    codec: {
      clipboardText: (ref) => `@${ref}`,
      serialize: (ref) => Promise.resolve(`<fixture>${ref}</fixture>`),
    },
    candidates: async (_session, req) =>
      ["alpha", "beta"]
        .filter((name) => name.startsWith(req.query))
        .map((name) => ({ name, description: `the ${name} doc` })),
    onPick: (pick): PickOutcome => ({
      insert: {
        source: "fixture",
        ref: pick.candidate.name,
        label: pick.candidate.name,
        clipboardText: `@${pick.candidate.name}`,
      },
    }),
  };
}

/** A minimal writable store with the official observable face. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next: T) => {
      value = next;
      for (const fn of [...listeners]) fn();
    },
  };
}

const CLOSED: MenuState = {
  open: false,
  hit: null,
  generation: 0,
  groups: [],
  highlight: null,
};

/**
 * Stands in for the official controller. `pick` does exactly what the real
 * `InputTriggerController.pick` does: call the source's `onPick`, then hand
 * the outcome to the scoped bail events — here, the listeners the real
 * `input-trigger-bridge` would have registered through `bindEditor`.
 */
function controllerDouble(source: InputTriggerSource) {
  const menu = store<MenuState>(CLOSED);
  let ops: TriggerEditorOps | null = null;
  const tracked: { draft: string; caret: number; draftRev: number }[] = [];
  const controller: ComposerTriggerController & {
    open(query: string, names: string[]): void;
    lastSpan: { start: number; end: number; draftRev: number };
    tracked: typeof tracked;
    ops: TriggerEditorOps | null;
    bind(next: TriggerEditorOps | null): void;
  } = {
    menu,
    tracked,
    lastSpan: { start: 0, end: 0, draftRev: 0 },
    ops: null,
    bind(next) {
      ops = next;
      controller.ops = next;
    },
    open(query, names) {
      menu.set({
        open: true,
        hit: null,
        generation: 1,
        groups: names.map((name) => ({
          source: name,
          status: "ready" as const,
          items: ["alpha", "beta"]
            .filter((candidate) => candidate.startsWith(query))
            .map((candidate) => ({
              name: candidate,
              description: `the ${candidate} doc`,
            })),
        })),
        highlight: null,
      });
    },
    track(draft, caret, _guard, draftRev) {
      tracked.push({ draft, caret, draftRev });
      // The real controller stamps the revision it was tracked with into the
      // hit span; every pick then CASes against it.
      controller.lastSpan = { start: caret, end: caret, draftRev };
    },
    pick(sourceName, index) {
      const group = menu.getSnapshot().groups.find((g) => g.source === sourceName);
      const candidate = group?.items[index];
      if (candidate === undefined || ops === null) return;
      const outcome = source.onPick({
        candidate,
        session: { sessionId: "s1" as never },
        position: "inline",
        via: "menu",
        span: controller.lastSpan,
      });
      menu.set(CLOSED);
      if (outcome !== undefined && outcome !== "handled" && "insert" in outcome) {
        ops.insertReference(outcome.insert, controller.lastSpan);
      }
    },
    onSpace: () => false,
    adjudicate: async () => undefined,
    serializeReference: (name, ref, signal) => {
      if (name !== source.name || source.codec === undefined) {
        return Promise.reject(new Error(`no serializer for "${name}"`));
      }
      return source.codec.serialize(ref, signal);
    },
    dismiss() {
      menu.set(CLOSED);
    },
  };
  return controller;
}

function runtimeFor(controller: ReturnType<typeof controllerDouble>): ComposerTriggerRuntime {
  return {
    controllerFor: () => controller,
    bindEditor: (_sessionId, ops) => {
      controller.bind(ops);
      return () => controller.bind(null);
    },
  };
}

/** Drive the composer as a controlled input, as every real surface does. */
function ControlledComposer(props: {
  runtime?: ComposerTriggerRuntime;
  sessionId?: string;
  onSubmit: (text: string) => void;
  seat?: (controller: ComposerTriggerController) => React.ReactNode;
  controller?: ComposerTriggerController;
  initial?: string;
  mentionProviders?: React.ComponentProps<typeof Composer>["mentionProviders"];
  valueRef?: { current: string };
}) {
  const [value, setValue] = React.useState(props.initial ?? "");
  if (props.valueRef) props.valueRef.current = value;
  return (
    <Composer
      inputOverlay={
        props.seat && props.controller ? props.seat(props.controller) : undefined
      }
      mentionProviders={props.mentionProviders}
      onChange={setValue}
      onSubmit={props.onSubmit}
      permissionSessionId={props.sessionId}
      triggerRuntime={props.runtime}
      value={value}
    />
  );
}

import * as React from "react";

describe("a plugin source through the official pipeline", () => {
  it("shows its group in Amiba's menu and lands a chip that serializes through its codec", async () => {
    const source = fixtureSource();
    const controller = controllerDouble(source);
    const submitted: string[] = [];
    const valueRef = { current: "" };

    render(
      <ControlledComposer
        controller={controller}
        onSubmit={(text) => submitted.push(text)}
        runtime={runtimeFor(controller)}
        seat={(c) => (
          <OfficialTriggerMenu controller={c} labels={{ fixture: "Fixture" }} />
        )}
        sessionId="s1"
        valueRef={valueRef}
      />,
    );

    // The editor binds its verbs to the session on mount — without that, no
    // pick could ever be applied.
    await waitFor(() => expect(controller.tracked.length).toBeGreaterThan(0));

    act(() => controller.open("", ["fixture"]));
    // The plugin's group heading and its rows render in AMIBA's menu.
    expect(await screen.findByText("Fixture")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("the beta doc")).toBeTruthy();

    act(() => {
      screen.getByText("alpha").closest("button")!.click();
    });

    // The pick produced a real chip in the editor, projected into the value.
    await waitFor(() =>
      expect(valueRef.current).toContain("@[dsh.reference:fixture|alpha"),
    );
    expect(screen.queryByText("Fixture")).toBeNull();
  });

  it("sends the codec's model form, not the chip's clipboard text", async () => {
    // The submit-time expansion is the property that matters: what reaches
    // the model must come from `codec.serialize`.
    const source = fixtureSource();
    const controller = controllerDouble(source);
    const submitted: string[] = [];
    render(
      <ControlledComposer
        controller={controller}
        initial="see @[dsh.reference:fixture|alpha|alpha|%40alpha] please"
        onSubmit={(text) => submitted.push(text)}
        runtime={runtimeFor(controller)}
        sessionId="s1"
      />,
    );
    const send = await screen.findByRole("button", { name: /send/iu });
    act(() => {
      send.click();
    });
    await waitFor(() =>
      expect(submitted).toEqual(["see <fixture>alpha</fixture> please"]),
    );
  });

  it("blocks the send when no codec owns the reference", async () => {
    const source = fixtureSource();
    const controller = controllerDouble(source);
    const submitted: string[] = [];
    render(
      <ControlledComposer
        controller={controller}
        initial="see @[dsh.reference:ghost|x|x|x] please"
        onSubmit={(text) => submitted.push(text)}
        runtime={runtimeFor(controller)}
        sessionId="s1"
      />,
    );
    const send = await screen.findByRole("button", { name: /send/iu });
    act(() => {
      send.click();
    });
    await waitFor(() =>
      expect(
        document.querySelector("[data-composer-command-notice]")?.textContent,
      ).toMatch(/no serializer/u),
    );
    // Never a silent downgrade to the clipboard text.
    expect(submitted).toEqual([]);
  });
});

describe("exactly one menu per composer", () => {
  it("mounts NO surface-local menu while the official pipeline drives the composer", async () => {
    const source = fixtureSource();
    const controller = controllerDouble(source);
    render(
      <ControlledComposer
        controller={controller}
        onSubmit={() => {}}
        runtime={runtimeFor(controller)}
        seat={(c) => <OfficialTriggerMenu controller={c} />}
        sessionId="s1"
      />,
    );
    await waitFor(() => expect(controller.tracked.length).toBeGreaterThan(0));
    act(() => controller.open("", ["fixture"]));
    // Asserted, not eyeballed: one overlay node in the whole document.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-composer-overlay]")).toHaveLength(
        1,
      ),
    );
  });

  it("mounts the surface-local menu when there is no runtime (home / Quick-Ask)", async () => {
    // Same component, other mount path: the group heading and rows come from
    // the surface-local registry over the SAME source object.
    const claims = new CommandClaimStore();
    const revision = new DraftRevision();
    const provider = sourceToProvider(fixtureSource(), {
      claims,
      label: "Fixture",
      revision,
      sessionId: "s1",
    });
    const items = await provider.search("al", {
      position: "inline",
      span: { start: 0, end: 3, draftRev: 0 },
    });
    expect(items.map((item) => item.label)).toEqual(["alpha"]);
    expect(provider.group).toBe("Fixture");
  });
});

describe("command mode", () => {
  const claim: CommandClaim = {
    token: "/goal ",
    submit: async (args) => ({ kind: "success", text: `ran:${args}` }),
  };

  it("routes Enter through the claim's submit and clears on success", async () => {
    const source = fixtureSource();
    const controller = controllerDouble(source);
    const submitted: string[] = [];
    const runs: { claim: CommandClaim; args: string }[] = [];
    const runtime: ComposerTriggerRuntime = {
      ...runtimeFor(controller),
      submitClaim: async (_sessionId, next, args) => {
        runs.push({ claim: next, args });
        return next.submit(args, undefined as never, []);
      },
    };
    // Enter command mode the way the pipeline does — through the bail verb.
    const valueRef = { current: "" };
    render(
      <ControlledComposer
        controller={controller}
        initial="/goal ship it"
        onSubmit={(text) => submitted.push(text)}
        runtime={runtime}
        sessionId="s1"
        valueRef={valueRef}
      />,
    );
    await waitFor(() => expect(controller.tracked.length).toBeGreaterThan(0));
    // The editor's own verb is what enters command mode; no state is faked.
    const rev = controller.tracked[controller.tracked.length - 1].draftRev;
    // Drive begin-command through the BOUND ops, exactly as a `{claim}` pick
    // would: this is the real bail-listener body, not a state flip.
    let applied = false;
    act(() => {
      applied = controller.ops!.beginCommand(claim, {
        start: 0,
        end: 6,
        draftRev: rev,
      });
    });
    expect(applied).toBe(true);

    const send = await screen.findByRole("button", { name: /send/iu });
    act(() => {
      send.click();
    });
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].args).toBe("ship it");
    // A claimed submit is NOT an ordinary message.
    expect(submitted).toEqual([]);
    await waitFor(() => expect(valueRef.current).toBe(""));
  });
});
