import type { Context } from "@deepseek-ai/cordis";
import type { McpAccessView } from "@amiba/dsh-plugin-mcp-manager";
export type ConnectionWorkState = "ready" | "pending" | "unavailable";
export interface ConnectionWorkAccess {
  list(): Promise<McpAccessView[]>;
  approve(
    id: string,
    connectionId: string,
    approvalToken: string,
  ): Promise<unknown>;
  retry(id: string): Promise<unknown>;
}
const matches = (
  value: { ownerId: string; recordId: string } | undefined,
  id: string,
) => value?.ownerId === "connector-core" && value.recordId === id;
const owned = (rows: McpAccessView[], id: string) =>
  rows.filter(
    (row) =>
      row.audience === "ordinary-agents" &&
      (matches(row.configuration, id) ||
        row.connections.some((c) => matches(c.configuration, id))),
  );
export async function inspectConnectionWork(
  access: ConnectionWorkAccess | undefined,
  id: string,
): Promise<ConnectionWorkState> {
  if (!access) return "unavailable";
  const rows = owned(await access.list(), id);
  if (!rows.length) return "unavailable";
  if (
    rows.every((row) => matches(row.configuration, id) && row.state === "ready")
  )
    return "ready";
  return rows.some(
    (row) =>
      row.state === "error" ||
      row.state === "inactive" ||
      row.state === "approval-required",
  )
    ? "unavailable"
    : "pending";
}
/** Called only by an explicit complete-connection action. Other plugins and
 * accounts never inherit this approval. Tokens bind the exact current tool set. */
export async function activateConnectionWork(
  access: ConnectionWorkAccess | undefined,
  id: string,
  signal: AbortSignal,
): Promise<ConnectionWorkState> {
  if (!access) throw new Error("connection_tools_unavailable");
  const rows = owned(await access.list(), id);
  if (!rows.length) throw new Error("connection_tools_unavailable");
  for (const row of rows) {
    signal.throwIfAborted();
    const connection = row.connections.find((c) =>
      matches(c.configuration, id),
    );
    if (!connection) throw new Error("connection_tools_unavailable");
    if (row.state === "approval-required" || !matches(row.configuration, id))
      await access.approve(row.id, connection.id, connection.approvalToken);
    else if (row.state === "error") await access.retry(row.id);
  }
  signal.throwIfAborted();
  return inspectConnectionWork(access, id);
}
export function connectionWorkAccess(
  ctx: Context,
): ConnectionWorkAccess | undefined {
  return ctx.reflect.get("amibaMcpManager")?.access;
}
