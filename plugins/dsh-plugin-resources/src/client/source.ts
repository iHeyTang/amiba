import type { InputTriggerSource } from "@amiba/extension-sdk";
import { referenceHref } from "@amiba/ui/plugin";
import {
  decodeResourceRef,
  encodeResourceRef,
  resourceLink,
} from "../protocol.js";
import type { ResourcesRemote } from "../remote.js";
export const RESOURCE_INPUT_SOURCE = "resources";
export function createResourceInputSource(
  remote: ResourcesRemote,
): InputTriggerSource {
  return {
    trigger: "@",
    name: RESOURCE_INPUT_SOURCE,
    order: 70,
    async candidates(_session, { query, signal }) {
      if (!query.trim()) return [];
      // Debounce the remote search, cancelling before any personal data request.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("search_cancelled"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 250);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      const result = await remote.search({ query });
      signal.throwIfAborted();
      if (!result.ok) throw new Error("resource_search_unavailable");
      const zh = document.documentElement.lang.startsWith("zh");
      if (!result.value.items.length && result.value.unavailable.length)
        throw new Error(
          zh
            ? "部分连接未授权个人资源，请检查连接设置"
            : "Personal resources unavailable; check connection settings",
        );
      const warning = result.value.unavailable.length
        ? zh
          ? " · 部分来源不可用"
          : " · Some sources unavailable"
        : "";
      return result.value.items.map((item) => ({
        name: item.title,
        description: [item.description, warning].filter(Boolean).join(" "),
        hint: item.account,
        section: `${item.account} · ${item.ref.source}`,
        value: encodeResourceRef(item.ref),
      }));
    },
    onPick({ candidate }) {
      if (!candidate.value) throw new Error("invalid_resource_candidate");
      const ref = decodeResourceRef(candidate.value);
      return {
        insert: {
          source: RESOURCE_INPUT_SOURCE,
          ref: encodeResourceRef(ref),
          label: [candidate.name, candidate.hint].filter(Boolean).join(" · "),
          clipboardText: resourceLink(ref),
        },
      };
    },
    codec: {
      clipboardText: (ref) => resourceLink(decodeResourceRef(ref)),
      async serialize(ref, signal) {
        signal.throwIfAborted();
        const result = await remote.reference(decodeResourceRef(ref));
        signal.throwIfAborted();
        if (!result.ok)
          throw new Error(
            "此资源未授权给 Agent，或来源已不可用。请在连接设置中检查个人资源权限。",
          );
        const label = `${result.value.title} · ${result.value.account}`.replace(
          /[\[\]\\\r\n]/g,
          " ",
        );
        return `[${label}](${referenceHref({ source: RESOURCE_INPUT_SOURCE, ref })})`;
      },
    },
  };
}
