import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ConnectorAccounts,
  ConnectorAccessView,
} from "@amiba/dsh-plugin-connector-core";
import { larkConfigSchema, type LarkConnectorConfig } from "./translate.js";

export const CONTACT_SCOPE = "contact:user:search";
export const SEARCH_SCOPE = "search:docs:read";
export const DOCUMENT_SCOPE = "docx:document:readonly";
export const PERSONAL_SCOPES = [
  CONTACT_SCOPE,
  SEARCH_SCOPE,
  DOCUMENT_SCOPE,
  "offline_access",
];
const grantSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string(),
  expiresAt: z.number(),
  refreshExpiresAt: z.number(),
  scope: z.array(z.string()),
  userId: z.string().min(1),
  name: z.string(),
  generation: z.string(),
});
type UserGrant = z.infer<typeof grantSchema>;
const stateSchema = z.object({
  user: grantSchema.optional(),
  modelAccess: z.boolean().default(false),
});
export function personalState(value: unknown): z.infer<typeof stateSchema> {
  return stateSchema.parse(value ?? {});
}
export function personalAccess(
  value: unknown,
  now = Date.now(),
): ConnectorAccessView {
  const state = personalState(value);
  const user = state.user;
  const active =
    !!user &&
    Math.max(user.expiresAt, user.refreshToken ? user.refreshExpiresAt : 0) >
      now;
  return {
    identity: user ? "user" : "application",
    ...(user ? { label: user.name } : {}),
    state: !user ? "unauthorized" : active ? "authorized" : "expired",
    capabilities: [CONTACT_SCOPE, SEARCH_SCOPE, DOCUMENT_SCOPE].map((id) => ({
      id,
      available: active && !!user?.scope.includes(id),
    })),
  };
}
export interface PersonalStatus {
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
interface DeviceFlow {
  view: PersonalAuthorization;
  deviceCode: string;
  nextPoll: number;
  interval: number;
  controller: AbortController;
  generation?: string;
}
export interface LarkPersonalDeps {
  fetch: typeof fetch;
  now(): number;
}
const TOKEN_PATH = "/open-apis/authen/v2/oauth/token";
export function larkEndpoints(config: LarkConnectorConfig) {
  const domain = config.domain === "lark" ? "larksuite.com" : "feishu.cn";
  return {
    open: `https://open.${domain}`,
    accounts: `https://accounts.${domain}`,
    appLink: `https://applink.${domain}`,
  };
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Tokens stay in connector-core's private credential seam, scoped by connection. */
export class LarkPersonalService {
  private flows = new Map<string, DeviceFlow>();
  private polls = new Map<string, Promise<PersonalAuthorization>>();
  private refreshes = new Map<string, Promise<UserGrant>>();
  private begins = new Map<string, AbortController>();
  constructor(
    readonly accounts: ConnectorAccounts,
    private deps: LarkPersonalDeps = { fetch, now: Date.now },
  ) {}
  dispose(): void {
    for (const flow of this.flows.values()) flow.controller.abort();
    for (const controller of this.begins.values()) controller.abort();
    this.flows.clear();
    this.begins.clear();
  }
  async status(id: string): Promise<PersonalStatus> {
    return this.accounts.run(id, async ({ state }) => ({
      access: personalAccess(state, this.deps.now()),
      modelAccess: personalState(state).modelAccess,
    }));
  }
  async setModelAccess(id: string, allowed: boolean): Promise<PersonalStatus> {
    await this.accounts.run(id, async (account) =>
      account.updateState((current) => ({
        ...personalState(current),
        modelAccess: allowed,
      })),
    );
    this.accounts.invalidate(id);
    return this.status(id);
  }
  async disconnect(id: string): Promise<PersonalStatus> {
    this.cancelFor(id);
    await this.accounts.run(id, async (account) =>
      account.updateState(() => ({ modelAccess: false })),
    );
    this.accounts.invalidate(id);
    return this.status(id);
  }
  private cancelFor(id: string) {
    this.begins.get(id)?.abort();
    this.begins.delete(id);
    for (const [key, flow] of this.flows)
      if (flow.view.connectionId === id) {
        flow.controller.abort();
        this.flows.delete(key);
      }
  }
  private sweep() {
    for (const [key, flow] of this.flows)
      if (flow.view.expiresAt <= this.deps.now()) {
        flow.controller.abort();
        this.flows.delete(key);
      }
  }
  async begin(id: string): Promise<PersonalAuthorization> {
    this.sweep();
    this.cancelFor(id);
    const controller = new AbortController();
    this.begins.set(id, controller);
    return this.accounts
      .run(
        id,
        async (account) => {
          const config = larkConfigSchema.parse(account.config);
          const endpoint = larkEndpoints(config);
          const data = await this.request(
            `${endpoint.accounts}/oauth/v1/device_authorization`,
            {
              method: "POST",
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64")}`,
              },
              body: new URLSearchParams({
                client_id: config.appId,
                scope: PERSONAL_SCOPES.join(" "),
              }),
              signal: account.signal,
            },
          );
          if (data.error || !data.device_code)
            throw new Error("authorization_unavailable");
          const url = new URL(
            string(data.verification_uri_complete) ||
              string(data.verification_uri),
          );
          if (url.origin !== endpoint.accounts || url.username || url.password)
            throw new Error("invalid_authorization_url");
          const view: PersonalAuthorization = {
            id: randomUUID(),
            connectionId: id,
            verificationUrl: url.href,
            userCode: string(data.user_code),
            expiresAt:
              this.deps.now() +
              Math.min(900, Number(data.expires_in) || 240) * 1000,
            state: "pending",
          };
          const interval = Math.max(5, Number(data.interval) || 5) * 1000;
          account.signal.throwIfAborted();
          this.flows.set(view.id, {
            view,
            deviceCode: string(data.device_code),
            nextPoll: this.deps.now() + interval,
            interval,
            controller: new AbortController(),
            generation: personalState(account.state).user?.generation,
          });
          return view;
        },
        controller.signal,
      )
      .finally(() => {
        if (this.begins.get(id) === controller) this.begins.delete(id);
      });
  }
  async cancel(id: string, flowId: string): Promise<{ cancelled: boolean }> {
    return this.accounts.run(id, async () => {
      const flow = this.flows.get(flowId);
      if (flow && flow.view.connectionId !== id)
        throw new Error("authorization_not_found");
      if (flow) {
        flow.controller.abort();
        this.flows.delete(flowId);
      }
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
    return this.accounts.run(id, async (account) => {
      if (flow.view.expiresAt <= this.deps.now()) {
        this.flows.delete(flowId);
        flow.controller.abort();
        return { ...flow.view, state: "expired" };
      }
      if (flow.view.state !== "pending" || this.deps.now() < flow.nextPoll)
        return flow.view;
      flow.nextPoll = this.deps.now() + flow.interval;
      const config = larkConfigSchema.parse(account.config);
      const signal = AbortSignal.any([account.signal, flow.controller.signal]);
      const data = await this.token(
        config,
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: flow.deviceCode,
        },
        signal,
      );
      if (data.error === "authorization_pending") return flow.view;
      if (data.error === "slow_down") {
        flow.interval = Math.min(60_000, flow.interval + 5000);
        flow.nextPoll = this.deps.now() + flow.interval;
        return flow.view;
      }
      if (data.error) {
        this.flows.delete(flowId);
        throw new Error(
          data.error === "access_denied"
            ? "authorization_denied"
            : "authorization_expired",
        );
      }
      const info = await this.api(
        config,
        string(data.access_token),
        "/open-apis/authen/v1/user_info",
        undefined,
        signal,
      );
      const user = this.makeGrant(data, {
        userId: string(info.open_id),
        name: string(info.name),
      });
      signal.throwIfAborted();
      if (this.flows.get(flowId) !== flow)
        throw new Error("authorization_cancelled");
      await account.updateState((current) => {
        const state = personalState(current);
        if (state.user?.generation !== flow.generation)
          throw new Error("authorization_changed");
        return {
          ...state,
          user,
          modelAccess: state.user?.userId === user.userId && state.modelAccess,
        };
      });
      flow.deviceCode = "";
      flow.view = { ...flow.view, state: "completed" };
      return flow.view;
    });
  }
  private makeGrant(
    data: Record<string, unknown>,
    identity: { userId: string; name: string },
    previous?: UserGrant,
  ): UserGrant {
    return grantSchema.parse({
      ...identity,
      generation: randomUUID(),
      accessToken: data.access_token,
      refreshToken: string(data.refresh_token) || previous?.refreshToken || "",
      expiresAt: this.deps.now() + (Number(data.expires_in) || 7200) * 1000,
      refreshExpiresAt:
        data.refresh_token_expires_in !== undefined
          ? this.deps.now() + Number(data.refresh_token_expires_in) * 1000
          : (previous?.refreshExpiresAt ?? this.deps.now() + 604800_000),
      scope:
        typeof data.scope === "string"
          ? data.scope.split(/\s+/).filter(Boolean)
          : (previous?.scope ?? []),
    });
  }
  private token(
    config: LarkConnectorConfig,
    fields: Record<string, string>,
    signal: AbortSignal,
  ) {
    const body = {
      ...fields,
      client_id: config.appId,
      client_secret: config.appSecret,
    };
    const refresh = fields.grant_type === "refresh_token";
    return this.request(`${larkEndpoints(config).open}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "content-type": refresh
          ? "application/json"
          : "application/x-www-form-urlencoded",
      },
      body: refresh ? JSON.stringify(body) : new URLSearchParams(body),
      signal,
    });
  }
  private refresh(id: string): Promise<UserGrant> {
    const active = this.refreshes.get(id);
    if (active) return active;
    const job = this.accounts
      .run(id, async (account) => {
        const user = personalState(account.state).user;
        if (!user) throw new Error("personal_authorization_required");
        if (user.expiresAt > this.deps.now() + 60_000) return user;
        if (!user.refreshToken || user.refreshExpiresAt <= this.deps.now())
          throw new Error("personal_authorization_expired");
        const data = await this.token(
          larkConfigSchema.parse(account.config),
          { grant_type: "refresh_token", refresh_token: user.refreshToken },
          account.signal,
        );
        if (data.error === "invalid_grant") {
          await account.updateState((current) => {
            const state = personalState(current);
            return state.user?.generation === user.generation
              ? {
                  ...state,
                  user: {
                    ...state.user,
                    expiresAt: 0,
                    refreshExpiresAt: 0,
                    refreshToken: "",
                  },
                }
              : current;
          });
        }
        if (data.error || !data.access_token)
          throw new Error("personal_authorization_expired");
        const next = this.makeGrant(data, user, user);
        await account.updateState((current) => {
          const state = personalState(current);
          if (state.user?.generation !== user.generation)
            throw new Error("authorization_changed");
          return { ...state, user: next };
        });
        return next;
      })
      .finally(() => this.refreshes.delete(id));
    this.refreshes.set(id, job);
    return job;
  }
  async withUser<T>(
    id: string,
    scopes: string[],
    model: boolean,
    operation: (
      api: (path: string, body?: unknown) => Promise<Record<string, unknown>>,
      config: LarkConnectorConfig,
      accountName: string,
      identity: string,
    ) => Promise<T>,
    outerSignal?: AbortSignal,
  ): Promise<T> {
    outerSignal?.throwIfAborted();
    // Denied Agent access must not even initiate an authorization refresh.
    await this.accounts.run(
      id,
      async ({ state: value }) => {
        const state = personalState(value);
        if (!state.user) throw new Error("personal_authorization_required");
        if (model && !state.modelAccess)
          throw new Error("agent_access_disabled");
        if (scopes.some((scope) => !state.user!.scope.includes(scope)))
          throw new Error("permission_required");
      },
      outerSignal,
    );
    await this.refresh(id);
    return this.accounts.run(
      id,
      async (account) => {
        const state = personalState(account.state);
        const user = state.user;
        if (!user) throw new Error("personal_authorization_required");
        if (model && !state.modelAccess)
          throw new Error("agent_access_disabled");
        if (scopes.some((scope) => !user.scope.includes(scope)))
          throw new Error("permission_required");
        const config = larkConfigSchema.parse(account.config);
        const value = await operation(
          (path, body) =>
            this.api(config, user.accessToken, path, body, account.signal),
          config,
          account.connect.name,
          user.userId,
        );
        await this.accounts.run(
          id,
          async ({ state: current }) => {
            const latest = personalState(current);
            if (
              latest.user?.userId !== user.userId ||
              (model && !latest.modelAccess)
            )
              throw new Error("authorization_changed");
          },
          account.signal,
        );
        return value;
      },
      outerSignal,
    );
  }
  private async api(
    config: LarkConnectorConfig,
    accessToken: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith("/open-apis/")) throw new Error("invalid_api_path");
    const result = await this.request(larkEndpoints(config).open + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (result.code !== 0 && result.code !== undefined) {
      if ([99991663, 99991664, 99991668].includes(Number(result.code)))
        throw new Error("personal_authorization_expired");
      throw new Error("permission_or_resource_unavailable");
    }
    return record(result.data);
  }
  private async request(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const response = await this.deps.fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(15_000),
        ...(init.signal ? [init.signal] : []),
      ]),
    });
    // Do not log/return upstream bodies: OAuth responses contain credentials.
    if (!response.body) throw new Error("invalid_lark_response");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("response_too_large");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let data: Record<string, unknown>;
    try {
      data = record(JSON.parse(text));
    } catch {
      throw new Error("invalid_lark_response");
    }
    if (!response.ok && !data.error)
      throw new Error(
        response.status === 429 ? "rate_limited" : "lark_request_failed",
      );
    return data;
  }
}
