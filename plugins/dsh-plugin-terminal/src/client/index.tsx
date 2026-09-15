import type { Context } from "@deepseek-ai/cordis";
import type {
  WorkbenchViewExtension,
  WorkbenchViewProps,
} from "@amiba/extension-sdk";
import { useCallback, useLayoutEffect } from "react";
import { Terminal } from "lucide-react";
import { useWorkspacePane } from "@amiba/dsh-plugin-ui-shell/client";
import { WorkspaceTerminalView } from "./TerminalView.js";
import type { WorkspaceDevelopmentAdapter } from "@amiba/app-runtime/platform";
import css from "@xterm/xterm/css/xterm.css?inline";
import styleCss from "./style.css?inline";
export const name = "amiba-terminal-ui";
export const inject = ["slots"];
const label = () =>
  document.documentElement.lang.startsWith("zh") ? "打开终端" : "Open terminal";
function TerminalView({ resource, sessionId }: WorkbenchViewProps) {
  const pane = useWorkspacePane();
  const onSnapshot = useCallback(() => {}, []);
  if (!pane.development)
    return (
      <p role="status">
        {document.documentElement.lang.startsWith("zh")
          ? "终端暂不可用。"
          : "Terminal unavailable."}
      </p>
    );
  return (
    <WorkspaceTerminalView
      sessionId={sessionId}
      terminalId={resource.id}
      development={pane.development}
      onSnapshot={onSnapshot}
    />
  );
}
export function createTerminalView(): WorkbenchViewExtension {
  let development: WorkspaceDevelopmentAdapter | undefined;
  return {
    id: "amiba.terminal",
    resourceType: "terminal",
    order: 110,
    component: TerminalView,
    tabIcon: Terminal,
    host: function TerminalHost() {
      const pane = useWorkspacePane();
      useLayoutEffect(() => {
        development = pane.development;
      }, [pane.development]);
      return null;
    },
    onClose: async (resource, sessionId) => {
      if (!development) return;
      await development.terminalStop(sessionId, resource.id);
    },
    launcher: {
      label,
      icon: Terminal,
      createResource: () => ({
        type: "terminal",
        id: crypto.randomUUID(),
        title: document.documentElement.lang.startsWith("zh")
          ? "终端"
          : "Terminal",
      }),
    },
  };
}
export function apply(ctx: Context) {
  const terminalView = createTerminalView();
  const style = document.createElement("style");
  style.dataset.pluginCss = "amiba-terminal";
  style.textContent = css + styleCss;
  document.head.append(style);
  ctx.effect(() => () => style.remove(), "terminal: styles");
  return ctx.slots.inject("amiba.workbench.view", () =>
    ctx.slots.register(
      {
        name: "amiba.workbench.view",
        id: terminalView.id,
        order: terminalView.order,
        inject: () => ({ extension: terminalView }),
      },
      () => null,
    ),
  );
}
