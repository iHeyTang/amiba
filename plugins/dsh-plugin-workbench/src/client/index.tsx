import type { Context } from "@deepseek-ai/cordis";
import type { WorkbenchShellExtension } from "@amiba/extension-sdk";
import {
  WorkspacePane,
  WorkspacePaneToggle,
  builtinWorkbenchViews,
} from "@amiba/dsh-plugin-ui-shell/client";
export const name = "amiba-workbench-ui";
export const inject = ["slots"];
export function apply(ctx: Context) {
  const shell: WorkbenchShellExtension = {
    id: "amiba.workbench",
    order: 100,
    component: WorkspacePane,
    toggle: () => <WorkspacePaneToggle showUnavailable />,
  };
  const disposers = [
    ctx.slots.inject("amiba.workbench.shell", () =>
      ctx.slots.register(
        {
          name: "amiba.workbench.shell",
          id: shell.id,
          order: shell.order,
          inject: () => ({ extension: shell }),
        },
        () => null,
      ),
    ),
    ...builtinWorkbenchViews.map((extension) =>
      ctx.slots.inject("amiba.workbench.view", () =>
        ctx.slots.register(
          {
            name: "amiba.workbench.view",
            id: extension.id,
            order: extension.order,
            inject: () => ({ extension }),
          },
          () => null,
        ),
      ),
    ),
  ];
  return () => disposers.reverse().forEach((dispose) => dispose());
}
