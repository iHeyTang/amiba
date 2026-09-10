/** The first user message identifies who started the session, not later followups. */
export function cronSessionOrigin(events: readonly { type: string; data?: unknown }[]): boolean | undefined {
  const first = events.find((event) => event.type === "user/message");
  if (!first) return undefined;
  const message = first.data as { source?: { kind?: string; rpcId?: string } } | undefined;
  return message?.source?.kind === "user"
    && typeof message.source.rpcId === "string"
    && /^cron:cron_[a-z0-9]+:[0-9a-f-]+$/u.test(message.source.rpcId);
}
