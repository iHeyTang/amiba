import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ConnectorAccounts,
  ConnectorAccessView,
} from "@amiba/dsh-plugin-connector-core";

export const SEARCH_SCOPE = "dingtalk:documents:search";
export const DOCUMENT_SCOPE = "dingtalk:documents:read";
const SCOPES = [SEARCH_SCOPE, DOCUMENT_SCOPE];
const grantSchema = z.object({
  clientId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string(),
  expiresAt: z.number(),
  userId: z.string().min(1),
  name: z.string(),
  generation: z.string(),
});
type Grant = z.infer<typeof grantSchema>;
const stateSchema = z.object({
  user: grantSchema.optional(),
  modelAccess: z.boolean().default(false),
});
export const personalState = (value: unknown) => stateSchema.parse(value ?? {});
export function personalAccess(
  value: unknown,
  now = Date.now(),
): ConnectorAccessView {
  const user = personalState(value).user;
  const active = !!user && (user.expiresAt > now || !!user.refreshToken);
  return {
    identity: user ? "user" : "application",
    ...(user ? { label: user.name } : {}),
    state: !user ? "unauthorized" : active ? "authorized" : "expired",
    capabilities: SCOPES.map((id) => ({ id, available: active })),
  };
}
export interface PersonalStatus {
  work?: "ready" | "pending" | "unavailable";
  access: ConnectorAccessView;
  modelAccess: boolean;
}
export interface PersonalAuthorization {
  id: string;
  connectionId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  state: "pending" | "completed" | "cancelled" | "expired";
}
interface Flow {
  view: PersonalAuthorization;
  clientId: string;
  code: string;
  interval: number;
  next: number;
  controller: AbortController;
  generation?: string;
}
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const string = (value: unknown) =>
  typeof value === "string" ? value : "";
const MCP = "https://mcp.dingtalk.com";
const LOGIN = "https://login.dingtalk.com";
const CONTACT =
  "https://mcp-gw.dingtalk.com/server/db4b26cb38ea6a8739ad55d1997fa1da608cd36b33a6cf0f77884f70c49382fe";
const DOC =
  "https://mcp-gw.dingtalk.com/server/91e17caf44f6ca1ed9c6ce614221a518ac93300ece63ca8d7e9b133f912e0607";

/** Official DWS device OAuth and read-only document MCP protocol. Tokens are
 * connection-scoped, never exposed through remotes or supplied by the model. */
export class DingtalkPersonalService {
  private flows = new Map<string, Flow>();
  private begins = new Map<string, AbortController>();
  private polls = new Map<string, Promise<PersonalAuthorization>>();
  private refreshes = new Map<string, Promise<void>>();
  constructor(
    readonly accounts: ConnectorAccounts,
    private deps = { fetch, now: Date.now },
  ) {}
  dispose() {
    for (const f of this.flows.values()) f.controller.abort();
    for (const c of this.begins.values()) c.abort();
    this.flows.clear();
    this.begins.clear();
  }
  async status(id: string): Promise<PersonalStatus> {
    return this.accounts.run(id, async ({ state }) => ({
      access: personalAccess(state, this.deps.now()),
      modelAccess: personalState(state).modelAccess,
    }));
  }
  async setModelAccess(id: string, allowed: boolean) {
    await this.accounts.run(id, async (account) =>
      account.updateState((current) => ({
        ...personalState(current),
        modelAccess: allowed,
      })),
    );
    this.accounts.invalidate(id);
    return this.status(id);
  }
  async disconnect(id: string) {
    this.begins.get(id)?.abort();
    for (const [key, flow] of this.flows)
      if (flow.view.connectionId === id) {
        flow.controller.abort();
        this.flows.delete(key);
      }
    await this.accounts.run(id, async (account) =>
      account.updateState(() => ({ modelAccess: false })),
    );
    this.accounts.invalidate(id);
    return this.status(id);
  }
  async begin(id: string): Promise<PersonalAuthorization> {
    this.begins.get(id)?.abort();
    const controller = new AbortController();
    this.begins.set(id, controller);
    for (const [key, flow] of this.flows)
      if (
        flow.view.connectionId === id ||
        flow.view.expiresAt <= this.deps.now()
      ) {
        flow.controller.abort();
        this.flows.delete(key);
      }
    try {
      return await this.accounts.run(
        id,
        async (account) => {
          const discovery = await this.request(
            MCP + "/cli/clientId",
            undefined,
            account.signal,
          );
          const clientId = string(discovery.result);
          if (discovery.success !== true || !clientId)
            throw new Error("authorization_unavailable");
          const response = await this.request(
            LOGIN + "/oauth2/device/code.json",
            new URLSearchParams({
              client_id: clientId,
              scope: "openid corpid",
            }),
            account.signal,
          );
          const data = record(response.result);
          if (response.success !== true || !string(data.deviceCode))
            throw new Error("authorization_unavailable");
          let url: URL;
          try {
            url = new URL(string(data.verificationUriComplete));
          } catch {
            throw new Error("invalid_authorization_url");
          }
          if (url.origin !== LOGIN || url.username || url.password)
            throw new Error("invalid_authorization_url");
          account.signal.throwIfAborted();
          const view: PersonalAuthorization = {
            id: randomUUID(),
            connectionId: id,
            verificationUrl: url.href,
            userCode: string(data.userCode),
            expiresAt:
              this.deps.now() +
              Math.min(600, Math.max(1, Number(data.expiresIn) || 600)) * 1000,
            state: "pending",
          };
          const interval =
            Math.min(30, Math.max(2, Number(data.interval) || 2)) * 1000;
          this.flows.set(view.id, {
            view,
            clientId,
            code: string(data.deviceCode),
            interval,
            next: this.deps.now() + interval,
            controller: new AbortController(),
            generation: personalState(account.state).user?.generation,
          });
          return view;
        },
        controller.signal,
      );
    } finally {
      if (this.begins.get(id) === controller) this.begins.delete(id);
    }
  }
  async cancel(id: string, flowId: string) {
    return this.accounts.run(id, async () => {
      const flow = this.flows.get(flowId);
      if (flow && flow.view.connectionId !== id)
        throw new Error("authorization_not_found");
      flow?.controller.abort();
      this.flows.delete(flowId);
      return { cancelled: true };
    });
  }
  poll(id: string, flowId: string): Promise<PersonalAuthorization> {
    const key = `${id}:${flowId}`;
    const active = this.polls.get(key);
    if (active) return active;
    const job = this.performPoll(id, flowId).finally(() =>
      this.polls.delete(key),
    );
    this.polls.set(key, job);
    return job;
  }
  private async performPoll(
    id: string,
    flowId: string,
  ): Promise<PersonalAuthorization> {
    const flow = this.flows.get(flowId);
    if (!flow || flow.view.connectionId !== id)
      throw new Error("authorization_not_found");
    return this.accounts.run(
      id,
      async (account) => {
        if (flow.view.expiresAt <= this.deps.now()) {
          this.flows.delete(flowId);
          return { ...flow.view, state: "expired" };
        }
        if (flow.view.state !== "pending" || this.deps.now() < flow.next)
          return flow.view;
        flow.next = this.deps.now() + flow.interval;
        const signal = AbortSignal.any([
          account.signal,
          flow.controller.signal,
        ]);
        const response = await this.request(
          LOGIN + "/oauth2/device/token.json",
          new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: flow.code,
            client_id: flow.clientId,
          }),
          signal,
        );
        const data = record(response.result);
        if (response.success !== true)
          throw new Error("authorization_unavailable");
        if (data.error === "authorization_pending") return flow.view;
        if (data.error === "slow_down") {
          flow.interval = Math.min(30_000, flow.interval + 5000);
          flow.next = this.deps.now() + flow.interval;
          return flow.view;
        }
        if (data.error || !string(data.authCode)) {
          this.flows.delete(flowId);
          throw new Error(
            data.error === "access_denied"
              ? "authorization_denied"
              : "authorization_expired",
          );
        }
        const tokens = await this.request(
          MCP + "/oauth2/getToken",
          {
            clientId: flow.clientId,
            authCode: data.authCode,
            grantType: "authorization_code",
          },
          signal,
        );
        // Bind references to both organization and user. Never use the bot owner
        // or an arbitrary operator ID as authority for private document access.
        if (
          !tokens.userId &&
          string(tokens.accessToken) &&
          string(tokens.corpId)
        ) {
          const profile = await this.documentCall(
            string(tokens.accessToken),
            "get_current_user_profile",
            {},
            signal,
          );
          const matches = (Array.isArray(profile.result) ? profile.result : [])
            .map((row) => record(record(row).orgEmployeeModel))
            .filter((row) => row.corpId === tokens.corpId);
          if (matches.length !== 1) throw new Error("invalid_user_identity");
          tokens.userId =
            matches[0]!.userId || matches[0]!.userid || matches[0]!.orgUserId;
          tokens.userName = matches[0]!.orgUserName || matches[0]!.name;
        }
        const user = this.makeGrant(tokens, flow.clientId);
        signal.throwIfAborted();
        await account.updateState((current) => {
          const state = personalState(current);
          if (state.user?.generation !== flow.generation)
            throw new Error("authorization_changed");
          return {
            user,
            modelAccess:
              state.user?.userId === user.userId && state.modelAccess,
          };
        });
        flow.code = "";
        flow.view = { ...flow.view, state: "completed" };
        return flow.view;
      },
      flow.controller.signal,
    );
  }
  private makeGrant(
    data: Record<string, unknown>,
    clientId: string,
    previous?: Grant,
  ): Grant {
    if (data.errorCode || data.errorMsg || !string(data.accessToken))
      throw new Error("personal_authorization_expired");
    if (
      previous &&
      string(data.corpId) &&
      !previous.userId.startsWith(`${data.corpId}:`)
    )
      throw new Error("authorization_changed");
    const identity =
      string(data.corpId) && string(data.userId)
        ? `${data.corpId}:${data.userId}`
        : previous?.userId;
    const parsed = grantSchema.safeParse({
      clientId,
      accessToken: data.accessToken,
      refreshToken: string(data.refreshToken) || previous?.refreshToken || "",
      expiresAt:
        this.deps.now() + Math.max(1, Number(data.expiresIn) || 7200) * 1000,
      userId: identity,
      name:
        string(data.userName) ||
        previous?.name ||
        string(data.corpName) ||
        "钉钉用户",
      generation: randomUUID(),
    });
    if (!parsed.success) throw new Error("invalid_dingtalk_response");
    return parsed.data;
  }
  private refresh(id: string): Promise<void> {
    const active = this.refreshes.get(id);
    if (active) return active;
    const job = this.accounts
      .run(id, async (account) => {
        const user = personalState(account.state).user;
        if (!user) throw new Error("personal_authorization_required");
        if (user.expiresAt > this.deps.now() + 60_000) return;
        if (!user.refreshToken)
          throw new Error("personal_authorization_expired");
        const tokens = await this.request(
          MCP + "/oauth2/refreshToken",
          {
            clientId: user.clientId,
            refreshToken: user.refreshToken,
            grantType: "refresh_token",
          },
          account.signal,
        );
        if (tokens.errorCode || tokens.errorMsg) {
          await account.updateState((current) => {
            const state = personalState(current);
            return state.user?.generation === user.generation
              ? { ...state, user: { ...user, expiresAt: 0, refreshToken: "" } }
              : current;
          });
          throw new Error("personal_authorization_expired");
        }
        const next = this.makeGrant(tokens, user.clientId, user);
        if (next.userId !== user.userId)
          throw new Error("authorization_changed");
        await account.updateState((current) => {
          const state = personalState(current);
          if (state.user?.generation !== user.generation)
            throw new Error("authorization_changed");
          return { ...state, user: next };
        });
      })
      .finally(() => this.refreshes.delete(id));
    this.refreshes.set(id, job);
    return job;
  }
  async withUser<T>(
    id: string,
    model: boolean,
    operation: (
      call: (
        tool: string,
        args: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>,
      account: string,
      identity: string,
    ) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.accounts.run(
      id,
      async ({ state }) => {
        const s = personalState(state);
        if (!s.user) throw new Error("personal_authorization_required");
        if (model && !s.modelAccess) throw new Error("agent_access_disabled");
      },
      signal,
    );
    await this.refresh(id);
    return this.accounts.run(
      id,
      async (account) => {
        const state = personalState(account.state),
          user = state.user;
        if (!user) throw new Error("personal_authorization_required");
        if (model && !state.modelAccess)
          throw new Error("agent_access_disabled");
        const result = await operation(
          (tool, args) =>
            this.documentCall(user.accessToken, tool, args, account.signal),
          account.connect.name,
          user.userId,
        );
        account.signal.throwIfAborted();
        await this.accounts.run(
          id,
          async ({ state: current }) => {
            const latest = personalState(current);
            if (
              latest.user?.generation !== user.generation ||
              (model && !latest.modelAccess)
            )
              throw new Error("authorization_changed");
          },
          account.signal,
        );
        return result;
      },
      signal,
    );
  }
  private async documentCall(
    token: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (
      ![
        "search_documents",
        "get_document_info",
        "get_document_content",
        "get_current_user_profile",
      ].includes(tool)
    )
      throw new Error("unsupported_document_operation");
    const data = await this.request(
      tool === "get_current_user_profile" ? CONTACT : DOC,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      },
      signal,
      {
        Authorization: `Bearer ${token}`,
        "x-user-access-token": token,
        "claw-type": "openClaw",
      },
    );
    if (data.error) throw new Error("permission_or_resource_unavailable");
    const result = record(data.result);
    if (result.isError) throw new Error("permission_or_resource_unavailable");
    const blocks = Array.isArray(result.content) ? result.content : [];
    const structured = record(result.structuredContent);
    let body = structured;
    if (!Object.keys(body).length) {
      const block = blocks.map(record).find((b) => b.type === "text");
      try {
        body = record(JSON.parse(string(block?.text)));
      } catch {
        throw new Error("invalid_dingtalk_response");
      }
    }
    if (!Object.keys(body).length) throw new Error("invalid_dingtalk_response");
    if (body.success === false || body.error || body.errorCode)
      throw new Error("permission_or_resource_unavailable");
    return body;
  }
  private async request(
    url: string,
    body: Record<string, unknown> | URLSearchParams | undefined,
    signal: AbortSignal,
    headers: Record<string, string> = {},
  ) {
    let response: Response;
    try {
      response = await this.deps.fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type":
            body instanceof URLSearchParams
              ? "application/x-www-form-urlencoded"
              : "application/json",
          ...headers,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                body instanceof URLSearchParams ? body : JSON.stringify(body),
            }),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
    } catch {
      signal.throwIfAborted();
      throw new Error("dingtalk_request_failed");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "personal_authorization_expired"
          : response.status === 403
            ? "permission_required"
            : "dingtalk_request_failed",
      );
    if (!response.body) throw new Error("invalid_dingtalk_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("response_too_large");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new Error("invalid_dingtalk_response");
    }
  }
}
