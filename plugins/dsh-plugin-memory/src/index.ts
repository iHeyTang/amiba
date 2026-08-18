import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";

import {
  AmibaMemoryStore,
  renderMemoryContext,
  type AmibaMemoryEntry,
  type AmibaMemoryTarget,
} from "./memory-store.js";
import { registerToolSource } from "@amiba/dsh-plugin-catalog";
import { applyMemoryHttp } from "./http.js";
import { applyMemoryRemote } from "./remote-service.js";

export * from "./memory-store.js";

export const name = "amiba-memory";
export const inject = [
  "tools",
  "systemPrompt",
  "amibaToolCatalog",
];

export interface Config {
  root: string;
  apiToken: string;
  memoryCharLimit: number;
  userCharLimit: number;
  entryCharLimit: number;
}

export const Config = z.object({
  root: z.string().required(),
  apiToken: z.string().default(""),
  memoryCharLimit: z.number().min(1).required(),
  userCharLimit: z.number().min(1).required(),
  entryCharLimit: z.number().min(1).required(),
});

type AgentAssemblyContext = { agent?: Agent };

function presetForAgent(agent: Agent | undefined): string {
  if (!agent) return "standard";
  let preset = agent.session.header.agentPreset ?? "standard";
  const events = agent.session.events as readonly {
    type: string;
    data: Record<string, unknown>;
  }[];
  for (const event of events) {
    if (event.type !== "agent-preset/selected") continue;
    const data = event.data as { agentPreset?: unknown };
    if (typeof data.agentPreset === "string" && data.agentPreset.trim()) {
      preset = data.agentPreset.trim();
    }
  }
  return preset;
}

function sessionId(agent: Agent | undefined): string | undefined {
  return agent ? String(agent.session.id) : undefined;
}

function appendAudit(
  agent: Agent | undefined,
  action: "store" | "forget",
  entry: AmibaMemoryEntry,
): void {
  if (!agent) return;
  const append = agent.session.append as unknown as (
    type: string,
    data: Record<string, unknown>,
  ) => unknown;
  append("amiba-memory/change", {
    action,
    id: entry.id,
    target: entry.target,
    preset: entry.preset,
    flagged: entry.flagged,
  });
}

function entryValue(entry: AmibaMemoryEntry) {
  return {
    id: entry.id,
    target: entry.target,
    text: entry.text,
    flagged: entry.flagged,
    createdAt: entry.createdAt,
  };
}

const entrySchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    target: {
      type: "string",
      enum: ["memory", "user"],
      required: true,
    },
    text: { type: "string", required: true },
    flagged: {
      oneOf: [{ type: "string" }, { type: "null" }],
      required: true,
    },
    createdAt: { type: "string", required: true },
  },
} as const;

const MEMORY_SOURCE = {
  kind: "dsh-plugin",
  id: "amiba-memory",
  name: "Amiba Memory",
  packageName: "@amiba/dsh-plugin-memory",
  loadMode: "plugin",
  executionTarget: "dsh-runtime",
  dynamic: false,
} as const;

export function apply(ctx: Context, config: Config): void {
  const store = new AmibaMemoryStore(config.root, {
    memory: config.memoryCharLimit,
    user: config.userCharLimit,
    entry: config.entryCharLimit,
  });
  applyMemoryRemote(ctx, store);
  if (config.apiToken) {
    ctx.inject(["webServer"], (httpCtx) => {
      applyMemoryHttp(httpCtx, config, store);
    });
  }

  ctx.systemPrompt.context({
    name: "amiba:long-term-memory",
    order: 60,
    text: (assembly) =>
      renderMemoryContext(
        store.readSync(
          presetForAgent((assembly as AgentAssemblyContext).agent),
        ),
      ),
  });

  ctx.tools.register(
    defineTool({
      name: "memory_list",
      description:
        "List durable cross-session memory for the current agent preset. Flagged entries are retained for human review but are never injected into model context.",
      parameters: {
        target: {
          type: "string",
          enum: ["memory", "user", "all"],
          description: "Optional memory category filter.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            preset: { type: "string", required: true },
            entries: {
              type: "array",
              required: true,
              items: entrySchema,
            },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text:
              value.entries.length === 0
                ? "No durable memory is stored for this agent preset."
                : JSON.stringify(value, null, 2),
          },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const preset = presetForAgent(exec.agent);
        const snapshot = await store.read(preset);
        const target = args.target ?? "all";
        return {
          preset,
          entries: snapshot.targets
            .filter((item) => target === "all" || item.target === target)
            .flatMap((item) => item.entries.map(entryValue)),
        };
      },
      presentCall: () => ({
        card: "generic",
        title: "Read long-term memory",
        kind: "search",
      }),
    }),
  );
  registerToolSource(ctx, "memory_list", MEMORY_SOURCE);

  ctx.tools.register(
    defineTool({
      name: "memory_store",
      description:
        "Store one durable fact, user preference, or reusable conclusion for future sessions of the current agent preset. Store data only: never save instructions, secrets, transient task state, or guesses.",
      parameters: {
        target: {
          type: "string",
          enum: ["memory", "user"],
          required: true,
          description:
            "Use user for stable user preferences/facts; use memory for reusable project or task knowledge.",
        },
        text: {
          type: "string",
          required: true,
          description: "One self-contained factual memory item.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            created: { type: "boolean", required: true },
            injected: { type: "boolean", required: true },
            entry: { ...entrySchema, required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: value.created
              ? value.injected
                ? `Stored durable memory ${value.entry.id}.`
                : `Stored ${value.entry.id}, but its safety classification (${value.entry.flagged}) prevents model-context injection.`
              : `The same memory already exists as ${value.entry.id}.`,
          },
        ],
      },
      async execute(args, exec) {
        if (!exec.agent) {
          throw new Error("memory_store requires an owning agent session.");
        }
        const result = await store.store({
          preset: presetForAgent(exec.agent),
          target: args.target as AmibaMemoryTarget,
          text: args.text,
          sourceSessionId: sessionId(exec.agent),
        });
        if (result.created) appendAudit(exec.agent, "store", result.entry);
        return {
          created: result.created,
          injected: result.entry.flagged === null,
          entry: entryValue(result.entry),
        };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Store ${args.target} memory`,
        kind: "other",
        rawInput: args.text,
      }),
    }),
  );
  registerToolSource(ctx, "memory_store", MEMORY_SOURCE);

  ctx.tools.register(
    defineTool({
      name: "memory_forget",
      description:
        "Delete one durable memory item from the current agent preset by its exact id. Call memory_list first when the id is unknown.",
      parameters: {
        id: {
          type: "string",
          required: true,
          description: "Exact mem-... id returned by memory_list.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            removed: { type: "boolean", required: true },
            id: { type: "string", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: value.removed
              ? `Forgot durable memory ${value.id}.`
              : `No durable memory with id ${value.id} exists in this agent preset.`,
          },
        ],
      },
      async execute(args, exec) {
        if (!exec.agent) {
          throw new Error("memory_forget requires an owning agent session.");
        }
        const result = await store.forget({
          preset: presetForAgent(exec.agent),
          id: args.id,
        });
        if (result.removed) appendAudit(exec.agent, "forget", result.removed);
        return { removed: Boolean(result.removed), id: args.id };
      },
      presentCall: (args) => ({
        card: "generic",
        title: "Forget long-term memory",
        kind: "other",
        rawInput: args.id,
      }),
    }),
  );
  registerToolSource(ctx, "memory_forget", MEMORY_SOURCE);
}
