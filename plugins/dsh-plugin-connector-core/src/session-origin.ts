export interface ExternalSessionInfo {
  id: string;
  connectorName: string;
  createdAt: number;
}

/** Only the initiating message owns the conversation, never a later relay. */
export function externalSessionChannel(events: readonly { type: string; data?: unknown }[]): string | null | undefined {
  const first = events.find(event => event.type === "user/message");
  if (!first) return undefined;
  const source = (first.data as { source?: { kind?: string; plugin?: string } } | undefined)?.source;
  const prefix = "amiba-message:";
  return source?.kind === "plugin" && source.plugin?.startsWith(prefix)
    ? source.plugin.slice(prefix.length) || null
    : null;
}
