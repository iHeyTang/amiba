import { describe, expect, it, vi } from "vitest";
import { MemosDashboardService } from "./dashboard-service.js";
import { initialMemosStatus } from "./memos-status.js";

function setup(payload: unknown, url = "http://127.0.0.1:18801") {
  const status = {
    ...initialMemosStatus("/tmp/memos"),
    state: "ready" as const,
    viewerUrl: url,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(payload)));
  return { service: new MemosDashboardService(() => status, fetcher), fetcher };
}
describe("MemOS dashboard adapter", () => {
  it("uses upstream login and scopes the signed session to each request", async () => {
    const { service, fetcher } = setup({
      traces: 0,
      episodes: 0,
      worldModels: 0,
      policies: { total: 0 },
      skills: { total: 0 },
    });
    fetcher.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: {
          "set-cookie":
            "memos_sess_deepseek-harness=signed.token; HttpOnly; Path=/",
        },
      }),
    );
    const session = await service.login("test-password");
    expect(session).toBe("memos_sess_deepseek-harness=signed.token");
    expect((fetcher.mock.calls[0]![0] as URL).pathname).toBe(
      "/api/v1/auth/login",
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ password: "test-password" }),
    });
    await service.overview(session);
    expect(fetcher.mock.calls[1]![1]?.headers).toEqual({ Cookie: session });
    // A different client without a session must not inherit another client's login.
    await service.overview();
    expect(fetcher.mock.calls[2]![1]?.headers).toEqual({});
  });
  it("rejects cookie injection before transmitting a request", async () => {
    const { service, fetcher } = setup({});
    await expect(
      service.overview("memos_sess=token; other=secret"),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves source content and normalizes trace pagination", async () => {
    const { service, fetcher } = setup({
      traces: [
        {
          id: "t1",
          summary: "A preference",
          userText: "Use Chinese",
          agentText: "好的",
          sessionId: "s1",
          ownerProfileId: "standard",
          ts: 123,
          tags: ["language"],
        },
      ],
      total: 1,
      nextOffset: 30,
    });
    const page = await service.browse({
      kind: "traces",
      query: "a & b",
      offset: 0,
    });
    expect(page.nextOffset).toBeNull();
    expect(page.entries[0]).toMatchObject({
      id: "t1",
      sessionId: "s1",
      profile: "standard",
      sections: expect.arrayContaining([
        { label: "userText", text: "Use Chinese" },
      ]),
    });
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/api/v1/traces");
    expect(url.searchParams.get("q")).toBe("a & b");
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("error");
  });
  it.each(["policies", "worldModels", "skills"] as const)(
    "reads %s using its upstream collection key",
    async (kind) => {
      const { service } = setup({
        [kind]: [
          {
            id: "one",
            title: "Title",
            body: "Knowledge",
            invocationGuide: "Guide",
          },
        ],
        total: 61,
        nextOffset: 30,
      });
      expect(
        await service.browse({ kind, query: "", offset: 0 }),
      ).toMatchObject({
        nextOffset: 30,
        total: 61,
        entries: [{ id: "one", title: "Title" }],
      });
    },
  );
  it("maps aggregated counts", async () => {
    const { service } = setup({
      traces: 8,
      episodes: 2,
      worldModels: 1,
      policies: { total: 4 },
      skills: { total: 3 },
    });
    expect(await service.overview()).toEqual({
      traces: 8,
      episodes: 2,
      worldModels: 1,
      policies: 4,
      skills: 3,
    });
  });
  it.each([
    "https://example.com",
    "http://127.0.0.1:18801/private",
    "http://user:pass@localhost:18801",
    "http://localhost:18801/?x=1",
  ])("rejects invalid endpoint %s before fetching", async (url) => {
    const { service, fetcher } = setup({}, url);
    await expect(service.overview()).rejects.toThrow("MEMOS_INVALID_ADDRESS");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects arbitrary routes and invalid pagination", async () => {
    const { service, fetcher } = setup({});
    await expect(
      service.browse({ kind: "config" as never, query: "", offset: 0 }),
    ).rejects.toThrow();
    await expect(
      service.browse({ kind: "traces", query: "", offset: -1 }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports authentication and malformed responses without treating them as empty data", async () => {
    const { service, fetcher } = setup({});
    fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(service.overview()).rejects.toThrow("MEMOS_AUTH_REQUIRED");
    await expect(
      service.browse({ kind: "traces", query: "", offset: 0 }),
    ).rejects.toThrow();
  });
  it("does not query a stopped engine", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new MemosDashboardService(
      () => initialMemosStatus("/tmp/memos"),
      fetcher,
    );
    await expect(service.overview()).rejects.toThrow("MEMOS_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("loads skill evidence and resolves related names using fixed read-only routes", async () => {
    const { service, fetcher } = setup({
      id: "skill-1",
      name: "Research",
      status: "active",
      sourcePolicyIds: ["p1"],
      sourceWorldModelIds: ["w1"],
      evidenceAnchors: ["t1"],
      version: 2,
    });
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "skill-1",
          name: "Research",
          status: "active",
          sourcePolicyIds: ["p1"],
          sourceWorldModelIds: ["w1"],
          evidenceAnchors: ["t1"],
          version: 2,
        }),
      ),
    );
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sourcePolicies: [{ id: "p1", title: "Verify sources" }],
          sourceWorldModels: [{ id: "w1", title: "Research context" }],
        }),
      ),
    );
    const result = await service.detail({
      kind: "skills",
      id: "skill-1",
      session: "memos_sess=token",
    });
    expect(result.relations).toEqual(
      expect.arrayContaining([
        { kind: "policies", id: "p1", title: "Verify sources" },
        { kind: "worldModels", id: "w1", title: "Research context" },
        { kind: "traces", id: "t1", title: "t1" },
      ]),
    );
    expect(result.facts).toContainEqual({ label: "version", value: "2" });
    expect(fetcher.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      "/api/v1/skills/skill-1",
      "/api/v1/skills/skill-1/usage",
    ]);
    expect(
      fetcher.mock.calls.every(
        ([, init]) =>
          (init?.headers as Record<string, string>).Cookie ===
          "memos_sess=token",
      ),
    ).toBe(true);
  });
  it("resolves an episode to its source task and traces", async () => {
    const { service } = setup({
      traces: [{ id: "t1", summary: "Source", sessionId: "s1" }],
    });
    const detail = await service.detail({ kind: "episodes", id: "e1" });
    expect(detail.entry.sessionId).toBe("s1");
    expect(detail.relations).toEqual([
      { kind: "traces", id: "t1", title: "Source" },
    ]);
  });
  it("keeps the body available when relationship loading fails", async () => {
    const { service, fetcher } = setup({});
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "w1",
          body: "Context",
          domainTags: ["browser"],
          policyIds: ["p1"],
        }),
      ),
    );
    fetcher.mockResolvedValueOnce(new Response("", { status: 500 }));
    const detail = await service.detail({ kind: "worldModels", id: "w1" });
    expect(detail.relationsUnavailable).toBe(true);
    expect(detail.entry.tags).toEqual(["browser"]);
    expect(detail.entry.sections).toContainEqual({
      label: "body",
      text: "Context",
    });
  });
  it("rejects path traversal before detail requests", async () => {
    const { service, fetcher } = setup({});
    await expect(
      service.detail({ kind: "traces", id: ".." }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shows one conversation for multiple tool steps and preserves its execution detail", async () => {
    const rows = [
      {
        id: "tool-1",
        episodeId: "episode",
        turnId: 10,
        ts: 1,
        userText: "帮我核对新闻",
        summary: "打开网页",
        agentText: "",
        toolCalls: [{ name: "browser", output: "page" }],
      },
      {
        id: "tool-2",
        episodeId: "episode",
        turnId: 10,
        ts: 2,
        userText: "帮我核对新闻",
        summary: "搜索资料",
        agentText: "",
      },
      {
        id: "answer",
        episodeId: "episode",
        turnId: 10,
        ts: 3,
        userText: "帮我核对新闻",
        agentText: "核对后的结论",
        sessionId: "task",
      },
    ];
    const { service, fetcher } = setup({ traces: rows, total: 1 });
    const page = await service.browse({ kind: "traces", query: "", offset: 0 });
    expect(
      (fetcher.mock.calls[0]![0] as URL).searchParams.get("groupByTurn"),
    ).toBe("true");
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      title: "帮我核对新闻",
      stepCount: 3,
      turnId: 10,
      episodeId: "episode",
    });
    expect(page.entries[0]!.sections).toEqual([
      { label: "userText", text: "帮我核对新闻" },
      { label: "agentText", text: "核对后的结论" },
    ]);
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          traces: [
            ...rows,
            {
              id: "other",
              episodeId: "episode",
              turnId: 20,
              userText: "另一轮",
            },
          ],
        }),
      ),
    );
    const detail = await service.detail({
      kind: "traces",
      id: "tool-1",
      episodeId: "episode",
      turnId: 10,
    });
    expect(detail.steps).toHaveLength(3);
    expect(
      detail.steps![0]!.sections.some(
        (section) => section.label === "toolCalls",
      ),
    ).toBe(true);
  });
  it("merges lasting memories across collections without requesting raw traces", async () => {
    const { service, fetcher } = setup({});
    fetcher.mockImplementation(async (input) => {
      const path = (input as URL).pathname;
      const kind = path.endsWith("world-models")
        ? "worldModels"
        : path.endsWith("policies")
          ? "policies"
          : "skills";
      return new Response(
        JSON.stringify({
          [kind]: [
            {
              id: kind,
              title: kind,
              updatedAt: kind === "policies" ? 3 : 1,
              experienceType: kind === "policies" ? "preference" : undefined,
            },
          ],
          total: 1,
        }),
      );
    });
    const page = await service.browse({
      kind: "remembered",
      query: "",
      offset: 0,
    });
    expect(page.total).toBe(3);
    expect(page.entries[0]).toMatchObject({
      kind: "policies",
      category: "preference",
    });
    expect(
      fetcher.mock.calls.some(([url]) =>
        (url as URL).pathname.includes("traces"),
      ),
    ).toBe(false);
  });
  it("writes corrections through authenticated, field-restricted routes", async () => {
    const { service, fetcher } = setup({
      id: "p1",
      title: "Use concise Chinese",
      procedure: "Keep replies short",
      status: "active",
    });
    const entry = await service.update({
      kind: "policies",
      id: "p1",
      action: "correct",
      title: "Use concise Chinese",
      sections: [{ label: "procedure", text: "Keep replies short" }],
      session: "memos_sess=token",
    });
    expect(entry.title).toBe("Use concise Chinese");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        title: "Use concise Chinese",
        procedure: "Keep replies short",
      }),
      headers: { Cookie: "memos_sess=token" },
    });
    await expect(
      service.update({
        kind: "worldModels",
        id: "w1",
        action: "correct",
        sections: [{ label: "procedure", text: "wrong field" }],
      }),
    ).rejects.toThrow("MEMOS_INVALID_CORRECTION");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("archives and restores skills without deleting their evidence", async () => {
    const { service, fetcher } = setup({
      id: "s1",
      name: "Skill",
      status: "archived",
    });
    await service.update({ kind: "skills", id: "s1", action: "archive" });
    await service.update({ kind: "skills", id: "s1", action: "restore" });
    expect(
      fetcher.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([url]) => (url as URL).pathname),
    ).toEqual(["/api/v1/skills/archive", "/api/v1/skills/reactivate"]);
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });
});
