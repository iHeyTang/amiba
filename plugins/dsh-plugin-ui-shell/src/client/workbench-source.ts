import type {
  WorkbenchShellExtension,
  WorkbenchViewExtension,
} from "@amiba/extension-sdk";
import {
  createSlotContributionsSource,
  type SlotContributionsCtx,
} from "./session-list-sources.js";
export function createWorkbenchSource(ctx: SlotContributionsCtx) {
  return createSlotContributionsSource<WorkbenchViewExtension>(
    ctx,
    "amiba.workbench.view",
    (entry, face) => {
      const extension = face?.extension as WorkbenchViewExtension | undefined;
      if (
        !extension ||
        !extension.id ||
        !extension.resourceType ||
        (typeof extension.component !== "function" &&
          (typeof extension.component !== "object" ||
            extension.component === null))
      )
        return null;
      return {
        ...extension,
        order: entry.options.order ?? extension.order ?? 0,
      };
    },
  );
}

export function createWorkbenchShellSource(ctx: SlotContributionsCtx) {
  return createSlotContributionsSource<WorkbenchShellExtension>(
    ctx,
    "amiba.workbench.shell",
    (entry, face) => {
      const extension = face?.extension as WorkbenchShellExtension | undefined;
      return extension?.id && extension.component && extension.toggle
        ? { ...extension, order: entry.options.order ?? extension.order ?? 0 }
        : null;
    },
  );
}
