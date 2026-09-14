/** Render durable sync envelopes, including ones queued before card support. */
export function desktopSyncCard(text: string, author: "user" | "assistant") {
  const role = author === "user" ? "用户" : "助手";
  // The shared outbox keeps a readable prefix for text-only transports.
  // Remove exactly one generated prefix; never strip matching body content.
  const prefix = `${role} · 来自桌面端\n\n`;
  const content = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return {
    schema: "2.0",
    header: {
      title: {
        tag: "plain_text",
        content: `💻 桌面同步 · ${author === "user" ? "用户消息" : "助手回复"}`,
      },
      template: author === "user" ? "grey" : "blue",
    },
    body: {
      elements: [
        author === "user"
          ? { tag: "div", text: { tag: "plain_text", content } }
          : { tag: "markdown", content },
      ],
    },
  };
}
