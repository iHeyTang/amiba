import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import { SystemPrompt, PERSONA_SECTION } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { ConversationLifecycle } from "@amiba/dsh-plugin-session-features";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { StewardRegistryStore } from "./registry-store.js";
import { StewardRegistryService } from "./registry.js";
import {
  installRegistryExtension,
  registerStewardLifecycleTools,
} from "./registry-extension.js";
import { harness } from "./test/service-harness.js";

it("rebuilds the correct persona on the first assembly, after edits and after rollover", async () => {
  const h = harness();
  const dir = mkdtempSync(join(tmpdir(), "steward-extension-"));
  const lifecycle = new ConversationLifecycle(dir);
  h.reflectServices.set("amibaConversations", lifecycle);
  const registry = new StewardRegistryService(
    { ...h.ctx, amibaConversations: lifecycle } as never,
    new StewardRegistryStore(dir),
    { defaultCwd: "/default" },
  );
  await registry.initialize();
  await registry.update("main", {
    name: "A",
    responsibilities: "A duties",
    background: "A PRIVATE",
    context: "A pending",
  });
  const b = await registry.create({
    name: "B",
    responsibilities: "B duties",
    background: "B PRIVATE",
    context: "B pending",
  });
  const aSession = await registry.engine("main").ensureStewardSessionId();
  await registry
    .engine("main")
    .dispatch({ newTask: { title: "A task" }, message: "go" });
  const root = new Context();
  const prompt = root.plugin(SystemPrompt, { includeRuntimeContext: false });
  await prompt;
  const tools = root.plugin(ToolRuntime, {});
  await tools;
  const test = root.inject(["systemPrompt", "tools"], async (ctx) => {
    const scopeKey = {};
    const scope = createScope(ctx, scopeKey);
    const cleanup = installRegistryExtension(scope.ctx, registry);
    try {
      const assemble = async (sessionId: string) =>
        scope.ctx.systemPrompt.assemble({
          scope: scopeKey,
          agent: { id: sessionId, session: { id: sessionId } } as never,
        });
      const persona = (assembly: Awaited<ReturnType<typeof assemble>>) =>
        assembly.sections.find((section) => section.name === PERSONA_SECTION)!
          .text;
      expect(persona(await assemble(aSession))).toContain("A PRIVATE");
      expect(persona(await assemble(aSession))).toContain("A task");
      expect(persona(await assemble(aSession))).not.toContain("B PRIVATE");
      await registry.update("main", {
        ...registry.profile("main"),
        context: "changed decision",
      });
      expect(persona(await assemble(aSession))).toContain("changed decision");
      await registry.engine("main").conversationSettings("new");
      const next = await registry
        .engine("main")
        .prepareStewardSession(aSession);
      expect(persona(await assemble(next))).toContain("changed decision");
      expect(persona(await assemble(next))).toContain("A task");
      await registry.remove("main");
      await expect(assemble(next)).rejects.toThrow("not_owned");
      expect(registry.profile(b.id).context).toBe("B pending");
    } finally {
      await cleanup();
      await scope.dispose();
    }
  });
  try {
    await test;
  } finally {
    await test.dispose();
    await tools.dispose();
    await prompt.dispose();
    await registry.dispose();
  }
});

it("creates from ordinary chat with no steward and binds management tools to actual callers", async () => {
  const h = harness();
  const dir = mkdtempSync(join(tmpdir(), "steward-conversational-"));
  const lifecycle = new ConversationLifecycle(dir);
  h.reflectServices.set("amibaConversations", lifecycle);
  const ctx = { ...h.ctx, amibaConversations: lifecycle };
  const registry = new StewardRegistryService(
    ctx as never,
    new StewardRegistryStore(dir),
    { defaultCwd: "/default" },
  );
  await registry.initialize();
  await registry.remove("main");
  const definitions = new Map<string, ToolDefinition>();
  const toolsCtx = {
    ...ctx,
    tools: {
      register: (definition: ToolDefinition) => {
        definitions.set(definition.name, definition);
        return () => {};
      },
    },
  };
  registerStewardLifecycleTools(toolsCtx as never, registry);
  const created = (await definitions.get("steward_create")!.execute(
    {
      name: "Named",
      responsibilities: "User's requested duties",
      background: "Initial facts",
    },
    {} as never,
  )) as { content: { text: string }[] };
  const item = JSON.parse(created.content[0]!.text);
  expect(item).toMatchObject({
    name: "Named",
    background: "Initial facts",
    context: "",
    entryId: item.id,
  });
  const second = await registry.create({
    name: "Other",
    responsibilities: "Other duties",
    background: "secret",
    context: "",
  });
  const sessionId = await registry.engine(item.id).ensureStewardSessionId();
  await expect(
    definitions
      .get("steward_delete")!
      .execute({ id: second.id }, { agent: { id: sessionId } } as never),
  ).rejects.toThrow("cannot_modify_another");
  const scoped = new Map<string, ToolDefinition>();
  installRegistryExtension(
    {
      ...toolsCtx,
      systemPrompt: { section: () => () => {} },
      tools: {
        register: (definition: ToolDefinition) => {
          scoped.set(definition.name, definition);
          return () => {};
        },
        guard: () => () => {},
      },
    } as never,
    registry,
  );
  const work = await registry
    .engine(second.id)
    .dispatch({ newTask: { title: "Other task" }, message: "work" });
  await expect(
    scoped
      .get("steward_read_task")!
      .execute({ task_id: work.taskId }, { agent: { id: sessionId } } as never),
  ).rejects.toThrow("unknown task");
  await expect(
    scoped
      .get("steward_list_tasks")!
      .execute({}, { agent: { id: "fork" } } as never),
  ).rejects.toThrow("not_owned");
  await scoped.get("steward_remember")!.execute({ context: "saved decision" }, {
    agent: { id: sessionId },
  } as never);
  expect(registry.profile(item.id).context).toBe("saved decision");
  expect(registry.profile(second.id).context).toBe("");
  await registry.dispose();
});
