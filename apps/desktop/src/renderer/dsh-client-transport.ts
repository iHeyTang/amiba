interface DshTransportInstall {
  baseUrl: string;
  dispose(): void;
}

function isDshApiUrl(url: URL, pageOrigin: string, baseUrl: URL): boolean {
  if (!url.pathname.startsWith("/api")) return false;
  if (url.origin === baseUrl.origin) return true;
  if (url.hostname === "dsh.internal") return true;
  return pageOrigin !== "null" && url.origin === pageOrigin;
}

export function rewriteSocketUrl(
  value: string | URL,
  baseUrl: URL,
  pageOrigin: string,
): string {
  const target = new URL(String(value));
  const isInternal = target.hostname === "dsh.internal";
  // WebSocket URLs carry ws:/wss: schemes, so `target.origin` can never
  // equal the page's http(s) origin directly — map the scheme back to
  // http(s) before comparing, or the dev-server case silently escapes the
  // rewrite and the socket hangs in CONNECTING against the wrong server.
  const httpMapped = new URL(target.href);
  httpMapped.protocol =
    target.protocol === "wss:"
      ? "https:"
      : target.protocol === "ws:"
        ? "http:"
        : target.protocol;
  const isPageApi =
    target.pathname.startsWith("/api") &&
    pageOrigin !== "null" &&
    httpMapped.origin === pageOrigin;
  if (!isInternal && !isPageApi) return target.href;
  const next = new URL(target.pathname + target.search, baseUrl);
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:";
  return next.href;
}

function rewriteEventSourceUrl(value: string | URL, baseUrl: URL): string {
  const target = new URL(String(value), window.location.href);
  if (target.pathname !== "/plugins/events") return target.href;
  if (
    target.origin !== baseUrl.origin &&
    target.hostname !== "dsh.internal" &&
    target.protocol !== "file:"
  ) {
    return target.href;
  }
  return new URL(target.pathname + target.search, baseUrl).href;
}

/**
 * Adapt the official same-origin DSH browser transport to Electron's isolated
 * renderer. Plugin bundles still arrive through DSH's normal script loader;
 * unary API calls cross the preload boundary and WebSockets go directly to
 * the exact managed loopback authority.
 */
export function installDshClientTransport(baseUrlValue: string): DshTransportInstall {
  const baseUrl = new URL(baseUrlValue);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const NativeWebSocket = globalThis.WebSocket;
  const NativeEventSource = globalThis.EventSource;
  const pageOrigin = window.location.origin;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!isDshApiUrl(url, pageOrigin, baseUrl)) {
      return nativeFetch(request);
    }
    if (request.signal.aborted) throw request.signal.reason;
    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : new Uint8Array(await request.arrayBuffer());
    const response = await window.amiba.dshClient.fetch({
      url: new URL(url.pathname + url.search, baseUrl).href,
      method,
      headers: Object.fromEntries(request.headers.entries()),
      ...(body === undefined ? {} : { body }),
    });
    if (request.signal.aborted) throw request.signal.reason;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  class ElectronDshWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const rewritten = rewriteSocketUrl(url, baseUrl, pageOrigin);
      if (protocols === undefined) super(rewritten);
      else super(rewritten, protocols);
    }
  }
  globalThis.WebSocket = ElectronDshWebSocket;

  class ElectronDshEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super(rewriteEventSourceUrl(url, baseUrl), eventSourceInitDict);
    }
  }
  globalThis.EventSource = ElectronDshEventSource;

  return {
    baseUrl: baseUrl.origin,
    dispose() {
      globalThis.fetch = nativeFetch;
      globalThis.WebSocket = NativeWebSocket;
      globalThis.EventSource = NativeEventSource;
    },
  };
}
