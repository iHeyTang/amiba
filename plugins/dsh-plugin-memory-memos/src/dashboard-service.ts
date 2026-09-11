import { z } from "zod";
import type { MemosStatus } from "./memos-status.js";
import {
  memoryQuerySchema,
  memoryUpdateSchema,
  type MemoryUpdate,
  memoryDetailQuerySchema,
  type MemoryDetail,
  type MemoryDetailQuery,
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

/** Fixed local routes only; corrections are limited to editable content and reversible archival. */
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
    mutation?: { method: "POST" | "PATCH"; body: Record<string, unknown> },
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
      method: mutation?.method ?? (password === undefined ? "GET" : "POST"),
      headers: {
        ...(session ? { Cookie: memorySessionSchema.parse(session) } : {}),
        ...(password === undefined && !mutation
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: mutation
        ? JSON.stringify(mutation.body)
        : password === undefined
          ? undefined
          : JSON.stringify({ password }),
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

  async update(input: MemoryUpdate): Promise<MemoryEntry> {
    const query = memoryUpdateSchema.parse(input);
    const allowed: Record<string, string[]> = {
      policies: ["trigger", "procedure", "verification", "boundary"],
      worldModels: ["body"],
      skills: ["invocationGuide"],
    };
    const body: Record<string, unknown> = {};
    if (query.action === "correct") {
      if (query.title !== undefined)
        body[query.kind === "skills" ? "name" : "title"] = query.title;
      for (const section of query.sections ?? []) {
        if (!allowed[query.kind]!.includes(section.label))
          throw new Error("MEMOS_INVALID_CORRECTION");
        body[section.label] = section.text;
      }
      await this.request(
        `${paths[query.kind]}/${encodeURIComponent(query.id)}`,
        undefined,
        query.session,
        undefined,
        { method: "PATCH", body },
      );
    } else if (query.kind === "skills") {
      await this.request(
        `skills/${query.action === "archive" ? "archive" : "reactivate"}`,
        undefined,
        query.session,
        undefined,
        { method: "POST", body: { id: query.id } },
      );
    } else {
      await this.request(
        `${paths[query.kind]}/${encodeURIComponent(query.id)}`,
        undefined,
        query.session,
        undefined,
        {
          method: "PATCH",
          body: { status: query.action === "archive" ? "archived" : "active" },
        },
      );
    }
    return normalizeEntry(
      rowSchema.parse(
        await this.read(
          `${paths[query.kind]}/${encodeURIComponent(query.id)}`,
          undefined,
          query.session,
        ),
      ),
      query.kind,
    );
  }

  async detail(input: MemoryDetailQuery): Promise<MemoryDetail> {
    const query = memoryDetailQuerySchema.parse(input);
    const id = encodeURIComponent(query.id);
    if (query.kind === "episodes") {
      const data = z
        .object({ traces: z.array(rowSchema) })
        .parse(
          await this.read(`episodes/${id}/timeline`, undefined, query.session),
        );
      const first = data.traces[0];
      const conversations = groupTraces(data.traces);
      return {
        entry: normalizeEntry({
          id: query.id,
          title: first?.summary || first?.userText || query.id,
          sessionId: first?.sessionId,
          ts: first?.ts,
        }),
        relations: conversations.map((row) => ({
          kind: "traces",
          id: row.id,
          title: row.title,
          episodeId: row.episodeId,
          turnId: row.turnId,
        })),
        facts: [],
      };
    }
    if (
      query.kind === "traces" &&
      query.episodeId &&
      query.turnId !== undefined
    ) {
      const data = z
        .object({ traces: z.array(rowSchema) })
        .parse(
          await this.read(
            `episodes/${encodeURIComponent(query.episodeId)}/timeline`,
            undefined,
            query.session,
          ),
        );
      const rows = data.traces.filter(
        (row) =>
          String(
            row.turnId ??
              (row.meta as Record<string, unknown> | undefined)?.turnId,
          ) === String(query.turnId),
      );
      if (!rows.length) throw new Error("MEMOS_HTTP_404");
      return {
        entry: groupTraces(rows)[0]!,
        steps: rows.map((row) => normalizeEntry(row, "traces")),
        relations: [],
        facts: [],
      };
    }
    const row = rowSchema.parse(
      await this.read(`${paths[query.kind]}/${id}`, undefined, query.session),
    );
    const relations: MemoryDetail["relations"] = [];
    const add = (kind: MemoryDetailQuery["kind"], value: unknown) => {
      if (!Array.isArray(value)) return;
      for (const id of value)
        if (
          typeof id === "string" &&
          id &&
          !relations.some((item) => item.kind === kind && item.id === id)
        )
          relations.push({ kind, id, title: id });
    };
    add("traces", row.sourceTraceIds);
    add("traces", row.evidenceAnchors);
    add("policies", row.policyIds);
    add("policies", row.sourcePolicyIds);
    add("worldModels", row.sourceWorldModelIds);
    add("episodes", row.sourceEpisodeIds);
    if (typeof row.episodeId === "string") add("episodes", [row.episodeId]);
    let relationsUnavailable = false;
    if (query.kind !== "traces") {
      try {
        const usage = z
          .record(z.string(), z.unknown())
          .parse(
            await this.read(
              `${paths[query.kind]}/${id}/usage`,
              undefined,
              query.session,
            ),
          );
        for (const [field, kind] of [
          ["skills", "skills"],
          ["worldModels", "worldModels"],
          ["policies", "policies"],
          ["sourcePolicies", "policies"],
          ["sourceWorldModels", "worldModels"],
        ] as const) {
          const rows = usage[field];
          if (!Array.isArray(rows)) continue;
          for (const item of rows) {
            const parsed = rowSchema.safeParse(item);
            if (!parsed.success) continue;
            const row = parsed.data;
            const title =
              typeof row.title === "string"
                ? row.title
                : typeof row.name === "string"
                  ? row.name
                  : row.id;
            const existing = relations.find(
              (r) => r.kind === kind && r.id === row.id,
            );
            if (existing) existing.title = title;
            else relations.push({ kind, id: row.id, title });
          }
        }
      } catch (cause) {
        if (
          cause instanceof Error &&
          cause.message.includes("MEMOS_AUTH_REQUIRED")
        )
          throw cause;
        relationsUnavailable = true;
      }
    }
    const facts = [
      "confidence",
      "support",
      "gain",
      "version",
      "trialsAttempted",
      "trialsPassed",
      "usageCount",
      "experienceType",
    ].flatMap((label) => {
      const value = row[label];
      return typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value))
        ? [{ label, value: String(value) }]
        : [];
    });
    return {
      entry: normalizeEntry(row, query.kind),
      relations,
      relationsUnavailable,
      facts,
    };
  }

  async browse(input: MemoryQuery): Promise<MemoryPage> {
    const query = memoryQuerySchema.parse(input);
    if (query.kind === "remembered") {
      const collections = await Promise.all(
        (["policies", "worldModels", "skills"] as const).map(async (kind) => {
          const entries: MemoryEntry[] = [];
          let offset = 0;
          let total: number | null = null;
          let next: number | null = 0;
          while (next !== null && entries.length < query.offset + 31) {
            const page = await this.browse({ ...query, kind, offset });
            entries.push(...page.entries);
            total = page.total;
            next = page.nextOffset;
            if (next !== null && next <= offset) break;
            offset = next ?? 0;
          }
          return { entries, total, more: next !== null };
        }),
      );
      const entries = collections
        .flatMap((page) => page.entries)
        .sort(
          (a, b) =>
            (b.timestamp ?? 0) - (a.timestamp ?? 0) ||
            `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
        );
      return {
        entries: entries.slice(query.offset, query.offset + 30),
        total: collections.every((page) => page.total !== null)
          ? collections.reduce((sum, page) => sum + page.total!, 0)
          : null,
        nextOffset:
          entries.length > query.offset + 30 ||
          collections.some((page) => page.more)
            ? query.offset + 30
            : null,
      };
    }
    const params = new URLSearchParams({
      limit: "30",
      offset: String(query.offset),
      q: query.query.trim(),
    });
    if (query.kind === "traces") params.set("groupByTurn", "true");
    const data = z
      .object({
        total: z.number().optional(),
        nextOffset: z.number().optional(),
      })
      .passthrough()
      .parse(await this.read(paths[query.kind], params, query.session));
    const rows = z.array(rowSchema).parse(data[query.kind]);
    return {
      entries:
        query.kind === "traces"
          ? groupTraces(rows)
          : rows.map((row) => normalizeEntry(row, query.kind as MemoryKind)),
      total: data.total ?? null,
      nextOffset:
        data.nextOffset !== undefined &&
        data.nextOffset > query.offset &&
        (data.total === undefined || data.nextOffset < data.total)
          ? data.nextOffset
          : null,
    };
  }
}

function normalizeEntry(
  row: z.infer<typeof rowSchema>,
  kind?: MemoryKind,
): MemoryEntry {
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
    kind,
    category:
      row.experienceType === "preference"
        ? "preference"
        : kind === "worldModels"
          ? "context"
          : kind === "traces"
            ? "conversation"
            : "approach",
    title:
      string("title") ||
      string("name") ||
      string("summary") ||
      string("userText") ||
      row.id,
    sections: [
      ...fields.flatMap((label) =>
        string(label) ? [{ label, text: string(label) }] : [],
      ),
      ...(kind === "traces" &&
      Array.isArray(row.toolCalls) &&
      row.toolCalls.length
        ? [{ label: "toolCalls", text: JSON.stringify(row.toolCalls, null, 2) }]
        : []),
    ],
    sessionId: string("sessionId") || null,
    profile: string("ownerProfileId") || null,
    timestamp:
      ([row.ts, row.updatedAt, row.createdAt].find(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          Number.isFinite(new Date(value).getTime()),
      ) as number | undefined) ?? null,
    status: string("status") || null,
    tags: Array.isArray(row.tags ?? row.domainTags)
      ? ((row.tags ?? row.domainTags) as unknown[]).filter(
          (tag): tag is string => typeof tag === "string",
        )
      : [],
  };
}

function groupTraces(rows: z.infer<typeof rowSchema>[]): MemoryEntry[] {
  const groups = new Map<string, z.infer<typeof rowSchema>[]>();
  for (const row of rows) {
    const turnId =
      row.turnId ?? (row.meta as Record<string, unknown> | undefined)?.turnId;
    const key =
      row.episodeId &&
      (typeof turnId === "string" ||
        (typeof turnId === "number" && Number.isFinite(turnId)))
        ? JSON.stringify([row.episodeId, turnId])
        : row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((steps) => {
    steps.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
    const response = [...steps]
      .reverse()
      .find((row) => typeof row.agentText === "string" && row.agentText.trim());
    const first = steps[0]!;
    const userText = steps.find(
      (row) => typeof row.userText === "string" && row.userText.trim(),
    )?.userText as string | undefined;
    const entry = normalizeEntry(response ?? first, "traces");
    const turnId =
      first.turnId ??
      (first.meta as Record<string, unknown> | undefined)?.turnId;
    return {
      ...entry,
      id: first.id,
      title: userText?.split("\n")[0]?.slice(0, 160) || entry.title,
      episodeId:
        typeof first.episodeId === "string" ? first.episodeId : undefined,
      turnId:
        typeof turnId === "string" || typeof turnId === "number"
          ? turnId
          : undefined,
      stepCount: steps.length,
      sections: [
        ...(userText ? [{ label: "userText", text: userText }] : []),
        ...(response
          ? [{ label: "agentText", text: response.agentText as string }]
          : []),
      ],
    };
  });
}
