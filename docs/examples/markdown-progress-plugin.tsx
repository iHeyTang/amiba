import React from "react";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { MarkdownExtension } from "@amiba/extension-sdk";
import type { CustomRendererProps } from "streamdown";

function Progress({ code, isIncomplete }: CustomRendererProps) {
  if (isIncomplete) return <pre>{code}</pre>;
  const data = JSON.parse(code) as { label?: unknown; value?: unknown };
  if (
    typeof data.label !== "string" ||
    typeof data.value !== "number" ||
    !Number.isFinite(data.value) ||
    data.value < 0 ||
    data.value > 100
  )
    return <pre>{code}</pre>;
  return (
    <figure aria-label={data.label}>
      <figcaption>
        {data.label} · {data.value}%
      </figcaption>
      <progress value={data.value} max={100} />
    </figure>
  );
}
export const extension: MarkdownExtension = {
  id: "example.progress",
  version: "1",
  order: 0,
  plugins: { renderers: [{ language: "amiba-progress", component: Progress }] },
};
export const name = "example-progress-ui";
export const inject = ["slots"];
export function apply(ctx: ClientContext) {
  return ctx.slots.inject("amiba.markdown.extension", () =>
    ctx.slots.register(
      {
        name: "amiba.markdown.extension",
        id: extension.id,
        inject: () => ({ extension }),
      },
      () => null,
    ),
  );
}
