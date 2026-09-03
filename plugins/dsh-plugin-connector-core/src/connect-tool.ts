import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { ConnectorCenter } from "./center.js";
import { CONNECT_ADD_TOOL_NAME, CONNECT_WIZARD_QUESTION_ID, encodePrefill } from "./connect-wizard-question.js";

export { CONNECT_ADD_TOOL_NAME } from "./connect-wizard-question.js";

/** The slice of `ctx` this needs; `userQuestions` is DSH's ask service (`@deepseek-ai/dsh-user-questions`). */
export interface ConnectToolContext {
  tools: { register(definition: ToolDefinition): () => void };
  userQuestions: {
    ask(request: {
      questions: { id: string; question: string; header?: string; detail?: string }[];
      agent?: unknown;
      signal?: AbortSignal;
    }): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>;
  };
  effect(callback: () => unknown, label?: string): unknown;
}

export interface ConnectAddResult {
  status: "connected" | "cancelled";
  connect?: { id: string; provider: string; name: string; agentPreset?: string; status: string };
}

function isUserCancel(cause: unknown): boolean {
  return Boolean(cause && typeof cause === "object" && (cause as { code?: unknown }).code === "ASK_CANCELLED");
}

/**
 * `amiba_connect_add`: the model calls it when the user wants to link a
 * messaging platform. It validates the optional provider, then BLOCKS on
 * `ctx.userQuestions.ask` — the client seat claims question id
 * `amiba.connect-wizard`, runs the platform's own wizard, and answers with
 * only the created connect id. `agent: exec.agent` is mandatory: the ask
 * provider derives the session from it.
 */
export function registerConnectAddTool(
  ctx: ConnectToolContext,
  center: Pick<ConnectorCenter, "listProviders" | "listConnects">,
): void {
  const definition = defineTool({
    name: CONNECT_ADD_TOOL_NAME,
    description:
      "Open Amiba's connect wizard so the user can link a messaging platform (Feishu/Lark, DingTalk, …) to this assistant. The user completes credentials or QR authorization inside the UI — never ask the user for app secrets in chat. Blocks until the user finishes or cancels; returns the created connect (no secrets). Omit `provider` when you are not sure which platform they mean.",
    parameters: {
      provider: { type: "string", description: 'Provider id, e.g. "lark" (飞书/Lark) or "dingtalk" (钉钉). Omit when unsure; the UI asks.' },
      name: { type: "string", description: "Suggested connect name shown in the wizard." },
      agent_preset: { type: "string", description: "Suggested agent preset id for the connect." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", required: true, enum: ["connected", "cancelled"] },
          connect: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", required: true },
              provider: { type: "string", required: true },
              name: { type: "string", required: true },
              agentPreset: { type: "string" },
              status: { type: "string", required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const providers = center.listProviders().map((p) => p.id);
      if (args.provider && !providers.includes(args.provider)) {
        throw new Error(`unknown_provider:${args.provider} (installed: ${providers.join(", ") || "none"})`);
      }
      if (!exec.agent) throw new Error("amiba_connect_add requires a live agent (it must be called from an agent turn)");
      let answer;
      try {
        answer = await ctx.userQuestions.ask({
          questions: [{
            id: CONNECT_WIZARD_QUESTION_ID,
            header: "接入平台",
            question: "在下方完成平台接入",
            detail: encodePrefill({ provider: args.provider, name: args.name, agentPreset: args.agent_preset }),
          }],
          agent: exec.agent,
          signal: exec.signal,
        });
      } catch (cause) {
        if (isUserCancel(cause)) return { status: "cancelled" } satisfies ConnectAddResult;
        throw cause;
      }
      const connectId = answer.answers[0]?.custom?.trim();
      if (!connectId) throw new Error("connect_wizard_no_result");
      const connect = (await center.listConnects()).find((row) => row.id === connectId);
      if (!connect) throw new Error(`connect_not_found:${connectId}`);
      return {
        status: "connected",
        connect: {
          id: connect.id, provider: connect.provider, name: connect.name,
          ...(connect.agentPreset ? { agentPreset: connect.agentPreset } : {}),
          status: connect.status.state,
        },
      } satisfies ConnectAddResult;
    },
    presentCall: () => ({ card: "generic", title: "Connect a messaging platform", kind: "search" }),
  });
  ctx.effect(() => ctx.tools.register(definition), `amiba-connector-core:${CONNECT_ADD_TOOL_NAME}`);
}
