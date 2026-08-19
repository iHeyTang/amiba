/**
 * The runtime reports the webhook inbound endpoint as a server-relative
 * path — only the host knows which authority serves it. In the official
 * Web Shell that is the page origin itself; the desktop renderer runs
 * under the app origin and instead publishes the managed runtime
 * authority through the `data-amiba-dsh-base-url` DOM side-channel — the
 * one remaining data-amiba-dsh-* attribute (the former slot-marker family
 * was replaced by official renderSlot render props).
 */
export function absoluteInboundEndpoint(endpoint: string): string {
  if (!endpoint.startsWith("/")) return endpoint;
  const base =
    document.documentElement.getAttribute("data-amiba-dsh-base-url") ??
    window.location.origin;
  return new URL(endpoint, `${base}/`).toString();
}
