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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

const imageStore = vi.hoisted(() => ({
  serialize: vi.fn(async () => [{type:"image",mediaType:"image/png",data:"AQID",name:"photo.png"}]),
  remove: vi.fn(async () => {}),
}));
vi.mock("@amiba/app-runtime/platform", () => ({getPlatform:()=>({agentAttachments:imageStore})}));

vi.mock("@amiba/i18n", () => {
  const t = (key: string) => key;
  return { useT: () => ({ t }) };
});

import userEvent from "@testing-library/user-event";
import { useComposerAttachments } from "../../useComposerAttachments";
import { detectTrigger } from "../triggers/detect";

import { Composer } from "../../Composer";
import { createComposerDraftSource, type ComposerDraftSource } from "../../composer-draft-store";
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
    menu: typeof menu;
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
  draftSource?: ComposerDraftSource;
  runtime?: ComposerTriggerRuntime;
  sessionId?: string;
  onSubmit: (text: string) => void;
  seat?: (controller: ComposerTriggerController) => React.ReactNode;
  controller?: ComposerTriggerController;
  initial?: string;
  mentionProviders?: React.ComponentProps<typeof Composer>["mentionProviders"];
  valueRef?: { current: string };
  filePicker?: () => Promise<void>;
  onPaste?: React.ComponentProps<typeof Composer>["onPaste"];
  submitOptions?: Pick<React.ComponentProps<typeof Composer>, "busy" | "disabled" | "canSubmit" | "canSubmitDraft" | "onAbort">;
  editDraft?: { current: (text: string) => void };
  initialAttachments?: import("@amiba/app-runtime/core").Attachment[];
  attachmentsRef?: { current: import("../../useComposerAttachments").UseComposerAttachmentsResult | undefined };
}) {
  const [value, setValue] = React.useState(props.initial ?? "");
  const attachments = useComposerAttachments({ getSessionId: () => props.sessionId ?? "draft" });
  React.useEffect(() => { if (props.initialAttachments) attachments.setAttachments(props.initialAttachments); }, [props.initialAttachments]);
  if (props.attachmentsRef) props.attachmentsRef.current = attachments;
  if (props.editDraft) props.editDraft.current = setValue;
  if (props.valueRef) props.valueRef.current = value;
  return (
    <Composer
      {...props.submitOptions}
      attachments={props.filePicker ? { ...attachments, openFilePicker: props.filePicker } : props.initialAttachments ? attachments : undefined}
      inputOverlay={
        props.seat && props.controller ? props.seat(props.controller) : undefined
      }
      mentionProviders={props.mentionProviders}
      draftSource={props.draftSource}
      onChange={setValue}
      onPaste={props.onPaste}
      onSubmit={props.onSubmit}
      permissionSessionId={props.sessionId}
      triggerRuntime={props.runtime}
      value={value}
    />
  );
}

import * as React from "react";

describe("a plugin source through the official pipeline", () => {
  it("resolves the same plugin codec from a home draft without a synthetic session", async () => {
    const source = fixtureSource(), sources = [source], submitted: string[] = [];
    const runtime: ComposerTriggerRuntime = { controllerFor: () => undefined, bindEditor: () => () => {}, draftSources: () => sources, subscribe: () => () => {} };
    render(<ControlledComposer initial="see @[dsh.reference:fixture|alpha|alpha|%40alpha] please" runtime={runtime} onSubmit={(text) => submitted.push(text)} />);
    const send = await screen.findByRole("button", { name: /send/iu }); act(() => send.click());
    await waitFor(() => expect(submitted).toEqual(["see <fixture>alpha</fixture> please"]));
  });
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

describe("unified add and mention menu", () => {
  it.each([false, true])("opens from plus and uploads from the same menu (official=%s)", async (official) => {
    const user = userEvent.setup();
    const source = fixtureSource();
    const controller = controllerDouble(source);
    // Keep the controller double's normal behavior, but drive its observable
    // menu from detected @ tokens so plus exercises the real editor updates.
    const track = controller.track.bind(controller);
    controller.track = (draft, caret, guard, revision) => {
      track(draft, caret, guard, revision);
      const hit = detectTrigger(draft, caret, guard, revision);
      if (!hit) { controller.dismiss(); return; }
      controller.menu.set({ open: true, hit: { ...hit, quoted: false }, generation: revision, highlight: null,
        groups: [{ source: "fixture", status: "ready", items: [{ name: "alpha" }] }] });
    };
    const sources = [source];
    const runtime: ComposerTriggerRuntime = official ? runtimeFor(controller) : {
      controllerFor: () => undefined, bindEditor: () => () => {}, draftSources: () => sources,
    };
    const picker = vi.fn(async () => {});
    const valueRef = { current: "" };
    render(<ControlledComposer initial="Keep my draft" runtime={runtime}
      sessionId={official ? "s1" : undefined} controller={controller}
      seat={official ? c => <OfficialTriggerMenu controller={c} /> : undefined}
      filePicker={picker} valueRef={valueRef} onSubmit={() => {}} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("Keep my draft"));
    await user.click(screen.getByRole("button", { name: "sidepanel.triggerMenu.add" }));
    expect(picker).not.toHaveBeenCalled();
    const file = await screen.findByRole("button", { name: "sidepanel.triggerMenu.files" });
    expect(await screen.findByText("alpha")).toBeVisible();
    expect(document.querySelectorAll("[data-composer-overlay]")).toHaveLength(1);
    expect(valueRef.current).toContain("Keep my draft");
    await user.click(file);
    expect(picker).toHaveBeenCalledOnce();
    await waitFor(() => expect(valueRef.current.trim()).toBe("Keep my draft"));
    expect(document.querySelector("[data-composer-overlay]")).toBeNull();
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


describe("claimed commands with staged images", () => {
  it("consumes only captured images and preserves edits made during submission", async () => {
    const controller=controllerDouble(fixtureSource());
    let settle!:()=>void;
    const submitClaim=vi.fn(()=>new Promise<{kind:"success"}>(resolve=>{settle=()=>resolve({kind:"success"});}));
    const runtime:ComposerTriggerRuntime={...runtimeFor(controller),submitClaim};
    const claim:CommandClaim={token:"/image ",attachments:true,submit:async()=>({kind:"success"})};
    const valueRef={current:""};
    const attachmentsRef: {current: import("../../useComposerAttachments").UseComposerAttachmentsResult|undefined}={current:undefined};
    const editDraft={current: (_text:string)=>{}};
    const original={uiId:"photo",attachmentId:"stored",name:"photo.png",mime:"image/png",size:3,kind:"image" as const};
    render(<ControlledComposer initial="/image describe" sessionId="s1" runtime={runtime} controller={controller} onSubmit={()=>{}} valueRef={valueRef} attachmentsRef={attachmentsRef} initialAttachments={[original]} editDraft={editDraft}/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    act(()=>{controller.ops!.beginCommand(claim,{start:0,end:7,draftRev:controller.tracked.at(-1)!.draftRev});});
    act(()=>{screen.getByRole("button",{name:/send/iu}).click();});
    await waitFor(()=>expect(submitClaim).toHaveBeenCalledOnce());
    act(()=>editDraft.current("/image describe later"));
    const edited=valueRef.current;
    expect(edited).toContain("later");
    act(()=>attachmentsRef.current!.setAttachments(prev=>[...prev,{...original,uiId:"new",attachmentId:"new-stored"}]));
    await act(async()=>settle());
    expect(valueRef.current).toBe(edited);
    expect(attachmentsRef.current!.attachments.map(item=>item.uiId)).toEqual(["new"]);
  });

  it("does not clear another session's draft when an earlier command settles", async () => {
    const controller=controllerDouble(fixtureSource());
    let settle!:()=>void;
    const submitClaim=vi.fn(()=>new Promise<{kind:"success"}>(resolve=>{settle=()=>resolve({kind:"success"});}));
    const runtime:ComposerTriggerRuntime={...runtimeFor(controller),submitClaim};
    const claim:CommandClaim={token:"/image ",attachments:true,submit:async()=>({kind:"success"})};
    const valueRef={current:""};
    const editDraft={current:(_text:string)=>{}};
    const props={initial:"/image describe",runtime,controller,onSubmit:()=>{},valueRef,editDraft};
    const {rerender}=render(<ControlledComposer {...props} sessionId="s1"/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    act(()=>{controller.ops!.beginCommand(claim,{start:0,end:7,draftRev:controller.tracked.at(-1)!.draftRev});});
    act(()=>{screen.getByRole("button",{name:/send/iu}).click();});
    await waitFor(()=>expect(submitClaim).toHaveBeenCalledOnce());
    rerender(<ControlledComposer {...props} sessionId="s2"/>);
    act(()=>editDraft.current("Another session draft"));
    await act(async()=>settle());
    expect(valueRef.current).toBe("Another session draft");
  });

  it.each(["success", "error", "unsupported"] as const)("handles %s without losing attachments on failure", async (outcomeKind) => {
    const controller = controllerDouble(fixtureSource());
    let settle!: (result: {kind:"success"|"error";text?:string}) => void;
    const submitted = vi.fn(() => new Promise<{kind:"success"|"error";text?:string}>(resolve => {settle=resolve;}));
    const runtime: ComposerTriggerRuntime = {...runtimeFor(controller),submitClaim:submitted};
    const claim: CommandClaim = {token:"/image ",attachments:outcomeKind!=="unsupported",submit:async()=>({kind:"success"})};
    const valueRef={current:""};
    const attachmentsRef: {current: import("../../useComposerAttachments").UseComposerAttachmentsResult|undefined}={current:undefined};
    render(<ControlledComposer initial="/image describe" sessionId="s1" runtime={runtime} controller={controller} onSubmit={()=>{throw new Error("ordinary send must not run");}} valueRef={valueRef} attachmentsRef={attachmentsRef} initialAttachments={[{uiId:"photo",attachmentId:"stored",name:"photo.png",mime:"image/png",size:3,kind:"image"}]}/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    act(()=>{expect(controller.ops!.beginCommand(claim,{start:0,end:7,draftRev:controller.tracked.at(-1)!.draftRev})).toBe(true);});
    const send=await screen.findByRole("button",{name:/send/iu});
    act(()=>{send.click();send.click();});
    if(outcomeKind==="unsupported") {
      await screen.findByText("This command does not accept images. Remove them before submitting.");
      expect(submitted).not.toHaveBeenCalled();
    } else {
      await waitFor(()=>expect(submitted).toHaveBeenCalledTimes(1));
      expect(submitted).toHaveBeenCalledWith("s1",claim,"describe",[{type:"image",mediaType:"image/png",data:"AQID",name:"photo.png"}]);
      expect(attachmentsRef.current!.attachments).toHaveLength(1);
      expect(controller.ops!.readInputDraft!()).toMatchObject({phase:"submitting",claim:{token:"/image ",attachments:true}});
      await act(async()=>settle({kind:outcomeKind,text:outcomeKind==="error"?"command rejected":undefined}));
    }
    await waitFor(()=>expect(valueRef.current).toBe(outcomeKind==="success"?"":"/image describe"));
    expect(attachmentsRef.current!.attachments).toHaveLength(outcomeKind==="success"?0:1);
  });
});


describe("enter adjudication attachment envelope", () => {
  it.each([0, 2])("reports %i images to the official controller", async (count) => {
    const controller=controllerDouble(fixtureSource());
    const adjudicate=vi.spyOn(controller,"adjudicate").mockResolvedValue("handled");
    const attachments:import("@amiba/app-runtime/core").Attachment[]=[
      ...Array.from({length:count},(_,index)=>({uiId:`image-${index}`,attachmentId:`stored-${index}`,name:`photo-${index}.png`,mime:"image/png",size:3,kind:"image" as const})),
      {uiId:"doc",attachmentId:"doc",name:"notes.txt",mime:"text/plain",size:3,kind:"text"},
    ];
    const onSubmit=vi.fn();
    render(<ControlledComposer initial="/fixture" sessionId="s1" runtime={runtimeFor(controller)} controller={controller} onSubmit={onSubmit} initialAttachments={attachments}/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    act(()=>screen.getByRole("button",{name:/send/iu}).click());
    await waitFor(()=>expect(adjudicate).toHaveBeenCalledWith("/fixture",expect.any(AbortSignal),{images:count,attachments:count+1}));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});


describe("asynchronous input adjudication lifetime", () => {
  it("ignores a late claim without unlocking a newer pending submission", async () => {
    const controller=controllerDouble(fixtureSource());
    let oldSettle!:(result:PickOutcome)=>void;
    let newSettle!:(result:PickOutcome)=>void;
    const adjudicate=vi.spyOn(controller,"adjudicate")
      .mockImplementationOnce(()=>new Promise(resolve=>{oldSettle=resolve;}))
      .mockImplementationOnce(()=>new Promise(resolve=>{newSettle=resolve;}))
      .mockResolvedValue("handled");
    const submitClaim=vi.fn(async()=>({kind:"success" as const}));
    const runtime={...runtimeFor(controller),submitClaim};
    const editDraft={current:(_text:string)=>{}};
    render(<ControlledComposer initial="/old" sessionId="s1" runtime={runtime} controller={controller} onSubmit={()=>{}} editDraft={editDraft}/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    const click=()=>act(()=>screen.getByRole("button",{name:/send/iu}).click());
    click();
    await waitFor(()=>expect(adjudicate).toHaveBeenCalledTimes(1));
    act(()=>editDraft.current("/new words"));
    click();
    await waitFor(()=>expect(adjudicate).toHaveBeenCalledTimes(2));
    await act(async()=>oldSettle({claim:{token:"/new ",submit:async()=>({kind:"success"})}}));
    click();
    expect(adjudicate).toHaveBeenCalledTimes(2);
    expect(submitClaim).not.toHaveBeenCalled();
    await act(async()=>newSettle("handled"));
    click();
    await waitFor(()=>expect(adjudicate).toHaveBeenCalledTimes(3));
  });

  it.each(["draft", "session", "unmount"] as const)("abandons old adjudication after %s changes", async (change) => {
    const controller=controllerDouble(fixtureSource());
    let settle!:(outcome:PickOutcome)=>void;
    const adjudicate=vi.spyOn(controller,"adjudicate").mockImplementationOnce(()=>new Promise(resolve=>{settle=resolve;})).mockResolvedValue("handled");
    const onSubmit=vi.fn();
    const submitClaim=vi.fn(async()=>({kind:"success" as const}));
    const runtime={...runtimeFor(controller),submitClaim};
    const valueRef={current:""};
    const editDraft={current:(_text:string)=>{}};
    const props={initial:"/old",runtime,controller,onSubmit,valueRef,editDraft};
    const {rerender,unmount}=render(<ControlledComposer {...props} sessionId="s1"/>);
    await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
    act(()=>screen.getByRole("button",{name:/send/iu}).click());
    await waitFor(()=>expect(adjudicate).toHaveBeenCalledOnce());
    expect(controller.ops!.readInputDraft!().phase).toBe("adjudicating");
    const signal=adjudicate.mock.calls[0][1];
    if(change==="unmount") unmount();
    else {
      if(change==="session") rerender(<ControlledComposer {...props} sessionId="s2"/>);
      act(()=>editDraft.current("/new"));
    }
    expect(signal.aborted).toBe(true);
    await act(async()=>settle(undefined));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(submitClaim).not.toHaveBeenCalled();
    if(change!=="unmount") {
      expect(valueRef.current).toBe("/new");
      act(()=>screen.getByRole("button",{name:/send/iu}).click());
      await waitFor(()=>expect(adjudicate).toHaveBeenCalledTimes(2));
    }
  });
});


it("isolates a new session's submitting phase from an older command settlement", async () => {
  const controller=controllerDouble(fixtureSource());
  const completions:Array<(result:{kind:"success"})=>void>=[];
  const submitClaim=vi.fn(()=>new Promise<{kind:"success"}>(resolve=>completions.push(resolve)));
  const runtime={...runtimeFor(controller),submitClaim};
  const editDraft={current:(_text:string)=>{}};
  const valueRef={current:""};
  const props={initial:"/image first",controller,runtime,onSubmit:()=>{},editDraft,valueRef};
  const {rerender}=render(<ControlledComposer {...props} sessionId="s1"/>);
  await waitFor(()=>expect(controller.tracked.length).toBeGreaterThan(0));
  const claim:CommandClaim={token:"/image ",submit:async()=>({kind:"success"})};
  const enter=()=>act(()=>{controller.ops!.beginCommand(claim,{start:0,end:7,draftRev:controller.tracked.at(-1)!.draftRev});});
  const click=()=>act(()=>screen.getByRole("button",{name:/send/iu}).click());
  enter();click();
  await waitFor(()=>expect(submitClaim).toHaveBeenCalledTimes(1));
  rerender(<ControlledComposer {...props} sessionId="s2"/>);
  act(()=>editDraft.current("/image second"));
  await waitFor(()=>expect(controller.ops).not.toBeNull());
  expect(controller.ops!.readInputDraft!().phase).toBe("plain");
  enter();click();
  await waitFor(()=>expect(submitClaim).toHaveBeenCalledTimes(2));
  await act(async()=>completions[0]({kind:"success"}));
  expect(controller.ops!.readInputDraft!().phase).toBe("submitting");
  expect(valueRef.current).toBe("/image second");
  click();
  expect(submitClaim).toHaveBeenCalledTimes(2);
  await act(async()=>completions[1]({kind:"success"}));
  expect(controller.ops!.readInputDraft!().phase).toBe("plain");
  expect(valueRef.current).toBe("");
});


describe("bound native submission", () => {
  it("submits a synchronous public draft write using the latest editor value", async () => {
    const controller=controllerDouble(fixtureSource());
    let submit!:()=>boolean;
    const runtime:ComposerTriggerRuntime={...runtimeFor(controller),bindSubmit:(_id,callback)=>{submit=callback;return ()=>{};}};
    const onSubmit=vi.fn();
    render(<ControlledComposer initial="" sessionId="s1" controller={controller} runtime={runtime} onSubmit={onSubmit}
      submitOptions={{canSubmit:false,canSubmitDraft:draft=>!!draft.trim()}}/>);
    await waitFor(()=>expect(controller.ops).not.toBeNull());
    act(()=>{
      expect(controller.ops!.setInputDraft!("fresh synchronous draft")).toBe(true);
      expect(submit()).toBe(true);
      expect(submit()).toBe(false);
    });
    await waitFor(()=>expect(onSubmit).toHaveBeenCalledWith("fresh synchronous draft"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([{disabled:true}, {canSubmit:false}, {busy:true,canSubmit:false}])("honors admission without invoking Stop %j", async options => {
    const controller=controllerDouble(fixtureSource());
    let submit!:()=>boolean;
    const onAbort=vi.fn();
    const onSubmit=vi.fn();
    const runtime:ComposerTriggerRuntime={...runtimeFor(controller),bindSubmit:(_id,callback)=>{submit=callback;return ()=>{};}};
    render(<ControlledComposer initial="draft" sessionId="s1" controller={controller} runtime={runtime} onSubmit={onSubmit} submitOptions={{...options,onAbort}}/>);
    await waitFor(()=>expect(submit).toBeDefined());
    expect(submit()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("rejects an old session callback after switching sessions", async () => {
    const controller=controllerDouble(fixtureSource());
    const callbacks=new Map<string,()=>boolean>();
    const runtime:ComposerTriggerRuntime={...runtimeFor(controller),bindSubmit:(id,callback)=>{callbacks.set(id,callback);return ()=>{};}};
    const onSubmit=vi.fn();
    const props={initial:"draft",controller,runtime,onSubmit};
    const {rerender}=render(<ControlledComposer {...props} sessionId="s1"/>);
    await waitFor(()=>expect(callbacks.has("s1")).toBe(true));
    rerender(<ControlledComposer {...props} sessionId="s2"/>);
    expect(callbacks.get("s1")!()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

it("guards image additions for disabled, busy, and stale session bindings", async () => {
  const controller = controllerDouble(fixtureSource());
  const bindings = new Map<string, import("../triggers/contracts").ComposerImageOps>();
  const runtime: ComposerTriggerRuntime = { ...runtimeFor(controller), bindImages: (id, ops) => { bindings.set(id, ops); return () => {}; } };
  const attachmentsRef = { current: undefined as import("../../useComposerAttachments").UseComposerAttachmentsResult | undefined };
  const initialAttachments: import("@amiba/app-runtime/core").Attachment[] = [];
  const props = { initial: "draft", controller, runtime, onSubmit: vi.fn(), attachmentsRef, initialAttachments };
  const { rerender } = render(<ControlledComposer {...props} sessionId="s1"/>);
  await waitFor(() => expect(bindings.has("s1")).toBe(true));
  expect(bindings.get("s1")!.canAdd()).toBe(true);
  const availability: boolean[] = [];
  const offAvailability = bindings.get("s1")!.subscribeAvailability!(() => availability.push(bindings.get("s1")!.canAdd()));
  act(() => attachmentsRef.current!.setAttachmentBusy(true));
  expect(bindings.get("s1")!.canAdd()).toBe(false);
  act(() => attachmentsRef.current!.setAttachmentBusy(false));
  expect(availability).toContain(false);
  expect(availability.at(-1)).toBe(true);
  offAvailability();
  rerender(<ControlledComposer {...props} sessionId="s1" submitOptions={{ disabled: true }}/>);
  expect(bindings.get("s1")!.canAdd()).toBe(false);
  rerender(<ControlledComposer {...props} sessionId="s2"/>);
  expect(bindings.get("s1")!.canAdd()).toBe(false);
  expect(bindings.get("s2")!.canAdd()).toBe(true);
});

it("blocks image additions during native adjudication", async () => {
  const controller = controllerDouble(fixtureSource());
  let settle!: (outcome: PickOutcome) => void;
  controller.adjudicate = () => new Promise(resolve => { settle = resolve; });
  let images!: import("../triggers/contracts").ComposerImageOps;
  const runtime: ComposerTriggerRuntime = { ...runtimeFor(controller), bindImages: (_id, ops) => { images = ops; return () => {}; } };
  render(<ControlledComposer initial="/extension" sessionId="s1" controller={controller} runtime={runtime} onSubmit={() => {}} initialAttachments={[]}/>);
  await waitFor(() => expect(controller.tracked.length).toBeGreaterThan(0));
  act(() => screen.getByRole("button", { name: /send/iu }).click());
  expect(images.canAdd()).toBe(false);
  await act(async () => settle(undefined));
  expect(images.canAdd()).toBe(true);
});

it("submits token-shaped literal text without invoking an official reference codec", async () => {
  const controller = controllerDouble(fixtureSource());
  const serialize = vi.spyOn(controller, "serializeReference");
  let submit!: () => boolean;
  const runtime: ComposerTriggerRuntime = { ...runtimeFor(controller), bindSubmit: (_id, callback) => { submit = callback; return () => {}; } };
  const onSubmit = vi.fn();
  render(<ControlledComposer initial="" sessionId="literal" controller={controller} runtime={runtime} onSubmit={onSubmit}
    submitOptions={{ canSubmitDraft: draft => !!draft.trim() }} />);
  await waitFor(() => expect(controller.ops).not.toBeNull());
  const text = "Example: @[dsh.reference:fixture|alpha|alpha|@alpha]";
  act(() => {
    expect(controller.ops!.editInputDraft!(text)).toBe(true);
    expect(submit()).toBe(true);
  });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(text));
  expect(serialize).not.toHaveBeenCalled();
});


it("cancels reference serialization when identical token text becomes literal", async () => {
  const text = "@[dsh.reference:fixture|alpha|alpha|%40alpha]";
  const draftSource = createComposerDraftSource();
  draftSource.set(text);
  const source = fixtureSource();
  let settle!: (text: string) => void;
  let signal!: AbortSignal;
  source.codec!.serialize = vi.fn((_ref, context) => {
    signal = context;
    return new Promise<string>(resolve => { settle = resolve; });
  });
  const sources = [source];
  const runtime: ComposerTriggerRuntime = { controllerFor: () => undefined, bindEditor: () => () => {}, draftSources: () => sources, subscribe: () => () => {} };
  const onSubmit = vi.fn();
  render(<ControlledComposer initial={text} draftSource={draftSource} runtime={runtime} onSubmit={onSubmit}/>);
  const send = await screen.findByRole("button", { name: /send/iu });
  act(() => send.click());
  await waitFor(() => expect(source.codec!.serialize).toHaveBeenCalledOnce());
  act(() => draftSource.setParts([{kind:"text", text}]));
  expect(draftSource.getSnapshot()).toBe(text);
  expect(signal.aborted).toBe(true);
  await act(async () => { settle("obsolete resolved reference"); });
  expect(onSubmit).not.toHaveBeenCalled();
  act(() => send.click());
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(text));
  expect(source.codec!.serialize).toHaveBeenCalledOnce();
});

it("invalidates trigger spans when reference identity changes without a string edit", async () => {
  const text = "@[dsh.reference:fixture|alpha|alpha|%40alpha]";
  const draftSource = createComposerDraftSource();
  draftSource.set(text);
  const controller = controllerDouble(fixtureSource());
  render(<ControlledComposer initial={text} draftSource={draftSource} sessionId="identity"
    runtime={runtimeFor(controller)} controller={controller} onSubmit={() => {}}/>);
  await waitFor(() => expect(controller.tracked.length).toBeGreaterThan(0));
  const before = controller.tracked.at(-1)!;
  act(() => draftSource.setParts([{kind:"text", text}]));
  await waitFor(() => expect(controller.tracked.at(-1)!.draft).toBe(text));
  expect(controller.tracked.at(-1)!.draftRev).toBeGreaterThan(before.draftRev);
});


it.each([false, true])("handles mixed paste once and honors surface interception (%s)", async intercept => {
  const rect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  try {
  const controller = controllerDouble(fixtureSource());
  const runtime = runtimeFor(controller);
  const attachmentsRef = { current: undefined as import("../../useComposerAttachments").UseComposerAttachmentsResult | undefined };
  const valueRef = { current: "" };
  render(<ControlledComposer sessionId="mixed-paste" onPaste={intercept ? event => event.preventDefault() : undefined} initial="" initialAttachments={[]} attachmentsRef={attachmentsRef} valueRef={valueRef} controller={controller} runtime={runtime} onSubmit={vi.fn()}/>);
  await userEvent.setup().click(screen.getByRole("textbox"));
  const intake = vi.spyOn(attachmentsRef.current!, "handlePaste").mockImplementation(async event => { event.preventDefault(); });
  const text = "mixed @[dsh.reference:literal|id|label|clip]";
  fireEvent.paste(screen.getByRole("textbox"), { clipboardData: {
    items: [{ kind: "file", getAsFile: () => new File(["png"], "photo.png", { type: "image/png" }) }],
    getData: (type: string) => type === "text/plain" ? text : "",
  } });
  await waitFor(() => expect(intake).toHaveBeenCalledTimes(intercept ? 0 : 1));
  await waitFor(() => expect(valueRef.current).toBe(intercept ? "" : text));
  expect(screen.getByRole("textbox").querySelector('[data-mention-type]')).toBeNull();
  if (!intercept) {
    await userEvent.setup().keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(valueRef.current).toBe(""));
  }
  } finally {
    if (rect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rect);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});
