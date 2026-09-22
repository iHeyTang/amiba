import { useMemo, type CSSProperties } from "react";
import JsonView from "@uiw/react-json-view";
import {
  CompactArguments,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

const jsonTheme = {
  fontSize: 12,
  lineHeight: "20px",
  fontFamily: "inherit",
  backgroundColor: "transparent",
  "--w-rjv-background-color": "transparent",
  "--w-rjv-color": "hsl(var(--foreground))",
  "--w-rjv-key-string": "hsl(var(--foreground))",
  "--w-rjv-colon-color": "hsl(var(--foreground))",
  "--w-rjv-curlybraces-color": "hsl(var(--muted-foreground))",
  "--w-rjv-brackets-color": "hsl(var(--muted-foreground))",
  "--w-rjv-info-color": "hsl(var(--muted-foreground))",
  "--w-rjv-copied-color": "hsl(var(--muted-foreground))",
  "--w-rjv-type-string-color": "var(--inspect-json-string)",
  "--w-rjv-quotes-color": "hsl(var(--foreground))",
  "--w-rjv-quotes-string-color": "var(--inspect-json-string)",
  "--w-rjv-line-color": "hsl(var(--border))",
} as CSSProperties;

export function RuntimeInspectEvidence({
  args,
  text,
}: SemanticEvidenceContext) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }, [text]);
  if (!text.trim()) return <CompactArguments value={args} />;
  return (
    <div
      className="[--inspect-json-string:#a34818] dark:[--inspect-json-string:#e6a276] min-w-0 overflow-x-auto rounded-md border border-border/50 bg-muted/20 px-4 py-3 font-mono text-xs leading-5"
      data-json-viewer
    >
      {parsed !== null && typeof parsed === "object" ? (
        <JsonView
          key={text}
          value={parsed}
          collapsed={2}
          displayDataTypes={false}
          displayObjectSize={false}
          shortenTextAfterLength={0}
          highlightUpdates={false}
          style={jsonTheme}
        />
      ) : (
        <pre className="m-0 whitespace-pre">{text}</pre>
      )}
    </div>
  );
}
