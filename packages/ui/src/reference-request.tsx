import { File, Folder, MessageSquare } from "lucide-react";
import type { ReferenceAppearance } from "./reference-appearance";
import { useState, type ReactNode } from "react";

/** UI-only, provider-neutral intent. Extensions own resolution and permissions. */
export interface ReferenceRequest {
  source: string;
  ref: string;
}
export const REFERENCE_EVENT = "amiba:open-reference";
export function referenceHref(value: ReferenceRequest): string {
  return `#amiba-reference?${new URLSearchParams({ source: value.source, ref: value.ref }).toString()}`;
}
export function parseReferenceHref(
  href?: string,
): ReferenceRequest | undefined {
  if (!href?.startsWith("#amiba-reference?") || href.length > 40_000) return;
  const params = new URLSearchParams(href.slice("#amiba-reference?".length));
  const source = params.get("source"),
    ref = params.get("ref");
  return source && ref ? { source, ref } : undefined;
}
export function ReferenceButton({
  source,
  reference,
  children,
  appearance,
}: {
  source: string;
  reference: string;
  children: ReactNode;
  appearance?: ReferenceAppearance;
}) {
  const Icon = appearance === "file" ? File : appearance === "folder" ? Folder : appearance === "session" ? MessageSquare : undefined;
  const [unavailable, setUnavailable] = useState(false);
  const zh =
    typeof document !== "undefined" &&
    document.documentElement.lang.startsWith("zh");
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-reference-appearance={appearance}
        className="rounded px-1 text-primary underline decoration-primary/30 underline-offset-2 hover:bg-muted focus-visible:outline focus-visible:outline-2"
        onClick={() => {
          const event = new CustomEvent<ReferenceRequest>(REFERENCE_EVENT, {
            detail: { source, ref: reference },
            cancelable: true,
          });
          setUnavailable(window.dispatchEvent(event));
        }}
      >
        {Icon && <Icon aria-hidden="true" size={12} className="mr-1 inline align-text-bottom" />}
        {children}
      </button>
      {unavailable && (
        <span role="status" className="text-xs text-muted-foreground">
          {zh ? "来源插件不可用" : "Source unavailable"}
        </span>
      )}
    </span>
  );
}

/** User bubbles stay plain text; only explicitly encoded reference links become controls. */
export function ReferenceText({ text }: { text: string }) {
  const matches = [
    ...text.matchAll(/\[([^\]\n]*)\]\((#amiba-reference\?[^\s)]+)\)/g),
  ];
  if (!matches.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index!,
      ref = parseReferenceHref(match[2]);
    parts.push(text.slice(cursor, start));
    parts.push(
      ref ? (
        <ReferenceButton key={start} source={ref.source} reference={ref.ref}>
          {match[1]}
        </ReferenceButton>
      ) : (
        match[0]
      ),
    );
    cursor = start + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
