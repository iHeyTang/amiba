import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { extractBundleClosure } from "../../scripts/extract-bundle-closure.mjs";

const bundle = readFileSync(
  "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
  "utf8",
);
const closure = extractBundleClosure(bundle, ["registerConversationNodes"]);
const standalone = readFileSync(
  "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/headless.js",
  "utf8",
);
const names = [
  ...new Set(
    [
      ...closure.matchAll(
        /_deepseek_ai_dsh_client_runtime_client\.([A-Za-z0-9_]+)/g,
      ),
    ].map((match) => match[1]!),
  ),
];
const runtimeSource = readFileSync(
  "node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js",
  "utf8",
);
const runtimeClosure = extractBundleClosure(runtimeSource, [
  "ConversationNodeAssembler",
  ...names,
]);
const runtime = Function(
  `${runtimeClosure}; return {ConversationNodeAssembler,${names.join(",")}};`,
)();
const register = Function(
  "runtime",
  standalone
    .replace(
      'import * as _deepseek_ai_dsh_client_runtime_client from "@deepseek-ai/dsh-client-runtime/client";',
      "const _deepseek_ai_dsh_client_runtime_client = runtime;",
    )
    .replace(
      "export { registerConversationNodes };",
      "return registerConversationNodes;",
    ),
)(runtime);

it("packages the exact dependency closure with no UI or DOM imports", () => {
  expect(standalone).toBe(
    closure.replace(
      'let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");',
      'import * as _deepseek_ai_dsh_client_runtime_client from "@deepseek-ai/dsh-client-runtime/client";',
    ) + "\nexport { registerConversationNodes };\n",
  );
  expect(standalone).not.toMatch(/react|document\.|window\./);
  expect(runtimeClosure).not.toContain("require(");
});
function definitions() {
  const events: any[] = [],
    fallbacks: any[] = [],
    views: any[] = [];
  register({
    conversationEvents: {
      register: (value: any) => events.push(value),
      registerFallback: (value: any) => fallbacks.push(value),
    },
    conversationViews: { register: (value: any) => views.push(value) },
  });
  return { events, fallbacks, views };
}
it("can register official business definitions without mounting the official UI", () => {
  const { events, fallbacks, views } = definitions();
  expect(events.map((value) => value.kind)).toContain("turn-tail");
  expect(events.map((value) => value.kind)).toContain("assistant-step");
  expect(new Set(events.map((value) => value.kind)).size).toBe(events.length);
  expect(fallbacks).toHaveLength(1);
  expect(views.map((value) => value.target)).toEqual(["chat"]);
});
it("keeps exact engine timeline references when the chat has no visible nodes", () => {
  const { views } = definitions();
  const builder = views[0].create();
  const timeline = { turnOrder: [], turns: new Map() };
  const snapshot = builder.replace({ nodes: [], timeline });
  expect(snapshot.timeline).toBe(timeline);
  expect(snapshot.order).toEqual([]);
});

function engine() {
  const { events, fallbacks, views } = definitions();
  return new runtime.ConversationNodeAssembler(
    { entries: () => events, fallbackEntry: () => fallbacks[0] },
    { entries: () => views },
  );
}
const event = (type: string, seq: number, data = {}) => ({
  event: {
    type,
    seq,
    time: seq * 100,
    surfaceOp: "append",
    data: { turn: 1, step: 1, ...data },
  },
});
const rows = () => [
  event("turn/start", 1),
  event("step/start", 2),
  event("assistant/message", 3, {
    message: {
      id: "assistant-final",
      role: "assistant",
      content: [{ type: "text", text: "Finished" }],
    },
  }),
  event("step/end", 4),
  event("turn/end", 5, { reason: { kind: "completed" } }),
];
for (const mode of ["history", "live"]) {
  it(`${mode} projects actual engine boundaries and closing assistant identity`, () => {
    const instance = engine();
    if (mode === "history") instance.replaceWindow(rows(), false);
    else
      for (const row of rows()) {
        instance.append(row);
        instance.flush();
      }
    instance.flush();
    const snapshot = instance.snapshot("chat");
    const turn = snapshot.timeline.turns.get(1);
    expect(turn.status).toBe("closed");
    expect(turn.start.seq).toBe(1);
    expect(turn.end.seq).toBe(5);
    expect(turn.steps[0].start.seq).toBe(2);
    const tail = turn.data.get("turn-tail");
    expect(tail.seq).toBe(5);
    expect(tail.closing.finalNode.messageId).toBe("assistant-final");
    expect(tail.closing.finalNode.seq).toBe(3);
    expect(
      snapshot.nodes.values().find((node: any) => node.kind === "turn-tail")
        .location.turn,
    ).toBe(turn);
  });
}

it("keeps tool results attached to their call across registry rebuild and history replay", () => {
  const instance = engine();
  const input = [
    event("turn/start", 1), event("step/start", 2),
    event("tool/call", 3, { callId: "call-1", name: "read", arguments: '{"path":"a.txt"}' }),
    event("tool/result", 4, { message: { source: { callId: "call-1" }, content: [{ type: "tool-result", content: [{ type: "text", text: "contents" }], isError: false }] } }),
    event("step/end", 5), event("turn/end", 6, { reason: { kind: "completed" } }),
  ];
  instance.replaceWindow(input, false);
  instance.flush();
  const summarize = () => {
    const snapshot = instance.snapshot("chat");
    return { order: [...snapshot.order], nodes: snapshot.nodes.values().map((node: any) => ({ kind: node.kind, data: node.data })) };
  };
  const before = summarize();
  expect(JSON.stringify(before)).toContain("call-1");
  expect(JSON.stringify(before)).toContain("contents");
  expect(instance.snapshot("chat").timeline.turns.get(1).data.get("turn-tail").closing).toBeNull();
  instance.rebuildRegistry(); instance.flush();
  expect(summarize()).toEqual(before);
  instance.replaceWindow(input, false); instance.flush();
  expect(summarize()).toEqual(before);
});

it("does not publish a footer for an unfinished turn", () => {
  const instance = engine();
  instance.replaceWindow(rows().slice(0, -1), false); instance.flush();
  const snapshot = instance.snapshot("chat");
  expect(snapshot.timeline.turns.get(1).status).toBe("open");
  expect(snapshot.timeline.turns.get(1).data.get("turn-tail")).toBeUndefined();
  expect(snapshot.nodes.values().some((node: any) => node.kind === "turn-tail")).toBe(false);
});


it("feeds the official produced-files selector real turn data across rebuilds", () => {
  const deliverablesSource=readFileSync("../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js","utf8");
  const selected=extractBundleClosure(deliverablesSource,["deliverablesDefinition","selectProducedFiles"]);
  const {definition,select}=Function("runtime",selected.replace('require("@deepseek-ai/dsh-client-runtime/client")',"runtime")+";return {definition:deliverablesDefinition,select:selectProducedFiles};")(runtime);
  const {events,fallbacks,views}=definitions();
  let entries=[...events,definition];
  const instance=new runtime.ConversationNodeAssembler({entries:()=>entries,fallbackEntry:()=>fallbacks[0]},{entries:()=>views});
  const rows:any[]=[event("turn/start",1),event("step/start",2)];
  let seq=3;
  function call(id:string,path:string,card:string,isError=false){
    const row:any=event("tool/call",seq++,{callId:id,name:"fixture",arguments:"{}"});
    row.view={for:"call",view:{card,kind:"read",locations:[{path}]}};
    rows.push(row,event("tool/result",seq++,{message:{source:{callId:id},content:[{type:"tool-result",toolCallId:id,content:[],isError}]}}));
  }
  call("write","made.txt","diff");
  call("again","made.txt","diff");
  call("read","read.txt","generic");
  call("failed","failed.txt","diff",true);
  const closingSeq=seq++;
  rows.push(event("assistant/message",closingSeq,{message:{id:"final",content:[{type:"text",text:"Done"}]}}));
  call("later","late.txt","diff");
  rows.push(event("step/end",seq++),event("turn/end",seq++,{reason:{kind:"completed"}}));
  instance.replaceWindow(rows,false);instance.flush();
  const owner=()=>({turn:instance.snapshot("chat").timeline.turns.get(1),seq:closingSeq});
  expect(owner().turn.data.get("deliverables").produced.map((p:any)=>p.path)).toEqual(["made.txt","made.txt","late.txt"]);
  expect(select(owner())).toEqual(["made.txt"]);
  entries=events;instance.rebuildRegistry();instance.flush();
  expect(select(owner())).toBeNull();
  entries=[...events,definition];instance.rebuildRegistry();instance.flush();
  expect(select(owner())).toEqual(["made.txt"]);
  instance.append(event("turn/start",seq++,{turn:2}));
  instance.append(event("turn/end",seq++,{turn:2,reason:{kind:"blocked"}}));
  instance.flush();
  expect(select({turn:instance.snapshot("chat").timeline.turns.get(2),seq})).toBeNull();
  expect(select(owner())).toEqual(["made.txt"]);
});
