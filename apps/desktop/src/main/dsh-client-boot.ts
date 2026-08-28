export interface DshWebBootEntry {
  id: string;
  url: string;
  rev: string;
  inject?: string[];
  immediately?: boolean;
}

export interface DshWebBootGraph {
  rev: string;
  entries: DshWebBootEntry[];
}

export interface DshClientBootPayload {
  baseUrl: string;
  graph: DshWebBootGraph;
  shell: {
    /**
     * Inline head scripts the Web Shell needs run before its module entry.
     *
     * DSH 0.1.0's frontend bundle INSTALLED `window.__ModuleLoader__` itself;
     * 0.1.1 inverted that — the facade now ships as an inline bootstrap script
     * in the document head and the frontend only consumes it, failing with
     * "bootstrap facade is missing" when it is absent. The desktop renderer
     * builds the document itself, so it has to carry these across too.
     */
    bootstrap: string[];
    scripts: string[];
    styles: string[];
  };
}

export interface DshProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface DshProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface DshRuntimeSource {
  ensureStarted(): Promise<{ baseUrl: string }>;
}

const BOOT_SCRIPT_PATTERN =
  // DSH's webserver renders the boot payload from an index-injection row, and
  // how it SPELLS the assignment is upstream's business: 0.1.0 emitted
  // `window.__DSH_BOOT__ =`, 0.1.1 emits `globalThis["__DSH_BOOT__"] =`.
  // Match either, and keep pinning the only part that is our contract — the
  // payload is published under the name `__DSH_BOOT__`.
  /<script>(?:window\.__DSH_BOOT__|globalThis\[\s*["']__DSH_BOOT__["']\s*\])\s*=\s*([\s\S]*?)<\/script>/u;
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)><\/script>/gu;
/** Inline (src-less) script elements, with their body. */
const INLINE_SCRIPT_PATTERN =
  /<script\b(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gu;
const LINK_TAG_PATTERN = /<link\b([^>]*)>/gu;

function attribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "iu",
  );
  const match = pattern.exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function shellAssetUrl(value: string, baseUrl: URL): string {
  const target = new URL(value, baseUrl);
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith("/assets/")) {
    throw new Error("DSH Web Shell advertised an asset outside its runtime origin.");
  }
  return target.href;
}

export function extractDshShellAssets(
  html: string,
  baseUrlValue: string,
): DshClientBootPayload["shell"] {
  const baseUrl = new URL(baseUrlValue);
  const bootstrap: string[] = [];
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    const body = match[2] ?? "";
    // The boot graph is published as an inline global too, but the renderer
    // already installs it from the parsed payload — re-running it would just
    // assign the same value from unparsed text.
    if (!body.trim() || BOOT_SCRIPT_PATTERN.test(`<script>${body}</script>`)) {
      continue;
    }
    bootstrap.push(body);
  }
  for (const match of html.matchAll(SCRIPT_TAG_PATTERN)) {
    const attributes = match[1] ?? "";
    const src = attribute(attributes, "src");
    if (!src || attribute(attributes, "type")?.toLowerCase() !== "module") {
      continue;
    }
    scripts.push(shellAssetUrl(src, baseUrl));
  }
  for (const match of html.matchAll(LINK_TAG_PATTERN)) {
    const attributes = match[1] ?? "";
    const href = attribute(attributes, "href");
    const rel = attribute(attributes, "rel")?.toLowerCase().split(/\s+/u);
    if (!href || !rel?.includes("stylesheet")) continue;
    styles.push(shellAssetUrl(href, baseUrl));
  }
  if (scripts.length === 0) {
    throw new Error("Managed DSH Web Shell did not publish a module entry.");
  }
  return { bootstrap, scripts, styles };
}

function parseEntry(value: unknown, baseUrl: URL): DshWebBootEntry {
  if (!value || typeof value !== "object") {
    throw new Error("DSH client graph contains a non-object entry.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.url !== "string" ||
    typeof row.rev !== "string"
  ) {
    throw new Error("DSH client graph entry must contain string id/url/rev.");
  }
  if (
    row.inject !== undefined &&
    (!Array.isArray(row.inject) ||
      row.inject.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`DSH client graph entry ${row.id} has invalid inject edges.`);
  }
  if (
    row.immediately !== undefined &&
    typeof row.immediately !== "boolean"
  ) {
    throw new Error(
      `DSH client graph entry ${row.id} has invalid immediately flag.`,
    );
  }

  const bundleUrl = new URL(row.url, baseUrl);
  if (bundleUrl.origin !== baseUrl.origin) {
    throw new Error(
      `DSH client graph entry ${row.id} escaped its runtime origin.`,
    );
  }
  if (!bundleUrl.pathname.startsWith("/plugins/")) {
    throw new Error(
      `DSH client graph entry ${row.id} does not use the plugin route.`,
    );
  }

  return {
    id: row.id,
    url: bundleUrl.href,
    rev: row.rev,
    ...(row.inject === undefined
      ? {}
      : { inject: [...(row.inject as string[])] }),
    ...(row.immediately === undefined
      ? {}
      : { immediately: row.immediately }),
  };
}

/** Parse the graph DSH itself injected into its Web Shell document. */
export function extractDshClientBootGraph(
  html: string,
  baseUrlValue: string,
): DshWebBootGraph {
  const baseUrl = new URL(baseUrlValue);
  if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1") {
    throw new Error("The managed DSH client origin must be IPv4 loopback HTTP.");
  }
  const match = BOOT_SCRIPT_PATTERN.exec(html);
  if (!match?.[1]) {
    throw new Error("Managed DSH Web Shell did not publish __DSH_BOOT__.");
  }
  const value = JSON.parse(match[1]) as unknown;
  if (!value || typeof value !== "object") {
    throw new Error("Managed DSH published an invalid client graph.");
  }
  const graph = value as Record<string, unknown>;
  if (typeof graph.rev !== "string" || !Array.isArray(graph.entries)) {
    throw new Error("Managed DSH client graph is missing rev/entries.");
  }
  return {
    rev: graph.rev,
    entries: graph.entries.map((entry) => parseEntry(entry, baseUrl)),
  };
}

/** Start DSH and return its own client composition to the Electron renderer. */
export async function loadDshClientBoot(
  runtime: DshRuntimeSource,
): Promise<DshClientBootPayload> {
  const { baseUrl } = await runtime.ensureStarted();
  const response = await fetch(new URL("/", baseUrl), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`DSH Web Shell returned HTTP ${response.status}.`);
  }
  const html = await response.text();
  return {
    baseUrl,
    graph: extractDshClientBootGraph(html, baseUrl),
    shell: extractDshShellAssets(html, baseUrl),
  };
}

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "if-none-match",
  "range",
]);

/**
 * Electron's file/dev origin is deliberately not a DSH trusted web origin.
 * Forward official Client Runtime unary requests through main without
 * weakening DSH's Host/Origin fence.
 */
export async function proxyDshClientFetch(
  runtime: DshRuntimeSource,
  request: DshProxyRequest,
): Promise<DshProxyResponse> {
  const { baseUrl } = await runtime.ensureStarted();
  const runtimeOrigin = new URL(baseUrl).origin;
  const target = new URL(request.url, runtimeOrigin);
  if (target.origin !== runtimeOrigin || !target.pathname.startsWith("/api")) {
    throw new Error("DSH client proxy refused a non-runtime API URL.");
  }
  const method = request.method.toUpperCase();
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  const response = await fetch(target, {
    method,
    headers,
    body:
      method === "GET" || method === "HEAD" || request.body === undefined
        ? undefined
        : request.body,
    signal: AbortSignal.timeout(90_000),
  });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = value;
  });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: new Uint8Array(await response.arrayBuffer()),
  };
}
