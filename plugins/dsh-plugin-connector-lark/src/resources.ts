import type {
  ResourceSource,
  ResourceSummary,
  ResourceRef,
  ResourcePurpose,
  ResourceSearchResult,
} from "@amiba/dsh-plugin-resources";
import {
  CONTACT_SCOPE,
  SEARCH_SCOPE,
  DOCUMENT_SCOPE,
  LarkPersonalService,
  larkEndpoints,
  record,
  string,
} from "./personal.js";

const items = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const plain = (value: unknown) =>
  string(value)
    .replace(/<[^>]*>/g, "")
    .slice(0, 500);
function docLocator(value: unknown): { id: string; url: string } | undefined {
  try {
    const url = new URL(string(value));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !/\.(feishu\.cn|larksuite\.com)$/.test(url.hostname)
    )
      return;
    const match = /^\/docx\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
    if (match) return { id: match[1]!, url: `${url.origin}${url.pathname}` };
  } catch {
    /* Unsupported results are not document references. */
  }
}
function person(
  row: Record<string, unknown>,
  ref: ResourceRef,
  account: string,
): ResourceSummary {
  const meta = record(row.meta_data),
    names = record(meta.i18n_names);
  const title =
    plain(names.zh_cn) ||
    plain(names.en_us) ||
    Object.values(names).map(plain).find(Boolean) ||
    ref.id;
  return {
    ref,
    title,
    account,
    description: (
      string(meta.enterprise_mail_address) ||
      string(meta.mail_address) ||
      string(meta.description)
    ).slice(0, 1000),
  };
}

/** Platform data and scopes live here, never in the resource host or composer. */
export function createLarkResourceSource(
  personal: LarkPersonalService,
): ResourceSource {
  return {
    id: "lark",
    async search(request, purpose, signal) {
      const accounts = (await personal.accounts.list()).filter(
        (account) =>
          !request.connectionId || account.id === request.connectionId,
      );
      const kinds = ["contact", "docx"].filter(
        (kind) => !request.kind || request.kind === kind,
      );
      if (request.connectionId && !accounts.length)
        return {
          items: [],
          unavailable: [
            {
              source: "lark",
              connectionId: request.connectionId,
              reason: "connection_unavailable",
            },
          ],
        };
      const results = await Promise.all(
        accounts.map(async (account): Promise<ResourceSearchResult> => {
          const result: ResourceSearchResult = { items: [], unavailable: [] };
          // Bound upstream parallelism to one request per account; kinds fail independently.
          for (const kind of kinds) {
            signal.throwIfAborted();
            try {
              const found = await personal.withUser(
                account.id,
                kind === "contact"
                  ? [CONTACT_SCOPE]
                  : [SEARCH_SCOPE, DOCUMENT_SCOPE],
                purpose === "model",
                async (api, config, accountName, identity) => {
                  const ref = (id: string): ResourceRef => ({
                    source: "lark",
                    connectionId: account.id,
                    identity,
                    kind,
                    id,
                  });
                  if (kind === "contact") {
                    if ([...request.query].length > 50)
                      throw new Error("contact_query_too_long");
                    const data = await api(
                      "/open-apis/contact/v3/users/search?page_size=10",
                      { query: request.query },
                    );
                    return items(data.items)
                      .filter((row) => string(row.id))
                      .slice(0, 10)
                      .map((row) =>
                        person(row, ref(string(row.id)), accountName),
                      );
                  }
                  const data = await api(
                    "/open-apis/search/v2/doc_wiki/search",
                    {
                      query: request.query,
                      page_size: 20,
                      doc_filter: {},
                      wiki_filter: {},
                    },
                  );
                  return items(data.res_units)
                    .flatMap((row): ResourceSummary[] => {
                      const meta = record(row.result_meta),
                        locator = docLocator(meta.url);
                      return locator
                        ? [
                            {
                              ref: ref(locator.id),
                              title: plain(row.title_highlighted) || "飞书文档",
                              account: accountName,
                              url: locator.url,
                            },
                          ]
                        : [];
                    })
                    .slice(0, 10);
                },
                signal,
              );
              result.items.push(...found);
            } catch {
              signal.throwIfAborted();
              result.unavailable.push({
                source: "lark",
                connectionId: account.id,
                reason: "permission_or_source_unavailable",
              });
            }
          }
          return result;
        }),
      );
      return {
        items: results.flatMap((result) => result.items),
        unavailable: results.flatMap((result) => result.unavailable),
      };
    },
    async read(ref, purpose, signal) {
      if (!["contact", "docx"].includes(ref.kind))
        throw new Error("resource_kind_unavailable");
      return personal.withUser(
        ref.connectionId,
        ref.kind === "contact" ? [CONTACT_SCOPE] : [DOCUMENT_SCOPE],
        purpose !== "preview",
        async (api, config, accountName, identity) => {
          if (ref.identity !== identity)
            throw new Error("resource_identity_changed");
          if (ref.kind === "contact") {
            const data = await api(
              "/open-apis/contact/v3/users/search?page_size=10",
              { filter: { user_ids: [ref.id] } },
            );
            const row = items(data.items).find((value) => value.id === ref.id);
            if (!row) throw new Error("resource_unavailable");
            const summary = person(row, ref, accountName);
            const meta = record(row.meta_data);
            const fields = [
              {
                label: "邮箱",
                value:
                  string(meta.enterprise_mail_address) ||
                  string(meta.mail_address),
              },
              { label: "简介", value: string(meta.description) },
            ]
              .filter((field) => field.value)
              .map((field) => ({
                ...field,
                value: field.value.slice(0, 1000),
              }));
            return {
              ...summary,
              fields,
              text: [
                summary.title,
                ...fields.map((field) => `${field.label}: ${field.value}`),
              ].join("\n"),
              truncated: false,
            };
          }
          if (!/^[a-zA-Z0-9]+$/.test(ref.id))
            throw new Error("invalid_document_id");
          const path = `/open-apis/docx/v1/documents/${encodeURIComponent(ref.id)}`;
          const metadata = await api(path);
          const content =
            purpose === "reference" ? {} : await api(`${path}/raw_content`);
          const text = string(content.content);
          return {
            ref,
            account: accountName,
            title: plain(record(metadata.document).title) || "飞书文档",
            text: text.slice(0, 40_000),
            truncated: text.length > 40_000,
          };
        },
        signal,
      );
    },
  };
}
