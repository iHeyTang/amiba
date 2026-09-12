import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import { LarkSharedResources } from "../LarkSharedResources.js";
vi.mock("@amiba/ui/plugin", () => ({
 usePluginT: (catalog: { en: Record<string,string> }) => ({ t: (key: string) => catalog.en[key] ?? key }),
 Button: ({ variant, size, children, ...props }: any) => <button {...props}>{children}</button>,
 Input: (props: any) => <input {...props} />,
}));
afterEach(cleanup);
const resource = { reference: "opaque-private-ref", title: "Project notes" };
const view = { access: "shared" as const, policy: { cadence: "daily" as const, timeZone: "Asia/Shanghai" }, pendingNewConversation: false, history: [], sharedResources: [resource] };
function fixture() {
 const searchResources = vi.fn(async () => ({ items: [resource], unavailable: false }));
 const shareResources = vi.fn(async () => view);
 const management = { items: [], manage: vi.fn(), refresh: vi.fn(), searchResources, shareResources } as NonNullable<ConnectSettingsHost["conversations"]>;
 return { management, searchResources, shareResources, saved: vi.fn() };
}
it("searches without granting access, then saves explicit choices to the current chat", async () => {
 const f = fixture();
 render(<LarkSharedResources management={f.management} chatKey="group-one" grants={[]} saved={f.saved} />);
 expect(f.searchResources).not.toHaveBeenCalled(); expect(f.shareResources).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole("textbox"), { target: { value: "Project" } });
 fireEvent.click(screen.getByRole("button", { name: "Search" }));
 const checkbox = await screen.findByRole("checkbox", { name: "Project notes" });
 expect(f.searchResources).toHaveBeenCalledWith("group-one", "Project");
 expect(f.shareResources).not.toHaveBeenCalled();
 expect(screen.queryByText("opaque-private-ref")).not.toBeInTheDocument();
 fireEvent.click(checkbox);
 fireEvent.click(screen.getByRole("button", { name: "Save shared resources" }));
 await screen.findByText("Shared resources updated.");
 expect(f.shareResources).toHaveBeenCalledWith("group-one", [resource.reference]);
 expect(f.saved).toHaveBeenCalledWith(view);
});
it("revokes an existing grant without needing a resource search", async () => {
 const f = fixture();
 render(<LarkSharedResources management={f.management} chatKey="group-two" grants={[resource]} saved={f.saved} />);
 fireEvent.click(screen.getByRole("checkbox", { name: "Project notes" }));
 fireEvent.click(screen.getByRole("button", { name: "Save shared resources" }));
 await waitFor(() => expect(f.shareResources).toHaveBeenCalledWith("group-two", []));
 expect(f.searchResources).not.toHaveBeenCalled();
});
it("retains the editable selection when saving fails and does not report success", async () => {
 const f = fixture(); f.shareResources.mockRejectedValueOnce(new Error("offline"));
 render(<LarkSharedResources management={f.management} chatKey="group" grants={[resource]} saved={f.saved} />);
 fireEvent.click(screen.getByRole("checkbox", { name: "Project notes" }));
 fireEvent.click(screen.getByRole("button", { name: "Save shared resources" }));
 await screen.findByRole("alert");
 expect(f.saved).not.toHaveBeenCalled();
 expect(screen.queryByText("Shared resources updated.")).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Save shared resources" })).not.toBeDisabled();
});
