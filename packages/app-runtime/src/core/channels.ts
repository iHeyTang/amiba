/**
 * Minimal session-origin metadata owned by the host UI.
 *
 * Transport-specific providers and channel configuration live in the DSH
 * messaging-core plugin. Core intentionally does not enumerate Feishu,
 * Slack, webhooks, or any other transport: adding one is a plugin operation,
 * not a host release.
 */

export const SOURCE_LOCAL = "local";

export interface ChannelDescriptor {
  id: string;
  labelKey: string;
  fallbackLabel: string;
}

const LOCAL_CHANNEL: ChannelDescriptor = {
  id: SOURCE_LOCAL,
  labelKey: "channels.local",
  fallbackLabel: "Local",
};

export const UNKNOWN_CHANNEL: ChannelDescriptor = {
  id: "__unknown__",
  labelKey: "channels.unknown",
  fallbackLabel: "Plugin",
};

/**
 * Resolve a source label without embedding a transport registry in core.
 * Plugin-origin ids remain visible as their raw stable id until a plugin UI
 * supplies richer presentation metadata.
 */
export function resolveChannel(
  source: string | null | undefined,
): ChannelDescriptor {
  if (!source || source === SOURCE_LOCAL) return LOCAL_CHANNEL;
  return {
    ...UNKNOWN_CHANNEL,
    id: source,
    fallbackLabel: source,
  };
}
