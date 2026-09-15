import { Component, createContext, useContext, type ReactNode } from "react";
import type {
  WorkbenchViewExtension,
  WorkbenchViewProps,
} from "@amiba/extension-sdk";
import { useT } from "@amiba/i18n";
const Extensions = createContext<readonly WorkbenchViewExtension[]>([]);
export function WorkbenchExtensionsProvider({
  extensions,
  children,
}: {
  extensions: readonly WorkbenchViewExtension[];
  children: ReactNode;
}) {
  return (
    <Extensions.Provider value={extensions}>{children}</Extensions.Provider>
  );
}
export function useWorkbenchExtensions() {
  return useContext(Extensions);
}
export function selectWorkbenchView(
  extensions: readonly WorkbenchViewExtension[],
  type: string,
) {
  return extensions
    .filter((extension) => extension.resourceType === type)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
}
export class WorkbenchViewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: unknown },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: Readonly<{ resetKey?: unknown }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function WorkbenchResourceView(props: WorkbenchViewProps) {
  const { t } = useT();
  const extension = selectWorkbenchView(
    useWorkbenchExtensions(),
    props.resource.type,
  );
  const fallback = (
    <div
      role="status"
      className="flex h-full items-center justify-center px-8 text-center text-xs text-muted-foreground"
    >
      {t("workspacePane.viewUnavailable")}
    </div>
  );
  if (!extension) return fallback;
  const View = extension.component;
  return (
    <WorkbenchViewBoundary
      key={JSON.stringify([
        props.sessionId,
        extension.instanceKey ?? [
          props.resource.type,
          props.resource.id,
          extension.id,
        ],
      ])}
      resetKey={JSON.stringify([
        extension.id,
        props.resource.type,
        props.resource.id,
      ])}
      fallback={fallback}
    >
      <View {...props} />
    </WorkbenchViewBoundary>
  );
}

/** Elect once per resource type so replaced plugins cannot retain hidden surfaces. */
export function selectedWorkbenchViews(
  extensions: readonly WorkbenchViewExtension[],
) {
  return [...new Set(extensions.map((extension) => extension.resourceType))]
    .sort()
    .map((type) => selectWorkbenchView(extensions, type)!);
}

export function WorkbenchExtensionHosts({ children }: { children: ReactNode }) {
  const extensions = selectedWorkbenchViews(useWorkbenchExtensions());
  return (
    <>
      {children}
      {extensions.map((extension) => {
        const Host = extension.host;
        return Host ? <Host key={extension.id} /> : null;
      })}
    </>
  );
}

export function WorkbenchExtensionToolbar() {
  return (
    <>
      {selectedWorkbenchViews(useWorkbenchExtensions()).map((extension) => {
        const Toolbar = extension.toolbar;
        return Toolbar ? <Toolbar key={extension.id} /> : null;
      })}
    </>
  );
}
