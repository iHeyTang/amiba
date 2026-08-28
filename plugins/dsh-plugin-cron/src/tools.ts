import type { Context } from "@deepseek-ai/cordis";
// Value-less import also loads dsh-tools' `ctx.tools` cordis augmentation.
import type { JsonValue, ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { CronService } from "./service.js";
import type { CronRule } from "./types.js";

/**
 * Agent-facing cron management, mirroring how the official dsh-schedule
 * exposes reminders to the model. This is what makes conversational creation
 * REAL: "帮我每天九点整理新闻" ends in a `cron_create` call, not in a promise
 * the agent cannot keep.
 *
 * Arguments are flat and model-friendly; exactly one timing selector is
 * required. Times of day are wall-clock in an explicit IANA zone.
 */

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function ruleFromToolArgs(args: Record<string, unknown>): CronRule {
  const selectors = ["at", "daily_time", "every_minutes"].filter(
    (key) => args[key] !== undefined,
  );
  if (selectors.length !== 1) {
    throw new Error(
      "cron_create requires exactly one of `at`, `daily_time`, `every_minutes`",
    );
  }
  if (typeof args.at === "string") return { kind: "at", at: args.at };
  if (typeof args.daily_time === "string") {
    if (typeof args.time_zone !== "string" || !args.time_zone) {
      throw new Error("`daily_time` requires an explicit IANA `time_zone`");
    }
    return { kind: "daily", time: args.daily_time, timeZone: args.time_zone };
  }
  return { kind: "every", everySeconds: Number(args.every_minutes) * 60 };
}

function textResult(value: unknown) {
  return {
    content: [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ] as JsonValue[],
  };
}

/** Shared deterministic-JSON output contract for all three tools. */
const OUTPUT: ToolDefinition["output"] = {
  schema: {
    type: "object",
    properties: { content: { type: "array", items: {} } },
    required: ["content"],
    additionalProperties: false,
  } as never,
  render: (_args, value) =>
    (value as { content?: unknown }).content as never,
};

export function registerCronTools(ctx: Context, service: CronService): void {
  const definitions: ToolDefinition[] = [
    {
      name: "cron_create",
      description:
        "Create an Amiba cron task: at the scheduled time a FRESH agent session is started and runs `prompt`. Provide exactly one of `at` (RFC 3339 instant), `daily_time` (HH:mm, with `time_zone`), or `every_minutes` (>= 5). Distinct from schedule_* reminders, which follow up inside the CURRENT session.",
      parameters: objectSchema(
        {
          name: { type: "string", description: "Short task name shown in the cron list." },
          prompt: { type: "string", description: "Instructions the fresh session starts with." },
          at: { type: "string", description: "One-shot RFC 3339 instant with offset or Z." },
          daily_time: { type: "string", description: "Daily wall-clock time, HH:mm (24h)." },
          time_zone: { type: "string", description: "IANA zone for daily_time, e.g. Asia/Shanghai." },
          every_minutes: { type: "number", description: "Fixed interval in minutes, at least 5." },
          catch_up: { type: "boolean", description: "Run once at next launch when a fire was missed. Default false." },
        },
        ["name", "prompt"],
      ) as never,
      output: OUTPUT,
      execute: async (args: unknown) => {
        const input = record(args);
        const view = await service.create({
          name: String(input.name ?? ""),
          prompt: String(input.prompt ?? ""),
          rule: ruleFromToolArgs(input),
          catchUp: input.catch_up === true,
        });
        return textResult(view) as never;
      },
    },
    {
      name: "cron_list",
      description:
        "List Amiba cron tasks with their rules, next-run and last-run times.",
      parameters: objectSchema({}) as never,
      output: OUTPUT,
      execute: async () => textResult(await service.list()) as never,
    },
    {
      name: "cron_delete",
      description: "Delete an Amiba cron task by id.",
      parameters: objectSchema(
        { id: { type: "string", description: "The cron task id." } },
        ["id"],
      ) as never,
      output: OUTPUT,
      execute: async (args: unknown) => {
        const id = String(record(args).id ?? "");
        await service.removeTask(id);
        return textResult({ id, deleted: true }) as never;
      },
    },
  ];
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register(definition), `amiba-cron:${definition.name}`);
  }
}
