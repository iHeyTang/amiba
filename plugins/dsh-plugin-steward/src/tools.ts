import type { Context } from "@deepseek-ai/cordis";
// Value-less import also loads dsh-tools' `ctx.tools` cordis augmentation.
import type { JsonValue, ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { StewardService } from "./service.js";

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] as JsonValue[] };
}

const OUTPUT: ToolDefinition["output"] = {
  schema: {
    type: "object",
    properties: { content: { type: "array", items: {} } },
    required: ["content"],
    additionalProperties: false,
  } as never,
  render: (_args, value) => (value as { content?: unknown }).content as never,
};

/** Task-management tools added to the selected base preset. */
export function stewardToolDefinitions(service: StewardService): ToolDefinition[] {
  return [
    {
      name: "steward_list_tasks",
      description:
        "List the tasks the steward manages: id, title, status (idle | running | needs_input | done | failed), cwd, and the latest reply summary. Call this before routing a request.",
      parameters: objectSchema({
        include_done: { type: "boolean", description: "Also list tasks already closed. Default false." },
      }) as never,
      output: OUTPUT,
      execute: async (args: unknown) => textResult(await service.listTasks(record(args).include_done === true)) as never,
    },
    {
      name: "steward_dispatch",
      description:
        "Send `message` to a task session and return immediately (the reply arrives later as a 【任务汇报】 message). Provide exactly one of `task_id` (existing task) or `new_task_title` (start a new task; `cwd` optional, defaults to the steward's default directory).",
      parameters: objectSchema(
        {
          task_id: { type: "string", description: "Existing task id from steward_list_tasks." },
          new_task_title: { type: "string", description: "One-line title for a NEW task." },
          cwd: { type: "string", description: "Absolute working directory for a new task." },
          message: { type: "string", description: "What the task session should do next — the user's request, in their words." },
        },
        ["message"],
      ) as never,
      output: OUTPUT,
      execute: async (args: unknown) => {
        const input = record(args);
        const title = optionalString(input.new_task_title);
        return textResult(
          await service.dispatch({
            taskId: optionalString(input.task_id),
            newTask: title ? { title, cwd: optionalString(input.cwd) } : undefined,
            message: String(input.message ?? ""),
          }),
        ) as never;
      },
    },
    {
      name: "steward_adopt",
      description:
        "Bring an existing conversation under the steward's management. Provide `session_id`, or `title_query` to search by title; when zero or several sessions match, the result lists candidates (possibly none) — ask the user which one, or for a session id.",
      parameters: objectSchema({
        session_id: { type: "string", description: "Exact DSH session id." },
        title_query: { type: "string", description: "Words from the conversation's title." },
        title: { type: "string", description: "Optional task title to use instead of the conversation's title." },
      }) as never,
      output: OUTPUT,
      execute: async (args: unknown) => {
        const input = record(args);
        return textResult(
          await service.adopt({
            sessionId: optionalString(input.session_id),
            titleQuery: optionalString(input.title_query),
            title: optionalString(input.title),
          }),
        ) as never;
      },
    },
    {
      name: "steward_read_task",
      description: "Read the last N completed turns (user text + assistant reply) of a task session, for when the user asks for details.",
      parameters: objectSchema(
        {
          task_id: { type: "string", description: "Task id." },
          turns: { type: "number", description: "How many recent turns to read. Default 3." },
        },
        ["task_id"],
      ) as never,
      output: OUTPUT,
      execute: async (args: unknown) => {
        const input = record(args);
        const turns = typeof input.turns === "number" ? input.turns : undefined;
        return textResult(await service.readTask(optionalString(input.task_id) ?? "", turns)) as never;
      },
    },
    {
      name: "steward_close_task",
      description: "Mark a task as done. Its conversation is kept; it just leaves the active list.",
      parameters: objectSchema({ task_id: { type: "string", description: "Task id." } }, ["task_id"]) as never,
      output: OUTPUT,
      execute: async (args: unknown) => textResult(await service.closeTask(optionalString(record(args).task_id) ?? "")) as never,
    },
  ];
}

/** Register into ONE agent scope (the steward's), so no other session sees these tools. */
export function registerStewardTools(agentCtx: Context, service: StewardService): () => Promise<void> {
  const disposers: Array<() => unknown> = [];
  for (const definition of stewardToolDefinitions(service)) {
    disposers.push(agentCtx.effect(() => agentCtx.tools.register(definition), `amiba-steward:${definition.name}`));
  }
  return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
}
