import type { ReactNode } from "react";
import type { ProviderCardExtrasOwnerProps } from "@amiba/extension-sdk";
import { WorkbenchViewBoundary } from "@amiba/ui/plugin";
export type ProviderCardRenderer = (owner: ProviderCardExtrasOwnerProps) => ReactNode;

function ProviderCardContent({ owner, render }: { owner: ProviderCardExtrasOwnerProps; render: ProviderCardRenderer }) {
  return render(owner);
}
/** Invoke inside the boundary so a failing extension cannot remove native controls. */
export function ProviderCardExtension({ owner, render }: { owner?: ProviderCardExtrasOwnerProps; render?: ProviderCardRenderer }) {
  if (!owner || !render) return null;
  return <div data-model-provider-extension={owner.provider.provider} className="empty:hidden">
    <WorkbenchViewBoundary fallback={null} resetKey={render}>
      <ProviderCardContent owner={owner} render={render} />
    </WorkbenchViewBoundary>
  </div>;
}
export function ModelsFooterExtension({ children }: { children?: ReactNode }) {
  return children ? <div data-model-settings-footer className="empty:hidden">
    <WorkbenchViewBoundary fallback={null} resetKey={children}>{children}</WorkbenchViewBoundary>
  </div> : null;
}
