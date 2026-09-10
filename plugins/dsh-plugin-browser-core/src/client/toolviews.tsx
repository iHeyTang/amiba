import { useEffect, useState } from "react";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import {
  recordOf,
  toolCallSettled,
  SemanticToolRow,
  CodeEvidence,
  StructuredEvidence,
  decodeToolResult,
  oneline,
  stringValue,
  usePluginT,
  type SemanticEvidenceContext,
  type SemanticToolSpec,
} from "@amiba/ui/plugin";
import {
  Camera,
  FileText,
  Globe,
  Keyboard,
  MousePointer,
  Terminal,
} from "lucide-react";

import { copy } from "./i18n-toolviews.js";

function resultEvidence(ctx: SemanticEvidenceContext) {
  const value = decodeToolResult(ctx.text);
  return typeof value === "string" ? (
    value ? (
      <CodeEvidence text={value} />
    ) : null
  ) : (
    <StructuredEvidence value={value} />
  );
}

const specs: Record<string, SemanticToolSpec> = {
  amiba_browser_open: {
    icon: Globe,
    action: "amiba_browser_open",
    target: (args) => oneline(stringValue(args, "url")),
    evidence: resultEvidence,
  },
  amiba_browser_snapshot: {
    icon: FileText,
    action: "amiba_browser_snapshot",
    evidence: resultEvidence,
  },
  amiba_browser_click: {
    icon: MousePointer,
    action: "amiba_browser_click",
    target: (args) => oneline(stringValue(args, "target")),
    evidence: resultEvidence,
  },
  amiba_browser_type: {
    icon: Keyboard,
    action: "amiba_browser_type",
    target: (args) => oneline(stringValue(args, "target")),
    evidence: resultEvidence,
  },
  amiba_browser_press: {
    icon: Keyboard,
    action: "amiba_browser_press",
    target: (args) => oneline(stringValue(args, "key")),
    evidence: resultEvidence,
  },
  amiba_browser_scroll: {
    icon: MousePointer,
    action: "amiba_browser_scroll",
    target: (args) => oneline(stringValue(args, "direction")),
    evidence: resultEvidence,
  },
  amiba_browser_screenshot: {
    icon: Camera,
    action: "amiba_browser_screenshot",
    evidence: resultEvidence,
  },
  amiba_browser_console: {
    icon: Terminal,
    action: "amiba_browser_console",
    evidence: resultEvidence,
  },
};

export type LoadToolImage = (
  sessionId: string,
  attachmentId: string,
) => Promise<{ data: Uint8Array; mediaType: string }>;
function ToolImage({
  sessionId,
  id,
  load,
}: {
  sessionId: string;
  id: string;
  load: LoadToolImage;
}) {
  const { t } = usePluginT(copy);
  const [state, setState] = useState<{ src?: string; error?: string }>({});
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setState({});
    void load(sessionId, id)
      .then(({ data, mediaType }) => {
        if (!active) return;
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            mediaType,
          )
        )
          throw new Error(mediaType);
        url = URL.createObjectURL(
          new Blob([Uint8Array.from(data).buffer], { type: mediaType }),
        );
        setState({ src: url });
      })
      .catch(() => {
        if (active) setState({ error: t("browser.image.error") });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sessionId, id, load, t]);
  return state.src ? (
    <img
      src={state.src}
      alt={t("amiba_browser_screenshot")}
      className="max-h-96 max-w-full rounded-md object-contain"
    />
  ) : (
    <p className="px-3 py-2 text-xs text-muted-foreground">
      {state.error ?? t("browser.image.loading")}
    </p>
  );
}

export function createToolviews(load?: LoadToolImage) {
  return Object.entries(specs).map(([key, spec]) => ({
    key,
    component: function Toolview(
      owner: ToolCallOwnerProps & { sessionId?: string },
    ) {
      const { t } = usePluginT(copy);
      const withImages: SemanticToolSpec = {
        ...spec,
        evidence: (ctx) => {
          const images = (toolCallSettled(ctx.block)?.content ?? []).flatMap(
            (item) => {
              const value = recordOf(item);
              const attachment = recordOf(value?.attachment);
              const id = attachment && stringValue(attachment, "attachmentId");
              return value?.type === "image" && id ? [id] : [];
            },
          );
          return (
            <>
              {resultEvidence(ctx)}
              {images.map((id) =>
                load && owner.sessionId ? (
                  <ToolImage
                    key={id}
                    id={id}
                    sessionId={owner.sessionId}
                    load={load}
                  />
                ) : (
                  <CodeEvidence key={id} text={id} />
                ),
              )}
            </>
          );
        },
      };
      return (
        <SemanticToolRow owner={owner} spec={withImages} tag={key} t={t} />
      );
    },
  }));
}
export const TOOLVIEWS = createToolviews();
