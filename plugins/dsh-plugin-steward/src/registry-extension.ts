import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { PERSONA_ORDER, PERSONA_SECTION } from "@deepseek-ai/dsh-system-prompt";
import type { StewardRegistryService } from "./registry.js";
import { STEWARD_PERSONA } from "./session-extension.js";
import { stewardToolDefinitions } from "./tools.js";
import type { StewardProfileInput } from "./registry-store.js";

const output: ToolDefinition["output"] = {
  schema: {
    type: "object",
    properties: { content: { type: "array", items: {} } },
    required: ["content"],
  } as never,
  render: (_args, value) => (value as { content: unknown }).content as never,
};
const result = (value: unknown) =>
  ({ content: [{ type: "text", text: JSON.stringify(value) }] }) as never;
const fields = {
  name: { type: "string" },
  responsibilities: { type: "string" },
  background: { type: "string" },
  context: { type: "string" },
};

/** Like cron_create, instance lifecycle tools are available in ordinary conversations. */
export function registerStewardLifecycleTools(
  ctx: Context,
  registry: StewardRegistryService,
) {
  const definitions: ToolDefinition[] = [
    {
      name: "steward_create",
      description:
        "Create an independent steward when the user asks. Extract its name, responsibilities and initial background from their request; ask only for missing essential information. No role templates. Return the entry name/id and tell the user to open it in the sidebar. Background/context persist across conversation changes.",
      parameters: {
        type: "object",
        properties: fields,
        required: ["name", "responsibilities"],
        additionalProperties: false,
      } as never,
      output,
      execute: async (args) => {
        const input = args as StewardProfileInput;
        return result(
          await registry.create({
            ...input,
            background: input.background ?? "",
            context: input.context ?? "",
          }),
        );
      },
    },
    {
      name: "steward_instances",
      description:
        "List steward entries so the user can choose which one to open, edit or delete. No instance has authority over another.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      } as never,
      output,
      execute: async () =>
        result(
          (await registry.list()).map(({ id, name, responsibilities }) => ({
            id,
            name,
            responsibilities,
          })),
        ),
    },
    {
      name: "steward_update",
      description:
        "Edit the named steward only at the user's request. Supply the complete profile; omitted background/context are preserved. Use steward_remember inside a steward to save its own ongoing context.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, ...fields },
        required: ["id", "name", "responsibilities"],
        additionalProperties: false,
      } as never,
      output,
      execute: async (args) => {
        const input = args as StewardProfileInput & { id: string };
        await registry.initialize();
        return result(
          await registry.update(input.id, {
            ...registry.profile(input.id),
            ...input,
          }),
        );
      },
    },
    {
      name: "steward_delete",
      description:
        "Delete the specified steward only when the user asks. Retains all conversations and work; removes management bindings. Deleting the last steward leaves zero entries.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      } as never,
      output,
      execute: async (args) =>
        result(await registry.remove((args as { id: string }).id)),
    },
  ];
  for (const definition of definitions) {
    const execute = definition.execute!;
    ctx.effect(
      () =>
        ctx.tools.register({
          ...definition,
          execute: async (args, execution) => {
            if (
              execution.agent &&
              (definition.name === "steward_update" ||
                definition.name === "steward_delete")
            ) {
              const sessionId = String(execution.agent.id);
              const origin =
                await ctx.amibaConversations.originForSession(sessionId);
              if (
                origin?.plugin === "amiba-steward" &&
                (args as { id: string }).id !== origin.entry
              )
                throw new Error("steward_cannot_modify_another_instance");
            }
            return execute(args, execution);
          },
        }),
      definition.name,
    );
  }
}

/** Resolve identity from the actual executing agent, never from a model-supplied id. */
export function installRegistryExtension(
  ctx: Context,
  registry: StewardRegistryService,
): () => Promise<void> {
  const disposers: Array<() => unknown> = [];

  disposers.push(
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      if (!context.agent) throw new Error("steward_identity_required");
      const engine = await registry.forSession(String(context.agent.id));
      const state = await engine.snapshot();
      const item = (await registry.list()).find(
        (row) => row.state.stewardSessionId === state.stewardSessionId,
      );
      if (!item) throw new Error("steward_deleted_or_unknown");
      const persona = `${STEWARD_PERSONA}\n你是 ${item.name}。职责：${item.responsibilities}\n初始背景：${item.background}\n持续上下文：${item.context}\n你仅管理以下任务：${JSON.stringify(
        state.tasks
          .filter((task) => task.status !== "done")
          .slice(0, 100)
          .map(({ id, title, status, lastSummary }) => ({
            id,
            title,
            status,
            lastSummary,
          })),
      )}\n重要偏好、决定和待办使用 steward_remember 更新，切换会话后仍会恢复。历史检索使用 conversation_search_history。不要使用全局记忆读取其他管家的背景。`;
      const assembly = await next();
      return {
        ...assembly,
        sections: assembly.sections.map((section) =>
          section.name === PERSONA_SECTION
            ? { ...section, text: persona }
            : section,
        ),
      };
    }),
  );
  disposers.push(
    ctx.systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      text: STEWARD_PERSONA,
    }),
  );
  // Reuse the engine definitions, but bind afresh to the verified caller for every execution.
  for (const template of stewardToolDefinitions({} as never)) {
    disposers.push(
      ctx.tools.register({
        ...template,
        execute: async (args, execution) => {
          if (!execution.agent) throw new Error("steward_identity_required");
          const engine = await registry.forSession(String(execution.agent.id));
          return stewardToolDefinitions(engine).find(
            (tool) => tool.name === template.name,
          )!.execute!(args, execution);
        },
      }),
    );
  }
  disposers.push(
    ctx.tools.register({
      name: "steward_remember",
      description:
        "Replace this steward's durable working context with current preferences, decisions and pending work. Preserve still-relevant facts. Only affects this steward.",
      parameters: {
        type: "object",
        properties: { context: { type: "string" } },
        required: ["context"],
        additionalProperties: false,
      } as never,
      output,
      execute: async (args, execution) => {
        if (!execution.agent) throw new Error("steward_identity_required");
        const engine = await registry.forSession(String(execution.agent.id));
        const state = await engine.snapshot();
        const item = (await registry.list()).find(
          (row) => row.state.stewardSessionId === state.stewardSessionId,
        )!;
        return result(
          await registry.update(item.id, {
            ...item,
            context: (args as { context: string }).context,
          }),
        );
      },
    }),
  );
  disposers.push(
    ctx.tools.guard((execution) =>
      execution.name.startsWith("memos_") ||
      execution.name === "amiba_memory_correct"
        ? "Use this steward's durable context and conversation_search_history; global memory is not scoped to this steward."
        : undefined,
    ),
  );
  return async () => {
    for (const dispose of disposers.reverse()) await dispose();
  };
}
