import type { ToolCallBlock } from "@amiba/extension-sdk";
import { createContext, useContext, type ReactNode } from "react";
import { WorkbenchViewBoundary } from "../workbench-extensions";
import { toolCallResultImages } from "./tool-call-block";

type Images = ReturnType<typeof toolCallResultImages>;
interface ImageEvidence {
  callId: string;
  render: (images: Images) => ReactNode;
}
const Context = createContext<ImageEvidence | null>(null);

/** Scope evidence to one call so nested tool rows never reuse a parent's images. */
export function ToolImageEvidenceProvider({ callId, render, children }: {
  callId: string;
  render?: (images: Images) => ReactNode;
  children: ReactNode;
}) {
  return <Context.Provider value={render ? { callId, render } : null}>{children}</Context.Provider>;
}
function ImageEvidenceView({ images, render }: { images: Images; render: ImageEvidence["render"] }) {
  return <>{render(images)}</>;
}
export function useToolImageEvidence(callId: string, block: ToolCallBlock | null): ReactNode {
  const source = useContext(Context);
  if (!source || source.callId !== callId || !block) return null;
  const images = toolCallResultImages(block);
  if (!images.length) return null;
  return <WorkbenchViewBoundary key={callId} fallback={null}>
    <ImageEvidenceView images={images} render={source.render} />
  </WorkbenchViewBoundary>;
}
