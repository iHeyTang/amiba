import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import { SystemPrompt, PERSONA_SECTION } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { installStewardExtension } from "./session-extension.js";

for (const preset of ["standard", "code", "minimal", "cordis"]) {
  it(`adds the steward to ${preset} without modifying the base or siblings`, async () => {
    expect.assertions(preset === "code" ? 7 : 5);
    const root = new Context();
    root.provide("codeRuntime", { language: "typescript" } as never);
    const promptFiber = root.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      persona: "host",
      includeRuntimeContext: false,
    });
    await promptFiber;
    const toolsFiber = root.plugin(ToolRuntime, {});
    await toolsFiber;
    const testFiber = root.inject(["systemPrompt", "tools"], async (ctx) => {
      const baseKey = {};
      const base = createScope(ctx, baseKey);
      base.ctx.systemPrompt.section({
        name: PERSONA_SECTION,
        order: 0,
        text: "base persona",
        complete: preset === "minimal",
      });
      if (preset === "code") base.ctx.tools.presentAs("code");
      const key = {},
        otherKey = {};
      const agent = createScope(ctx, key, { parent: baseKey });
      const sibling = createScope(ctx, otherKey, { parent: baseKey });
      try {
        const before = await sibling.ctx.systemPrompt.assemble({
          scope: otherKey,
        });
        installStewardExtension(agent.ctx, {} as never);
        installStewardExtension(agent.ctx, {} as never);
        const prompt = await agent.ctx.systemPrompt.assemble({ scope: key });
        expect(
          prompt.sections.find((section) => section.name === PERSONA_SECTION)
            ?.text,
        ).toContain("大管家");
        expect(
          agent.ctx.tools
            .schemas(key)
            .filter((tool) => tool.name.startsWith("steward_")).length,
        ).toBe(5);
        expect(
          sibling.ctx.tools
            .schemas(otherKey)
            .some((tool) => tool.name.startsWith("steward_")),
        ).toBe(false);
        expect(
          await sibling.ctx.systemPrompt.assemble({ scope: otherKey }),
        ).toEqual(before);
        if (preset === "code") {
          expect(
            prompt.sections.find((section) => section.name === "tools:sdk")
              ?.text,
          ).toContain("steward_dispatch");
          expect(prompt.tools.map((tool) => tool.name)).toEqual(["run_code"]);
        }
        await agent.dispose();
        expect(
          ctx.tools
            .schemas(key)
            .some((tool) => tool.name.startsWith("steward_")),
        ).toBe(false);
      } finally {
        await agent.dispose();
        await sibling.dispose();
        await base.dispose();
      }
    });
    await testFiber;
    await testFiber.dispose();
    await toolsFiber.dispose();
    await promptFiber.dispose();
  });
}

it("reconstructs a cold session through DSH publication, and refuses a missing feature", async () => {
  const { AgentRegistry } = await import("@deepseek-ai/dsh-agent");
  const { Session } = await import("@deepseek-ai/dsh-session");
  const featuresPlugin = await import("@amiba/dsh-plugin-session-features");
  const root = new Context();
  const fibers = [
    root.plugin(SystemPrompt, {
      persona: "base",
      includeRuntimeContext: false,
    }),
    root.plugin(AgentRegistry),
  ];
  for (const fiber of fibers) await fiber;
  const tools = root.plugin(ToolRuntime, {});
  await tools;
  fibers.push(tools);
  const features = root.plugin(featuresPlugin);
  await features;
  fibers.push(features);
  let verified = false;
  const test = root.inject(
    ["agents", "systemPrompt", "tools", "amibaSessionFeatures"],
    async (ctx) => {
      const disposeProvider = ctx.amibaSessionFeatures.register(
        "amiba-steward",
        {
          version: 1,
          install: (agentCtx) => installStewardExtension(agentCtx, {} as never),
        },
      );
      const header = {
        id: "cold" as never,
        createdAt: Date.now(),
        version: 0,
        agentPreset: "minimal",
      };
      const session = Session.create(
        header.id,
        featuresPlugin.featureSeed("cold", "amiba-steward", 1),
        header,
      );
      const agent = {
        id: header.id,
        session,
        ctx: null as unknown as Context,
        cancel() {},
        async whenIdle() {},
      };
      const scope = createScope(ctx, agent);
      agent.ctx = scope.ctx;
      const detach = ctx.agents.enter(agent as never, undefined);
      try {
        ctx.agents.announce(agent as never);
        const assembly = await scope.ctx.systemPrompt.assemble({
          scope: agent,
          agent: agent as never,
        });
        expect(
          assembly.tools.some((tool) => tool.name === "steward_dispatch"),
        ).toBe(true);
        await disposeProvider();
        await expect(
          scope.ctx.systemPrompt.assemble({
            scope: agent,
            agent: agent as never,
          }),
        ).rejects.toThrow(/unavailable/);
        verified = true;
      } finally {
        detach();
        await scope.dispose();
        await disposeProvider();
      }
    },
  );
  try {
    await test;
    expect(verified).toBe(true);
  } finally {
    await test.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
  }
});
