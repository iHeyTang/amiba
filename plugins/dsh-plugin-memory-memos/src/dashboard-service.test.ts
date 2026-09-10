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
});
