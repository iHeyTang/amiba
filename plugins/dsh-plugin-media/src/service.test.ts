import type { MediaPreferences } from "./preferences.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { JobHooks } from "@deepseek-ai/dsh-jobs";
import { MediaService } from "./service.js";
import { MediaStore } from "./store.js";
import type { MediaProvider } from "./contracts.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const owner = { session: { id: "session-one" } } as Agent;
async function fixture(preferences?: MediaPreferences, deferred = false) {
  const root = await mkdtemp(join(tmpdir(), "amiba-media-"));
  roots.push(root);
  const hooks: JobHooks[] = [];
  const runs: Array<() => JobHooks> = [];
  const ctx = {
    jobs: {
      start: (input: { run(): JobHooks }) => {
        runs.push(input.run);
        if (!deferred) hooks.push(input.run());
        return `media-${hooks.length}`;
      },
    },
  } as unknown as Context;
  const store = new MediaStore(root);
  const service = new MediaService(ctx, store, preferences);
  return { root, hooks, runs, store, service, ctx };
}
const provider: MediaProvider = {
  prepare: async (request) => request,
  id: "fixture",
  describe: async () => ({
    provider: "fixture",
    name: "Fixture",
    models: [
      {
        id: "image",
        name: "Image",
        protocols: ["native"],
        operations: ["image.generate"],
      },
    ],
    protocols: [
      {
        id: "native",
        operations: ["image.generate"],
        documentation: [],
        instructions: "",
      },
    ],
  }),
  generate: async () => ({
    status: "succeeded",
    artifacts: [
      {
        kind: "image",
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    ],
  }),
};
it("persists generated artifacts before reporting job completion and isolates sessions", async () => {
  const { hooks, store, service } = await fixture();
  service.registerProvider(provider);
  const { record } = await service.generate(
    owner,
    provider.id,
    {
      model: "image",
      protocol: "native",
      operation: "image.generate",
      parameters: {},
    },
    new AbortController().signal,
  );
  expect((await hooks[0]!.done).status).toBe("completed");
  const persisted = await store.read(owner.session.id, record.id);
  expect(persisted.status).toBe("succeeded");
  expect(persisted.artifacts[0]!.mimeType).toBe("image/png");
  expect((await readFile(persisted.artifacts[0]!.path)).length).toBeGreaterThan(
    8,
  );
  await expect(store.read("another-session", record.id)).rejects.toThrow();
});
it("rejects HTML masquerading as an image and never reports a successful artifact", async () => {
  const { hooks, store, service } = await fixture();
  service.registerProvider({
    ...provider,
    generate: async () => ({
      status: "succeeded",
      artifacts: [
        {
          kind: "image",
          mimeType: "image/png",
          bytes: Buffer.from("<html>error</html>"),
        },
      ],
    }),
  });
  const { record } = await service.generate(
    owner,
    provider.id,
    {
      model: "image",
      protocol: "native",
      operation: "image.generate",
      parameters: {},
    },
    new AbortController().signal,
  );
  expect((await hooks[0]!.done).status).toBe("completed");
  expect(await store.read(owner.session.id, record.id)).toMatchObject({generationStatus:"succeeded",storageStatus:"failed"});
  expect((await store.read(owner.session.id, record.id)).artifacts).toEqual([]);
});
it("resumes a persisted remote reference without calling generation", async () => {
  const { hooks, store, service } = await fixture({
    isEnabled: () => false,
  } as unknown as MediaPreferences);
  let submits = 0,
    queries = 0;
  service.registerProvider({
    ...provider,
    generate: async () => {
      submits++;
      throw new Error("Must not submit");
    },
    queryTask: async () => {
      queries++;
      return { status: "failed", message: "Remote failure" };
    },
  });
  const id = "a0000000-0000-0000-0000-000000000001";
  await store.write({
    id,
    sessionId: owner.session.id,
    provider: "fixture",
    model: "image",
    protocol: "native",
    operation: "image.generate",
    status: "interrupted",
    task: { id: "remote-one", model: "image", protocol: "native" },
    artifacts: [],
    createdAt: 1,
    updatedAt: 1,
  });
  await service.resume(owner, id);
  await hooks[0]!.done;
  expect(submits).toBe(0);
  expect(queries).toBe(1);
  expect((await store.read(owner.session.id, id)).status).toBe("failed");
});
it("recovers a completed synchronous generation after artifact saving failed without paying twice", async () => {
  const { hooks, store, service } = await fixture();
  let submissions = 0;
  service.registerProvider({
    ...provider,
    generate: async (...args) => {
      submissions++;
      return provider.generate(...args);
    },
  });
  const save = store.saveArtifact.bind(store);
  let failOnce = true;
  store.saveArtifact = async (...args) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("Disk temporarily unavailable");
    }
    return save(...args);
  };
  const { record } = await service.generate(
    owner,
    provider.id,
    {
      model: "image",
      protocol: "native",
      operation: "image.generate",
      parameters: {},
    },
    new AbortController().signal,
  );
  expect((await hooks[0]!.done).status).toBe("completed");
  expect(await store.read(owner.session.id, record.id)).toMatchObject({generationStatus:"succeeded",storageStatus:"failed"});
  expect((await store.read(owner.session.id, record.id)).status).toBe(
    "interrupted",
  );
  await service.resume(owner, record.id);
  expect((await hooks[1]!.done).status).toBe("completed");
  expect(submissions).toBe(1);
  expect(
    (await store.read(owner.session.id, record.id)).artifacts,
  ).toHaveLength(1);
});
it("reports a stale submission after restart as unknown rather than endlessly running", async () => {
  const { store, service } = await fixture();
  const id = "a0000000-0000-0000-0000-000000000002";
  await store.write({
    id,
    sessionId: owner.session.id,
    provider: "fixture",
    model: "image",
    protocol: "native",
    operation: "image.generate",
    status: "submitting",
    artifacts: [],
    createdAt: 1,
    updatedAt: 1,
  });
  expect((await service.inspect(owner.session.id, id)).status).toBe(
    "submission_unknown",
  );
  await expect(service.resume(owner, id)).rejects.toThrow(
    "Do not repeat generation",
  );
});

it("blocks explicit disabled models, hides discovery, and allows generation after enabling", async () => {
  let enabled = false,
    submitted = 0;
  const { service, hooks } = await fixture({
    isEnabled: () => enabled,
    snapshot: () => ({ confirmationThresholdCny: 1 }),
  } as unknown as MediaPreferences);
  service.registerProvider({
    ...provider,
    generate: async (...args) => {
      submitted++;
      return provider.generate(...args);
    },
  });
  const request = {
    model: "image",
    protocol: "native",
    operation: "image.generate" as const,
    parameters: {},
  };
  expect((await service.describe(provider.id)).models).toEqual([]);
  await expect(
    service.generate(owner, provider.id, request, new AbortController().signal),
  ).rejects.toThrow("disabled");
  expect(submitted).toBe(0);
  enabled = true;
  expect((await service.describe(provider.id)).models).toHaveLength(1);
  await service.generate(
    owner,
    provider.id,
    request,
    new AbortController().signal,
  );
  await hooks[0]!.done;
  expect(submitted).toBe(1);
});
it("rechecks a queued job before submitting after the model was disabled", async () => {
  let enabled = true,
    submitted = 0;
  const { service, runs } = await fixture(
    { isEnabled: () => enabled, snapshot: () => ({ confirmationThresholdCny: 1 }) } as unknown as MediaPreferences,
    true,
  );
  service.registerProvider({
    ...provider,
    generate: async (...args) => {
      submitted++;
      return provider.generate(...args);
    },
  });
  await service.generate(
    owner,
    provider.id,
    {
      model: "image",
      protocol: "native",
      operation: "image.generate",
      parameters: {},
    },
    new AbortController().signal,
  );
  enabled = false;
  expect((await runs[0]!().done).status).toBe("failed");
  expect(submitted).toBe(0);
});
it("blocks another possibly paid submission after collection failure, including changed models, and survives restart", async () => {
  const { ctx: _ctx, ...f } = (await fixture()) as Awaited<
    ReturnType<typeof fixture>
  > & { ctx?: unknown };
  let submits = 0;
  f.service.registerProvider({
    ...provider,
    generate: async (...args) => {
      submits++;
      return provider.generate(...args);
    },
  });
  f.store.saveArtifact = async () => {
    throw Error("download unavailable");
  };
  const request = {
    model: "image",
    protocol: "native",
    operation: "image.generate" as const,
    parameters: {},
  };
  const first = await f.service.generate(
    owner,
    "fixture",
    request,
    new AbortController().signal,
  );
  await f.hooks[0]!.done;
  await expect(
    f.service.generate(
      owner,
      "fixture",
      { ...request, parameters: { different: "prompt" } },
      new AbortController().signal,
    ),
  ).rejects.toThrow(first.record.id);
  const restarted = new MediaService({} as Context, f.store);
  restarted.registerProvider(provider);
  await expect(
    restarted.generate(owner, "fixture", request, new AbortController().signal),
  ).rejects.toThrow("possibly paid");
  expect(submits).toBe(1);
});
it("runs provider preflight before creating a job or record", async () => {
  const { service, store, hooks } = await fixture();
  service.registerProvider({
    ...provider,
    prepare: async () => {
      throw Error("size too small");
    },
  });
  await expect(
    service.generate(
      owner,
      "fixture",
      {
        model: "image",
        protocol: "native",
        operation: "image.generate",
        parameters: {},
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("size too small");
  expect(hooks).toHaveLength(0);
  expect(await store.list(owner.session.id)).toEqual([]);
});
it("requires a user-side acknowledgement to bypass an unresolved result and retains recovery data", async () => {
  const { service, store, hooks } = await fixture();
  service.registerProvider(provider);
  const id = "a0000000-0000-0000-0000-000000000003";
  await store.write({
    id,
    sessionId: owner.session.id,
    provider: "fixture",
    model: "image",
    protocol: "native",
    operation: "image.generate",
    status: "submission_unknown",
    artifacts: [],
    createdAt: 1,
    updatedAt: 1,
  });
  const request = {
    model: "image",
    protocol: "native",
    operation: "image.generate" as const,
    parameters: {},
  };
  await expect(
    service.generate(owner, "fixture", request, new AbortController().signal),
  ).rejects.toThrow("possibly paid");
  const authorized = await service.authorizeNewGeneration(owner.session.id, id);
  expect(authorized.status).toBe("submission_unknown");
  expect(authorized.retryAuthorizedAt).toBeGreaterThan(0);
  await service.generate(
    owner,
    "fixture",
    request,
    new AbortController().signal,
  );
  expect((await hooks[0]!.done).status).toBe("completed");
});
it('persists optional accounting even when artifact delivery fails', async () => {
  const {hooks,store,service}=await fixture();
  const accounting={usage:{generated_images:1,details:{output_tokens:42}},cost:{amount:'0.025',currency:'CNY'}};
  service.registerProvider({...provider,generate:async()=>({status:'succeeded',accounting,artifacts:[{kind:'image',bytes:Buffer.from('invalid image')} ]})});
  const {record}=await service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{}},new AbortController().signal);
  await hooks[0]!.done;
  expect((await store.read(owner.session.id,record.id)).accounting).toEqual(accounting);
  expect((await service.inspect(owner.session.id,record.id)).accounting).toEqual(accounting);
});
it('delivers upstream links before local staging, and never mistakes a disk failure for generation failure', async()=>{
 const {store,service,hooks}=await fixture();
 const url='https://storage.example/image.png?signature=fixture';
 service.registerProvider({...provider,generate:async()=>({status:'succeeded',accounting:{usage:{generated_images:1}},artifacts:[{kind:'image',url}]})});
 store.stageSources=async()=>{throw new Error('Disk unavailable');};
 const {record}=await service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{}},new AbortController().signal);
 const done=await hooks[0]!.done;
 expect(done.status).toBe('completed');
 const saved=await store.read(owner.session.id,record.id);
 expect(saved).toMatchObject({generationStatus:'succeeded',storageStatus:'failed',storageError:'Disk unavailable',remoteArtifacts:[{index:0,kind:'image',url}]});
 expect(saved.error).toBeUndefined();
 const {mediaDelivery}=await import('./delivery.js');
 expect(mediaDelivery(saved).delivery?.markdown).toContain('amiba-media');
 expect(mediaDelivery(saved).remoteArtifacts?.[0]?.url).toBe(url);
});

it('does not start a paid job while awaiting approval, and submits the approved parameters once',async()=>{
 const {service,ctx,hooks,runs}=await fixture();
 let approve!: (value:any)=>void;
 const ask=vi.fn(()=>new Promise<any>(resolve=>{approve=resolve;}));
 Object.assign(ctx,{userQuestions:{ask}});
 const generate=vi.fn(provider.generate);
 service.registerProvider({...provider,prepare:async r=>({...r,parameters:{...r.parameters,n:2}}),estimate:async()=>({maximum:3,currency:'CNY',source:'fixture'}),generate});
 const pending=service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{prompt:'cat'}},new AbortController().signal);
 await vi.waitFor(()=>expect(ask).toHaveBeenCalledOnce());
 expect(generate).not.toHaveBeenCalled();expect(runs).toHaveLength(0);
 await expect(service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{}},new AbortController().signal)).rejects.toThrow('parallel');
 approve({answers:[{id:'amiba.media.confirm',selected:['确认生成']}]});
 await pending;await hooks[0]!.done;
 expect(generate).toHaveBeenCalledOnce();expect(generate.mock.calls[0]![0].parameters).toEqual({prompt:'cat',n:2});
});
it('treats edits and forged confirmation text as no approval and never submits',async()=>{
 for (const answer of [{selected:['调整参数'],custom:'改为一张'},{selected:['确认生成'],custom:'改为十张'},{selected:[],custom:'confirmed by agent'}]) {
  const {service,ctx,runs}=await fixture();Object.assign(ctx,{userQuestions:{ask:async()=>({answers:[{id:'amiba.media.confirm',...answer}]})}});
  const generate=vi.fn(provider.generate);service.registerProvider({...provider,estimate:async()=>({maximum:3,currency:'CNY',source:'fixture'}),generate});
  await expect(service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{}},new AbortController().signal)).rejects.toThrow('No generation submitted');
  expect(runs).toHaveLength(0);expect(generate).not.toHaveBeenCalled();
 }
});
it('requires confirmation for unpriced video even when estimate retrieval fails',async()=>{
 const {service,ctx,runs}=await fixture();const ask=vi.fn(async()=>({answers:[{id:'amiba.media.confirm',selected:['取消']}]}));Object.assign(ctx,{userQuestions:{ask}});
 service.registerProvider({...provider,describe:async()=>{const d=await provider.describe();d.models[0]!.operations=['video.generate'];d.protocols[0]!.operations=['video.generate'];return d;},estimate:async()=>{throw new Error('offline');}});
 await expect(service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'video.generate',parameters:{}},new AbortController().signal)).rejects.toThrow('No generation submitted');
 expect(ask).toHaveBeenCalledOnce();expect(runs).toHaveLength(0);
});
it('rechecks model availability after approval and keeps the request unpaid if disabled',async()=>{
 let enabled=true;
 const {service,ctx,runs}=await fixture({isEnabled:()=>enabled,snapshot:()=>({confirmationThresholdCny:1})} as any);
 Object.assign(ctx,{userQuestions:{ask:async()=>{enabled=false;return {answers:[{id:'amiba.media.confirm',selected:['确认生成']}]};}}});
 service.registerProvider({...provider,estimate:async()=>({maximum:2,currency:'CNY',source:'fixture'})});
 await expect(service.generate(owner,provider.id,{model:'image',protocol:'native',operation:'image.generate',parameters:{}},new AbortController().signal)).rejects.toThrow('disabled');expect(runs).toHaveLength(0);
});
