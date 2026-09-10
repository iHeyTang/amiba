import { z } from "zod";
import type { MemosStatus } from "./memos-status.js";
import {
  memoryQuerySchema,
  memorySessionSchema,
  memoryPasswordSchema,
  type MemoryEntry,
  type MemoryKind,
  type MemoryOverview,
  type MemoryPage,
  type MemoryQuery,
} from "./dashboard.js";

const rowSchema = z.object({ id: z.string() }).passthrough();
const paths: Record<MemoryKind, string> = {
  traces: "traces",
  policies: "policies",
  worldModels: "world-models",
  skills: "skills",
};
const overviewSchema = z.object({
  traces: z.number(),
  episodes: z.number(),
  worldModels: z.number(),
  policies: z.object({ total: z.number() }),
  skills: z.object({ total: z.number() }),
});

/** Only fixed, read-only Viewer routes are available through the host RPC. */
export class MemosDashboardService {
  constructor(
    private readonly getStatus: () => MemosStatus,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    route: string,
    params?: URLSearchParams,
    session?: string,
    password?: string,
  ): Promise<Response> {
    const status = this.getStatus();
    if (status.state !== "ready" || !status.viewerUrl)
      throw new Error("MEMOS_UNAVAILABLE");
    const base = new URL(status.viewerUrl);
    if (
      base.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    ) {
      throw new Error("MEMOS_INVALID_ADDRESS");
    }
    const url = new URL(`/api/v1/${route}`, base);
    if (params) url.search = params.toString();
    const response = await this.fetcher(url, {
      method: password === undefined ? "GET" : "POST",
      headers: {
        ...(session ? { Cookie: memorySessionSchema.parse(session) } : {}),
        ...(password === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: password === undefined ? undefined : JSON.stringify({ password }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403)
      throw new Error("MEMOS_AUTH_REQUIRED");
    if (!response.ok) throw new Error(`MEMOS_HTTP_${response.status}`);
    return response;
  }

  private async read(
    route: string,
    params?: URLSearchParams,
    session?: string,
  ): Promise<unknown> {
    return (await this.request(route, params, session)).json();
  }

  async login(password: string): Promise<string> {
    const response = await this.request(
      "auth/login",
      undefined,
      undefined,
      memoryPasswordSchema.parse(password),
    );
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .find((value) => memorySessionSchema.safeParse(value).success);
    if (!cookie) throw new Error("MEMOS_INVALID_SESSION");
    return cookie;
  }

  async overview(session?: string): Promise<MemoryOverview> {
    const data = overviewSchema.parse(
      await this.read("overview", undefined, session),
    );
    return {
      ...data,
      policies: data.policies.total,
      skills: data.skills.total,
    };
  }

  async browse(input: MemoryQuery): Promise<MemoryPage> {
    const query = memoryQuerySchema.parse(input);
    const params = new URLSearchParams({
      limit: "30",
      offset: String(query.offset),
      q: query.query.trim(),
    });
    const data = z
      .object({
        total: z.number().optional(),
        nextOffset: z.number().optional(),
      })
      .passthrough()
      .parse(await this.read(paths[query.kind], params, query.session));
    const rows = z.array(rowSchema).parse(data[query.kind]);
    return {
      entries: rows.map(normalizeEntry),
      total: data.total ?? null,
      nextOffset:
        data.nextOffset !== undefined &&
        (data.total === undefined || data.nextOffset < data.total)
          ? data.nextOffset
          : null,
    };
  }
}

function normalizeEntry(row: z.infer<typeof rowSchema>): MemoryEntry {
  const string = (key: string) =>
    typeof row[key] === "string" ? (row[key] as string) : "";
  const fields = [
    "summary",
    "userText",
    "agentText",
    "trigger",
    "procedure",
    "verification",
    "boundary",
    "body",
    "invocationGuide",
  ];
  return {
    id: row.id,
    title:
      string("title") ||
      string("name") ||
      string("summary") ||
      string("userText") ||
      row.id,
    sections: fields.flatMap((label) =>
      string(label) ? [{ label, text: string(label) }] : [],
    ),
    sessionId: string("sessionId") || null,
    profile: string("ownerProfileId") || null,
    timestamp:
      ([row.ts, row.updatedAt, row.createdAt].find(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) as number | undefined) ?? null,
    status: string("status") || null,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}
