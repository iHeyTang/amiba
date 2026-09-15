import { expect, it, vi } from "vitest";
import { apply } from "./index.js";
vi.mock("@amiba/dsh-plugin-ui-shell/client", () => ({
  WorkspacePane: () => null,
  WorkspacePaneToggle: () => null,
  builtinWorkbenchViews: [{ id: "code", resourceType: "code", order: 100, component: () => null }],
}));
it("installs the framework and removes its contributions without registering concrete launchers", () => {
  const entries = new Map<string, any>();
  const dispose = apply({ slots: {
    inject: (_name: string, setup: () => () => void) => setup(),
    register: (entry: any) => { entries.set(entry.id, entry); return () => entries.delete(entry.id); },
  } } as any);
  expect(entries.get("amiba.workbench").name).toBe("amiba.workbench.shell");
  expect(entries.get("amiba.workbench").inject().extension.toggle).toBeTypeOf("function");
  expect([...entries.values()].some(entry => entry.inject().extension.launcher)).toBe(false);
  dispose();
  expect(entries.size).toBe(0);
});
