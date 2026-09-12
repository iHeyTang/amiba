import type {
  ResourceSource,
  ResourceSummary,
  ResourceRef,
  ResourceSearchResult,
} from "@amiba/dsh-plugin-resources";
import { DingtalkPersonalService, record, string } from "./personal.js";
const plain = (v: unknown) =>
  string(v)
    .replace(/<[^>]*>/g, "")
    .slice(0, 500);
const first = (row: Record<string, unknown>, keys: string[]) =>
  keys.map((k) => string(row[k])).find(Boolean) || "";
const unwrap = (data: Record<string, unknown>) =>
  Object.keys(record(data.result)).length
    ? record(data.result)
    : Object.keys(record(data.data)).length
      ? record(data.data)
      : data;
function rows(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const object of [data, record(data.result), record(data.data)])
    for (const key of [
      "nodes",
      "documents",
      "list",
      "items",
      "records",
      "result",
      "data",
    ])
      if (Array.isArray(object[key]))
        return (object[key] as unknown[]).map(record);
  // An unknown response shape is an error, never a fabricated empty library.
  throw new Error("invalid_dingtalk_response");
}
function summary(
  row: Record<string, unknown>,
  ref: ResourceRef,
  account: string,
): ResourceSummary {
  const value = first(row, ["url", "docUrl", "nodeUrl", "webUrl"]);
  let url: string | undefined;
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname.endsWith(".dingtalk.com") ||
        u.hostname.endsWith(".alidocs.com"))
    )
      url = u.href;
  } catch {}
  return {
    ref,
    title:
      plain(first(row, ["name", "title", "docName", "fileName"])) || "钉钉文档",
    account: account.slice(0, 200),
    ...(url ? { url } : {}),
  };
}
const safeReasons = new Set([
  "connection_unavailable",
  "personal_authorization_required",
  "personal_authorization_expired",
  "agent_access_disabled",
  "permission_required",
  "permission_or_resource_unavailable",
]);
export function createDingtalkResourceSource(
  personal: DingtalkPersonalService,
): ResourceSource {
  return {
    id: "dingtalk",
    async search(request, purpose, signal) {
      const all = await personal.accounts.list();
      const accounts = all.filter(
        (a) => !request.connectionId || request.connectionId === a.id,
      );
      if (!accounts.length)
        return {
          items: [],
          unavailable: [
            {
              source: "dingtalk",
              ...(request.connectionId
                ? { connectionId: request.connectionId }
                : {}),
              reason: "connection_unavailable",
            },
          ],
        };
      if (request.kind && request.kind !== "doc")
        return {
          items: [],
          unavailable: [
            { source: "dingtalk", reason: "resource_kind_unavailable" },
          ],
        };
      const result: ResourceSearchResult = { items: [], unavailable: [] };
      for (const account of accounts) {
        signal.throwIfAborted();
        try {
          const found = await personal.withUser(
            account.id,
            purpose === "model",
            async (call, name, identity) => {
              const data = await call("search_documents", {
                ...(request.query === "*" ? {} : { keyword: request.query }),
                pageSize: 20,
              });
              return rows(data)
                .slice(0, 20)
                .flatMap((row) => {
                  const id = first(row, [
                    "nodeId",
                    "node_id",
                    "id",
                    "docId",
                    "doc_id",
                  ]);
                  if (!id || id.length > 512) return [];
                  return [
                    summary(
                      row,
                      {
                        source: "dingtalk",
                        connectionId: account.id,
                        identity,
                        kind: "doc",
                        id,
                      },
                      name,
                    ),
                  ];
                });
            },
            signal,
          );
          result.items.push(...found);
        } catch (error) {
          signal.throwIfAborted();
          const reason = error instanceof Error ? error.message : "";
          result.unavailable.push({
            source: "dingtalk",
            connectionId: account.id,
            reason: safeReasons.has(reason) ? reason : "search_failed",
          });
        }
      }
      return result;
    },
    async read(ref, purpose, signal) {
      if (ref.kind !== "doc") throw new Error("resource_kind_unavailable");
      return personal.withUser(
        ref.connectionId,
        purpose !== "preview",
        async (call, name, identity) => {
          if (ref.identity !== identity)
            throw new Error("resource_identity_changed");
          const metadata = unwrap(
            await call("get_document_info", { nodeId: ref.id }),
          );
          const info = summary(metadata, ref, name);
          if (purpose === "reference")
            return { ...info, text: "", truncated: false };
          const data = unwrap(
            await call("get_document_content", {
              nodeId: ref.id,
              format: "markdown",
            }),
          );
          const text =
            typeof data.markdown === "string"
              ? data.markdown
              : typeof data.content === "string"
                ? data.content
                : undefined;
          if (text === undefined) throw new Error("invalid_document_content");
          return {
            ...info,
            text: text.slice(0, 40_000),
            truncated: text.length > 40_000,
          };
        },
        signal,
      );
    },
  };
}
