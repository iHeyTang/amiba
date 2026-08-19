import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`[dsh-architecture] ${message}`);
}

async function text(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function json(relative) {
  return JSON.parse(await text(relative));
}

async function exists(relative) {
  return stat(path.join(root, relative)).then(
    () => true,
    () => false,
  );
}

function pluginPattern(packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`name:\\s*["']${escaped}["']`, "gu");
}

async function sourceFiles(relative) {
  const directory = path.join(root, relative);
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name))
        files.push(target);
    }
  }
  await visit(directory);
  return files;
}

const bundleSpecs = [
  {
    directory: "dsh-bundle-amiba-core",
    name: "@amiba/dsh-bundle-amiba-core",
    plugins: [
      "@amiba/dsh-plugin-attachments",
      "@amiba/dsh-plugin-browser-core",
      "@amiba/dsh-plugin-browser-provider-cdp",
      "@amiba/dsh-plugin-catalog",
      "@amiba/dsh-plugin-commands-adapter",
      "@amiba/dsh-plugin-mcp-manager",
      "@amiba/dsh-plugin-memory",
      "@amiba/dsh-plugin-messaging-core",
      "@amiba/dsh-plugin-model-plane",
      "@amiba/dsh-plugin-notification-hub",
      "@amiba/dsh-plugin-schedule-adapter",
      "@amiba/dsh-plugin-skills",
      "@amiba/dsh-plugin-usage",
    ],
  },
  {
    directory: "dsh-bundle-amiba-web",
    name: "@amiba/dsh-bundle-amiba-web",
    plugins: [
      "@amiba/dsh-plugin-agent-preset",
      "@amiba/dsh-plugin-messaging-channel-webhook",
      "@amiba/dsh-plugin-runtime-inventory",
      "@amiba/dsh-plugin-ui-shell",
    ],
  },
  {
    directory: "dsh-bundle-amiba-desktop",
    name: "@amiba/dsh-bundle-amiba-desktop",
    plugins: [
      "@amiba/dsh-plugin-browser-provider-electron",
      "@amiba/dsh-plugin-runtime-gateway",
    ],
  },
];

for (const entry of await readdir(path.join(root, "packages"), {
  withFileTypes: true,
})) {
  if (
    entry.isDirectory() &&
    /^(?:dsh-plugin-|dsh-bundle-)/u.test(entry.name)
  ) {
    fail(
      `DSH project ${entry.name} must live under plugins/ or bundles/, not packages/`,
    );
  }
}

const patches = [];
for (const spec of bundleSpecs) {
  const manifest = await json(`bundles/${spec.directory}/package.json`);
  if (manifest.name !== spec.name) fail(`${spec.directory} has the wrong name`);
  if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    fail(`${spec.name} must use the official dsh.bundle.patch contract`);
  }
  const actual = Object.keys(manifest.dependencies ?? {})
    .filter((name) => name.startsWith("@amiba/dsh-plugin-"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...spec.plugins].sort())) {
    fail(`${spec.name} plugin set differs from its declared surface: ${actual.join(", ")}`);
  }
  patches.push(await text(`bundles/${spec.directory}/cordis.patch.yml`));
}
const patch = patches.join("\n");
const pluginPackages = [...new Set(bundleSpecs.flatMap((spec) => spec.plugins))].sort();
for (const packageName of pluginPackages) {
  const project = `plugins/${packageName.slice("@amiba/".length)}`;
  const manifest = await json(`${project}/package.json`);
  if (manifest.name !== packageName)
    fail(`${project} has the wrong package name`);
  // Without this subpath, Node exports encapsulation blocks the DSH client
  // loader's manifest read and the plugin's Client half is SILENTLY skipped
  // (runtime half keeps running) — bitten once by dsh-plugin-model-plane.
  if (
    manifest.dsh?.client &&
    manifest.exports &&
    manifest.exports["./package.json"] !== "./package.json"
  ) {
    fail(
      `${packageName} declares dsh.client but does not export ./package.json`,
    );
  }
  if (!(await exists(`${project}/README.md`)))
    fail(`${project} needs its own README.md`);
  if (!(await exists(`${project}/src/index.ts`)))
    fail(`${project} needs src/index.ts`);
  const entry = await text(`${project}/src/index.ts`);
  if (!/export const name\s*=/u.test(entry))
    fail(`${packageName} has no named Cordis plugin export`);
  if (/export\s+default\b/u.test(entry))
    fail(`${packageName} must not use a default plugin export`);
  const occurrences = [...patch.matchAll(pluginPattern(packageName))].length;
  if (occurrences !== 1)
    fail(`${packageName} must occur exactly once across the Amiba bundles`);
  for (const file of await sourceFiles(`${project}/src`)) {
    const body = await readFile(file, "utf8");
    for (const match of body.matchAll(/(?:webServer|server)\.register\(/gu)) {
      const beforeRegistration = body.slice(
        Math.max(0, (match.index ?? 0) - 200),
        match.index,
      );
      if (!beforeRegistration.includes("ctx.effect(")) {
        fail(
          `HTTP registration is not bound to a Cordis effect in ${path.relative(root, file)}`,
        );
      }
    }
  }
}

// Feature plugin clients must not reach the host platform adapter — domain
// data flows through each plugin's own DSH Remote. The sole exception is
// mechanism-level ENVIRONMENT facts, member-allowlisted here: window-chrome
// geometry and the UI-preference storage mechanism. This sweep covers every
// file of every dsh.client plugin's client directory (the old per-file
// substring checks let a helper in a sibling file slip through unscanned).
// dsh-plugin-ui-shell is exempt: it IS the shell boot and owns setPlatform.
const PLUGIN_CLIENT_PLATFORM_ALLOWLIST = new Set([
  "kind",
  "windowChrome",
  "storage",
]);
for (const packageName of pluginPackages) {
  if (packageName === "@amiba/dsh-plugin-ui-shell") continue;
  const clientDir = `plugins/${packageName.slice("@amiba/".length)}/src/client`;
  if (!(await exists(clientDir))) continue;
  for (const file of await sourceFiles(clientDir)) {
    const body = await readFile(file, "utf8");
    const rel = path.relative(root, file);
    if (body.includes("ipc")) {
      fail(`${rel} must not route UI through Electron IPC`);
    }
    const memberless = body
      .replace(/getPlatform\(\)\s*\.\s*(\w+)/gu, (whole, member) => {
        if (!PLUGIN_CLIENT_PLATFORM_ALLOWLIST.has(member)) {
          fail(
            `${rel} reads getPlatform().${member} — feature plugin clients ` +
              `may only read mechanism facts (${[...PLUGIN_CLIENT_PLATFORM_ALLOWLIST].join(", ")}); ` +
              `domain data must ride the plugin's own DSH Remote`,
          );
        }
        return "";
      })
      .includes("getPlatform(");
    if (memberless) {
      fail(
        `${rel} uses getPlatform without an allowlisted member access — ` +
          `not permitted in feature plugin clients`,
      );
    }
  }
}

const corePatch = patches[0];
for (const desktopOrWebOnly of [
  "@amiba/dsh-plugin-browser-provider-electron",
  "@amiba/dsh-plugin-runtime-gateway",
  "@amiba/dsh-plugin-messaging-channel-webhook",
  "@amiba/dsh-plugin-runtime-inventory",
  "@amiba/dsh-plugin-ui-shell",
  "@amiba/dsh-plugin-agent-preset",
]) {
  if (corePatch.includes(desktopOrWebOnly)) {
    fail(`Core bundle contains surface-only plugin ${desktopOrWebOnly}`);
  }
}
for (const packageName of bundleSpecs[0].plugins) {
  const entry = await text(
    `plugins/${packageName.slice("@amiba/".length)}/src/index.ts`,
  );
  if (/export const inject\s*=\s*\[[^\]]*["']webServer["']/su.test(entry)) {
    fail(`${packageName} makes the Amiba Core depend on WebServer`);
  }
  if (/from\s+["']electron["']/u.test(entry)) {
    fail(`${packageName} makes the Amiba Core depend on Electron`);
  }
}

function before(left, right) {
  if (patch.search(pluginPattern(left)) >= patch.search(pluginPattern(right))) {
    fail(`${left} must be composed before dependent plugin ${right}`);
  }
}
before("@amiba/dsh-plugin-catalog", "@amiba/dsh-plugin-memory");
before("@amiba/dsh-plugin-catalog", "@amiba/dsh-plugin-attachments");
before("@amiba/dsh-plugin-catalog", "@amiba/dsh-plugin-mcp-manager");
before(
  "@amiba/dsh-plugin-catalog",
  "@amiba/dsh-plugin-browser-core",
);
before(
  "@amiba/dsh-plugin-browser-core",
  "@amiba/dsh-plugin-browser-provider-cdp",
);
before(
  "@amiba/dsh-plugin-browser-core",
  "@amiba/dsh-plugin-browser-provider-electron",
);
before(
  "@amiba/dsh-plugin-runtime-gateway",
  "@amiba/dsh-plugin-browser-provider-electron",
);
before(
  "@amiba/dsh-plugin-messaging-core",
  "@amiba/dsh-plugin-messaging-channel-webhook",
);
// The notification hub composes before its posters (schedule-adapter) and
// before its desktop delivery sink (runtime-gateway).
before(
  "@amiba/dsh-plugin-notification-hub",
  "@amiba/dsh-plugin-schedule-adapter",
);
before(
  "@amiba/dsh-plugin-notification-hub",
  "@amiba/dsh-plugin-runtime-gateway",
);
before(
  "@amiba/dsh-plugin-ui-shell",
  "@amiba/dsh-plugin-agent-preset",
);

const uiShellManifest = await json("plugins/dsh-plugin-ui-shell/package.json");
if (
  JSON.stringify(uiShellManifest.dsh?.client?.inject) !==
  JSON.stringify(["@deepseek-ai/dsh-client-runtime"])
) {
  fail(
    "UI shell client graph must depend only on the official DSH client runtime",
  );
}
const uiShellClient = await text(
  "plugins/dsh-plugin-ui-shell/src/client/index.tsx",
);
const uiShellVite = await text("plugins/dsh-plugin-ui-shell/vite.config.ts");
if (!uiShellVite.includes("inlineDynamicImports: true")) {
  fail(
    "UI shell must be one DSH module-table factory; split CJS chunks cannot be required by the Web shell",
  );
}
if (
  !uiShellClient.includes('import shellCss from "./styles.css?inline"') ||
  !uiShellClient.includes("tag.dataset.plugin = PACKAGE_ID")
) {
  fail(
    "UI shell styles must be inlined as DSH plugin-owned CSS, not delegated to a host page",
  );
}
// amiba.agentPreset.section is intentionally absent from this list: its
// runtime declaration moved to dsh-plugin-agent-preset (a child of that
// plugin's settings-section entry), asserted in the agent-preset block below.
// `settings.section`, `shell.overlay`, and the four conversation.* seats are
// OFFICIAL vocabulary names (declared by @deepseek-ai/dsh-client-ui-settings,
// -ui-layout, and -ui-conversation; types inherited through
// @amiba/extension-sdk) — the root children table must declare them under
// these official names, with the official kind/scope. The former vendor trio
// amiba.settings.navigation.before/assistant/after is retired outright, and
// amiba.chat.header.after retired in favour of
// conversation.session.header.utilities.
for (const slot of [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  "conversation.session.header.utilities",
  "conversation.session.header.actions",
  "amiba.chat.content.overlay",
  "amiba.composer.modelPicker",
  "conversation.input.model",
  "conversation.input.plan",
  "conversation.input.overlay",
  "settings.section",
  "amiba.settings.content.overlay",
  "shell.overlay",
  "tool.call.toolview",
]) {
  if (!uiShellClient.includes(`\"${slot}\"`)) {
    fail(`UI shell is missing semantic child slot ${slot}`);
  }
}
// Adopting an official NAME means adopting its official DECLARATION: a
// divergent kind/scope would hand entries written against the upstream
// contract a seat that behaves differently at runtime.
// Whitespace-insensitive so a prettier reflow cannot break the pin, and
// applied to EVERY adopted conversation seat (an unpinned membership check
// alone is satisfiable by a mention in a comment).
for (const [slot, kind, scope] of [
  ["conversation.session.header.actions", "list", "session"],
  ["conversation.session.header.utilities", "list", "session"],
  ["conversation.input.model", "single", "session"],
  ["conversation.input.plan", "single", "session"],
  // The composer's floating overlay anchor. A divergent scope here would be
  // silently destructive: the official occupants resolve their per-session
  // store from the framework-supplied `sessionId` an inject face only
  // receives on a SESSION-scoped seat, so a `root` declaration would hand
  // them no id at all.
  ["conversation.input.overlay", "list", "session"],
  // The keyed per-tool call row. A divergent kind here would be the worst
  // case of all: entries registered with `key: "<wire tool name>"` against
  // the upstream contract would compile and then never render.
  ["tool.call.toolview", "keyed", "session"],
]) {
  const declaration = new RegExp(
    `"${slot.replace(/\./gu, "\\.")}":\\s*\\{\\s*kind:\\s*"${kind}",\\s*scope:\\s*"${scope}",?\\s*\\}`,
    "u",
  );
  if (!declaration.test(uiShellClient)) {
    fail(`UI shell must declare ${slot} with the official kind/scope`);
  }
}
for (const retired of [
  "amiba.settings.navigation.before",
  "amiba.settings.navigation.assistant",
  "amiba.settings.navigation.after",
  "amiba.settings.section",
  "amiba.shell.overlay",
  "amiba.chat.header.after",
]) {
  if (uiShellClient.includes(`\"${retired}\"`)) {
    fail(`UI shell still declares retired slot name ${retired}`);
  }
}
const productShellSource = await text(
  "plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx",
);
if (
  !uiShellClient.includes('name: "root"') ||
  !uiShellClient.includes('ctx.reflect.provide("layout"') ||
  !uiShellClient.includes('entriesOfSlot("settings.section")') ||
  !uiShellClient.includes("resolveSlotLabel(") ||
  !uiShellClient.includes('kind: "list"') ||
  !uiShellClient.includes("<AmibaProductShell")
) {
  fail(
    "UI shell must own the DSH root, layout service, list-slot ledger projection, and shell construction",
  );
}
// One React tree, official dispatch only: contributions arrive through
// renderSlot-backed render props. The marker/portal side-channel is gone —
// no DOM slot scanning and no portals in the root plugin.
for (const [body, where] of [
  [uiShellClient, "UI shell client"],
  [productShellSource, "product shell"],
]) {
  if (
    body.includes("createPortal") ||
    body.includes("data-amiba-dsh-slot") ||
    body.includes("findSlotTargets") ||
    body.includes("findComposerPickerTargets")
  ) {
    fail(
      `${where} must not resurrect the marker/portal slot side-channel`,
    );
  }
}
// Id-selected list slots dispatch through the official renderSlot `only`
// filter from the product shell — no marker scanning, no keyed registration.
// The composer model picker rides a render prop backed by the same dispatch.
// The settings.section dispatch must pass the OFFICIAL owner contract:
// `close` wired to the shell's leave-Settings path.
for (const dispatch of [
  /renderSlot\(\s*"settings\.section",\s*\{ close:[\s\S]{0,200}?\{ only: sectionId \}/u,
  /renderSlot\(\s*"amiba\.workspace\.view",[\s\S]{0,200}?\{ only: viewId \}/u,
  /renderSlot\(\s*"shell\.overlay"/u,
  /renderSlot\(\s*"conversation\.session\.header\.utilities",\s*\{\}\s*\)/u,
  // Title-adjacent counterpart of the utilities strip; the official owner
  // share is EMPTY, so anything but `{}` here would be a fabricated one.
  /renderSlot\(\s*"conversation\.session\.header\.actions",\s*\{\}\s*\)/u,
  // The composer model chip is seat-split: the official session seat while
  // the composer has a session, the vendor hero seat while drafting.
  /renderSlot\(\s*"conversation\.input\.model",\s*request\.owner\s*\)/u,
  /renderSlot\(\s*"amiba\.composer\.modelPicker",\s*request\.owner\s*\)/u,
  // The plan seat has no vendor counterpart: one dispatch, owner computed
  // by the Composer (the `{ locked }` share asserted below).
  /renderSlot\(\s*"conversation\.input\.plan",\s*owner\s*\)/u,
  // The composer overlay anchor declares NO owner share at all, so `{}` is
  // the faithful dispatch and anything else would be a fabricated owner.
  // This is byte-for-byte the upstream dispatch (ui-conversation's composer
  // entry does `overlay: renderSlot("conversation.input.overlay", {})`).
  /renderSlot\(\s*"conversation\.input\.overlay",\s*\{\}\s*\)/u,
]) {
  if (!dispatch.test(productShellSource)) {
    fail(
      `Product shell must dispatch id-selected slots through renderSlot's official only-filter (${dispatch})`,
    );
  }
}
// The keyed tool-call dispatch. BOTH options are load-bearing and each is
// pinned separately: without `entryKey` no keyed registration can ever match
// (the seat becomes dead), and without `fallback` an unclaimed tool name would
// render NOTHING instead of Amiba's own row — the visual-parity guarantee.
// Whitespace-insensitive so a prettier reflow cannot break the pins.
for (const [dispatch, what] of [
  [
    /renderSlot\(\s*"tool\.call\.toolview",\s*request\.owner,\s*\{[\s\S]{0,200}?\}\s*\)/u,
    "dispatch the official tool.call.toolview seat with the owner share the row computed",
  ],
  [
    /renderSlot\(\s*"tool\.call\.toolview",[\s\S]{0,200}?entryKey:\s*request\.owner\.toolName/u,
    "key that dispatch by the WIRE TOOL NAME (entryKey)",
  ],
  [
    /renderSlot\(\s*"tool\.call\.toolview",[\s\S]{0,200}?fallback:\s*request\.fallback/u,
    "pass Amiba's own tool row as the dispatch fallback",
  ],
]) {
  if (!dispatch.test(productShellSource)) {
    fail(`Product shell must ${what}`);
  }
}

// Keyed dispatch is legal for exactly ONE declaration here: the official
// `tool.call.toolview`, whose key domain IS the wire tool name. Everything
// else — Settings sections above all — must keep using the list-slot ledger,
// so the exception is pinned BY NAME rather than the word being banned
// outright, and a `kind: "keyed"` not attached to a named child declaration
// still fails.
const keyedChildDeclarations = [
  ...uiShellClient.matchAll(/"([\w.-]+)":\s*\{\s*kind:\s*"keyed"/gu),
].map((match) => match[1]);
if (
  keyedChildDeclarations.some((slot) => slot !== "tool.call.toolview") ||
  (uiShellClient.match(/kind:\s*"keyed"/gu) ?? []).length !==
    keyedChildDeclarations.length ||
  uiShellClient.includes("data-amiba-dsh-slot-key")
) {
  fail(
    "Settings children must use DSH list-slot ledger routing, not keyed dual registration",
  );
}
// Composer side of the picker contract: the Composer computes one seat
// request per render (official session seat vs vendor hero seat) and hands
// it to the host's render prop; the marker component and the host-wired
// agentModels engine pass-through are gone for good.
const composerSource = await text("packages/ui/src/chat/Composer.tsx");
if (
  !composerSource.includes('seat: "session"') ||
  !composerSource.includes('seat: "hero"') ||
  !composerSource.includes("owner: { locked: disabled }") ||
  composerSource.includes("agentModels") ||
  composerSource.includes("data-amiba-dsh-slot") ||
  composerSource.includes("ComposerModelPickerSlot")
) {
  fail(
    "Composer must dispatch the seat-split model-picker render prop (official conversation.input.model vs vendor hero seat), with no marker or engine pass-through",
  );
}
if (await exists("packages/ui/src/chat/ComposerModelPickerSlot.tsx")) {
  fail("retired marker component ComposerModelPickerSlot.tsx still exists");
}
// Composer side of the plan seat: the official contract places it in the
// tool row immediately right of the access-mode control, and defines the
// owner share as `{ locked }` only. Dispatch must be a bare render call —
// a wrapper element would spend layout on an empty seat, which the contract
// explicitly forbids ("the bar paints no placeholder").
if (
  !/ComposerApprovalModePicker[\s\S]{0,600}?\{planSeat \? planSeat\(\{ locked: disabled \}\) : null\}/u.test(
    composerSource,
  )
) {
  fail(
    "Composer must render the official conversation.input.plan seat immediately right of the access-mode control, with the locked-only owner share and no wrapper",
  );
}
// Composer side of the official `conversation.input.overlay` seat. Two
// separate facts, each load-bearing and each pinned:
//   1. `data-composer-card` on the frame that holds BOTH the editor and the
//      seat. It is the official anchor contract: occupants position against
//      that box and call `closest("[data-composer-card]")` on themselves to
//      tell a pointerdown inside the composer apart from one outside it.
//      Without the attribute, every click inside the composer dismisses the
//      overlay.
//   2. A BARE dispatch as the LAST child of that frame — no wrapper element
//      between the tool row and the seat. A wrapper would spend layout on an
//      unoccupied seat (the same rule as the plan seat) and would also become
//      the occupants' positioned ancestor, moving the floating overlay off
//      the composer card it is supposed to anchor to.
const composerOverlaySeat =
  /\{sendButtonNode\}\s*<\/div>([\s\S]*?)\{inputOverlay\}\s*<\/div>/u.exec(
    composerSource,
  );
if (
  !composerSource.includes('data-composer-card=""') ||
  composerOverlaySeat === null ||
  composerOverlaySeat[1].includes("<")
) {
  fail(
    "Composer must anchor the official conversation.input.overlay seat as a bare last-child dispatch inside the [data-composer-card] frame",
  );
}
// Host anchor for conversation.session.header.actions: a title-adjacent row
// that collapses (`:empty` → display:none) while the seat is unoccupied, so
// an absent plugin costs neither a box nor a flex gap.
const fullScreenChatSource = await text(
  "packages/ui/src/chat/FullScreenChatView.tsx",
);
if (
  !fullScreenChatSource.includes("data-content-header-actions") ||
  // Pinned inside the className (the bare string also occurs in prose).
  !fullScreenChatSource.includes("gap-0.5 empty:hidden") ||
  !fullScreenChatSource.includes("actions={slots?.headerActions}")
) {
  fail(
    "Chat content header must anchor the official conversation.session.header.actions seat as a title-adjacent row that collapses while empty",
  );
}

const memoryManifest = await json("plugins/dsh-plugin-memory/package.json");
if (memoryManifest.exports?.["./package.json"] !== "./package.json") {
  fail("dual-face Memory plugin must export package.json for DSH discovery");
}
if (
  JSON.stringify(memoryManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail("memory Client plugin must depend on DSH Remote and Amiba's slot owner");
}
const memoryClient = await text(
  "plugins/dsh-plugin-memory/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_MEMORY_REMOTE)",
  '"settings.section"',
  "id: SECTION_ID",
  "label: () => labels().nav",
  // Trailing comma on purpose: the inject face also carries the section's
  // navIcon thunk (the ui-shell navIcon convention, c8f14b9).
  "inject: () => ({ listMemory, listPresets,",
]) {
  if (!memoryClient.includes(required)) {
    fail(`memory Client plugin is missing ${required}`);
  }
}
if (memoryClient.includes("settings.navigation")) {
  fail(
    "memory must register one settings section; navigation comes from the DSH slot ledger",
  );
}
const memoryHost = await text(
  "plugins/dsh-plugin-memory/src/remote-service.ts",
);
if (
  !memoryHost.includes("TypertRemoteService") ||
  !memoryHost.includes("@Remote")
) {
  fail("memory Host plugin must expose its management face through DSH Typert");
}

const center = await text("plugins/dsh-plugin-messaging-core/src/center.ts");
if (/id:\s*["']webhook["']/u.test(center)) {
  fail("messaging-core must not embed a concrete channel provider");
}
for (const file of await sourceFiles("plugins/dsh-plugin-messaging-core/src")) {
  const body = await readFile(file, "utf8");
  if (body.includes("webServer") || body.includes("IncomingMessage")) {
    fail(
      `messaging-core must not own HTTP transport in ${path.relative(root, file)}`,
    );
  }
}
const messagingManifest = await json(
  "plugins/dsh-plugin-messaging-core/package.json",
);
if (
  JSON.stringify(messagingManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "messaging-core Client plugin must depend on DSH Remote and the slot owner",
  );
}
const messagingClient = await text(
  "plugins/dsh-plugin-messaging-core/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_MESSAGING_REMOTE)",
  '"remote.amibaMessaging"',
  '"settings.section"',
  "id: SECTION_ID",
  "DshSettingsMessaging",
]) {
  if (!messagingClient.includes(required)) {
    fail(`messaging-core Client plugin is missing ${required}`);
  }
}
const messagingHost = await text(
  "plugins/dsh-plugin-messaging-core/src/remote-service.ts",
);
if (
  !messagingHost.includes("TypertRemoteService") ||
  !messagingHost.includes("@Remote")
) {
  fail("messaging-core Host plugin must expose management through DSH Typert");
}
const settingsView = await text("packages/ui/src/settings/SettingsView.tsx");
if (
  settingsView.includes('mainTab === "messaging"') ||
  settingsView.includes("<SettingsMessaging")
) {
  fail(
    "Messaging settings must be supplied by its DSH Client plugin, not the host root",
  );
}
if (
  settingsView.includes('mainTab === "tools"') ||
  settingsView.includes('mainTab === "skills"') ||
  settingsView.includes("<ToolsPage") ||
  settingsView.includes("<SkillsPage")
) {
  fail(
    "Tools and Skills settings must be supplied by their DSH Client plugins",
  );
}
const slotsSdk = await text("packages/extension-sdk/src/slots.ts");
const productShell = productShellSource;
// The section-ledger navigation is rendered DIRECTLY by the product shell
// (the former amiba.settings.navigation.assistant slot indirection is
// retired); SettingsView's assistantNavigation render prop stays the host
// mechanism, and the Settings Shell stays the single selection source.
if (
  !productShell.includes("active={activeSection === section.id}") ||
  !productShell.includes("<SettingsSectionNavigation") ||
  uiShellClient.includes("useActiveSettingsSection") ||
  !settingsView.includes("assistantNavigation?.(dshSection)") ||
  productShell.includes('renderSlot("amiba.settings.navigation')
) {
  fail(
    "Settings Shell must be the single selection source for built-in and DSH slot navigation",
  );
}
// Official-vocabulary type home: the SDK inherits settings.section (and the
// settings.* family) from the official declarer instead of re-declaring it,
// and mirrors shell.overlay identically (see the guard for why no import).
if (
  !slotsSdk.includes('from "@deepseek-ai/dsh-client-ui-settings/client"') ||
  !slotsSdk.includes('"shell.overlay": { kind: "list"; scope: "root" }') ||
  slotsSdk.includes('"settings.section":')
) {
  fail(
    "extension-sdk must inherit the official settings vocabulary and mirror shell.overlay, not re-declare settings.section",
  );
}
// The keyed tool seat inherits the official TOOL vocabulary the same way, and
// its owner contract is re-DERIVED from the SlotMap rather than restated — a
// hand-written copy could drift from upstream and still compile. Its record
// must also have moved out of the not-adopted block: leaving it there while
// the runtime declares the seat is the documentation failure this vocabulary
// policy exists to prevent.
// A NAMED re-export, not a bare `import type {}`: type-only inclusions are
// elided at declaration emit, so only this form keeps the official tool
// declaration on the built SDK's declaration graph (the settings.section
// lesson). Whitespace-insensitive against a prettier reflow.
if (
  !/export type \{\s*ToolCallOwnerProps,?\s*\} from "@deepseek-ai\/dsh-client-ui-tool\/client"/u.test(
    slotsSdk,
  ) ||
  !slotsSdk.includes('OwnerOf<"tool.call.toolview">') ||
  slotsSdk.includes("//   - `tool.call.toolview`")
) {
  fail(
    "extension-sdk must inherit the official tool vocabulary through a named re-export, derive the tool.call.toolview owner via OwnerOf, and drop it from the not-adopted record",
  );
}
// The composer overlay seat inherits the official INPUT-TRIGGER vocabulary the
// same way: a NAMED re-export keeps `dsh-client-ui-input-trigger/client` on
// the built declaration graph (a bare `import type {}` is elided at
// declaration emit — the settings.section lesson), and the owner contract is
// DERIVED with OwnerOf instead of restated. The seat declares no `owner` key
// at all, so OwnerOf collapses to `object`; writing that empty share out by
// hand would be a fabrication waiting to drift.
if (
  !/export type \{[\s\S]{0,400}?InputTriggerSource,?[\s\S]{0,400}?\} from "@deepseek-ai\/dsh-client-ui-input-trigger\/client"/u.test(
    slotsSdk,
  ) ||
  !slotsSdk.includes('OwnerOf<"conversation.input.overlay">')
) {
  fail(
    "extension-sdk must inherit the official input-trigger vocabulary through a named re-export and derive the conversation.input.overlay owner via OwnerOf",
  );
}
const slotsGuard = await text(
  "packages/extension-sdk/src/slot-vocabulary-guard.ts",
);
if (!slotsGuard.includes('"@deepseek-ai/dsh-client-ui-layout/client"')) {
  fail(
    "extension-sdk slot-vocabulary guard must load the official ui-layout declaration beside the shell.overlay mirror",
  );
}
const webhookManifest = await json(
  "plugins/dsh-plugin-messaging-channel-webhook/package.json",
);
if (
  webhookManifest.dependencies?.["@amiba/dsh-plugin-messaging-core"] !==
  "workspace:*"
) {
  fail("webhook channel must declare its messaging-core project dependency");
}

const catalogManifest = await json("plugins/dsh-plugin-catalog/package.json");
if (!catalogManifest.exports?.["./client"]) {
  fail("capability catalog must expose a DSH Client plugin");
}
const catalogClient = await text(
  "plugins/dsh-plugin-catalog/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_TOOLS_REMOTE)",
  '"settings.section"',
  '"amiba.tools.panel"',
  "PropsRenderSlots",
  "children: {",
  'renderSlot("amiba.tools.panel"',
]) {
  if (!catalogClient.includes(required)) {
    fail(
      `catalog Client plugin is missing Tools child-slot contract ${required}`,
    );
  }
}

const skillsManifest = await json("plugins/dsh-plugin-skills/package.json");
if (
  JSON.stringify(skillsManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "Skills Client plugin must depend on DSH Remote and the settings slot owner",
  );
}
const skillsHost = await text("plugins/dsh-plugin-skills/src/skill-store.ts");
if (
  !skillsHost.includes("this.ctx.skills.list(") ||
  !skillsHost.includes("scope: agent")
) {
  fail(
    "Skills Host plugin must project the official scoped ctx.skills registry",
  );
}
const skillsClient = await text(
  "plugins/dsh-plugin-skills/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_SKILLS_REMOTE)",
  '"remote.amibaSkills"',
  '"settings.section"',
  "DshSkillsPage",
]) {
  if (!skillsClient.includes(required)) {
    fail(`Skills Client plugin is missing ${required}`);
  }
}

const agentPresetManifest = await json(
  "plugins/dsh-plugin-agent-preset/package.json",
);
if (
  JSON.stringify(agentPresetManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "Agent-preset Client plugin must depend on DSH Remote and the settings slot owner",
  );
}
const agentPresetClient = await text(
  "plugins/dsh-plugin-agent-preset/src/client/index.tsx",
);
for (const required of [
  // Engine-native data plane: the connection service's IApiClient face —
  // the exact surface the official dsh-client-ui-agent-preset consumed —
  // not a bespoke Amiba remote and not the host platform adapter.
  'ctx.get("connection")',
  "ctx.remote.$on(",
  '"settings/document-updated"',
  '"settings.section"',
  "id: SECTION_ID",
  // AP3: ONE merged section leading the Assistant group (the former
  // separate 行为与人设 section at 5 folded into the roster page).
  "order: 5,",
  // The preset-detail tab slot is declared by THIS plugin as a child of its
  // settings-section entry (not by the ui-shell root) and dispatched with
  // the official renderSlot — the amiba.tools.panel ownership pattern.
  '"amiba.agentPreset.section": { kind: "list", scope: "root" }',
  'renderSlot("amiba.agentPreset.section"',
  "{ only: sectionId }",
]) {
  if (!agentPresetClient.includes(required)) {
    fail(`Agent-preset Client plugin is missing ${required}`);
  }
}
for (const retired of ["DshAgentBehaviorSettingsPage", "BEHAVIOR_SECTION_ID"]) {
  if (agentPresetClient.includes(retired)) {
    fail(
      `Agent-preset Client plugin must register ONE settings section — found retired ${retired}`,
    );
  }
}
const agentPresetPage = await text(
  "plugins/dsh-plugin-agent-preset/src/client/DshAgentPresetsPage.tsx",
);
// The detail tab strip renders other plugins' preset sections through the
// renderSlot-backed render prop, scoped per preset via the owner argument —
// no DOM slot markers.
for (const required of [
  "renderPresetSection?.(section, { profileId: profile.name })",
]) {
  if (!agentPresetPage.includes(required)) {
    fail(`Agent-preset detail page is missing renderSlot dispatch ${required}`);
  }
}
if (agentPresetPage.includes("data-amiba-dsh-slot")) {
  fail(
    "Agent-preset detail page must dispatch contributions with renderSlot, not DOM slot markers",
  );
}

const mcpManifest = await json("plugins/dsh-plugin-mcp-manager/package.json");
if (
  JSON.stringify(mcpManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
    "@amiba/dsh-plugin-catalog",
  ])
) {
  fail("MCP Client plugin must declare the Tools owner as a client dependency");
}
const mcpClient = await text(
  "plugins/dsh-plugin-mcp-manager/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_MCP_REMOTE)",
  '"remote.amibaMcp"',
  'slots.inject("amiba.tools.panel"',
  'name: "amiba.tools.panel"',
  "DshMcpToolsTab",
]) {
  if (!mcpClient.includes(required)) {
    fail(`MCP Client plugin is missing child contribution ${required}`);
  }
}
const mcpHost = await text("plugins/dsh-plugin-mcp-manager/src/manager.ts");
if (
  !mcpHost.includes("new DshMcpPluginSupervisor") ||
  !mcpHost.includes("writeServers(")
) {
  fail("MCP Host plugin must own official MCP child lifecycle and persistence");
}

const scheduleManifest = await json(
  "plugins/dsh-plugin-schedule-adapter/package.json",
);
if (
  JSON.stringify(scheduleManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "Schedule Client plugin must depend on DSH Remote and the workspace slot owner",
  );
}
const scheduleClient = await text(
  "plugins/dsh-plugin-schedule-adapter/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_SCHEDULES_REMOTE)",
  '"remote.amibaSchedules"',
  "ScheduleWorkspaceView",
]) {
  if (!scheduleClient.includes(required)) {
    fail(
      `Schedule Client plugin is missing workspace contribution ${required}`,
    );
  }
}
for (const slot of ["amiba.workspace.navigation", "amiba.workspace.view"]) {
  if (!new RegExp(`slots\\.inject\\(\\s*"${slot}"`, "u").test(scheduleClient)) {
    fail(`Schedule Client plugin is missing workspace contribution ${slot}`);
  }
}
const scheduleHost = await text(
  "plugins/dsh-plugin-schedule-adapter/src/manager.ts",
);
if (
  !scheduleHost.includes("this.ctx.agents.resume(") ||
  !scheduleHost.includes('"schedule_list"') ||
  !scheduleHost.includes('"schedule_create"') ||
  !scheduleHost.includes('"schedule_delete"')
) {
  fail(
    "Schedule Host plugin must own live-agent recovery and official tool management",
  );
}
const commandsHost = await text(
  "plugins/dsh-plugin-commands-adapter/src/remote-service.ts",
);
if (
  !commandsHost.includes('super(ctx, "amibaCommands")') ||
  !commandsHost.includes("TypertRemoteService") ||
  !commandsHost.includes("@Remote")
) {
  fail("Commands plugin must expose its scoped catalog through a DSH Remote");
}
const usageReader = await text("plugins/dsh-plugin-usage/src/reader.ts");
const usageRemote = await text(
  "plugins/dsh-plugin-usage/src/remote-service.ts",
);
if (
  !usageReader.includes("this.ctx.sessionQuery.listSessions()") ||
  !usageReader.includes("this.ctx.sessionQuery.readSession(") ||
  !usageRemote.includes('super(ctx, "amibaUsage")')
) {
  fail(
    "Usage plugin must derive its Remote from canonical DSH sessionQuery logs",
  );
}
const modelPlaneHost = await text(
  "plugins/dsh-plugin-model-plane/src/index.ts",
);
const modelPlaneProjection = await text(
  "plugins/dsh-plugin-model-plane/src/projection.ts",
);
const modelPlaneRemote = await text(
  "plugins/dsh-plugin-model-plane/src/remote-service.ts",
);
if (
  !modelPlaneHost.includes("new ModelPlaneService") ||
  !modelPlaneProjection.includes("ctx.credentials") ||
  !modelPlaneProjection.includes("ctx.settings.mutate") ||
  !modelPlaneRemote.includes('super(ctx, "amibaModelPlane")')
) {
  fail(
    "Model Plane plugin must persist the canonical plane and project it through official DSH settings/credentials seams",
  );
}
const fullScreenChat = await text(
  "packages/ui/src/chat/FullScreenChatView.tsx",
);
if (
  fullScreenChat.includes("<ScheduledTasksPage") ||
  fullScreenChat.includes('sidebarView === "scheduled"')
) {
  fail(
    "Schedule must be a DSH workspace plugin, not a fixed Electron root page",
  );
}

const appRuntime = await json("packages/app-runtime/package.json");
if (appRuntime.name !== "@amiba/app-runtime") {
  fail("the consolidated application runtime must be @amiba/app-runtime");
}
for (const subpath of [
  "./core",
  "./platform",
  "./protocol",
  "./dsh-client",
  "./dsh-distribution",
  "./dsh-runtime",
  "./utils",
]) {
  if (!appRuntime.exports?.[subpath]) {
    fail(`@amiba/app-runtime is missing required subpath ${subpath}`);
  }
  if (!(await exists(`packages/app-runtime/src/${subpath.slice(2)}`))) {
    fail(`@amiba/app-runtime is missing module source ${subpath}`);
  }
}
for (const subpath of Object.keys(appRuntime.exports ?? {})) {
  if (/extension-host|managed-extensions|\/mcp(?:\/|$)/u.test(subpath)) {
    fail(`@amiba/app-runtime still exports legacy runtime ${subpath}`);
  }
}

const retiredRuntimePackages = [
  "@amiba/core",
  "@amiba/platform",
  "@amiba/runtime-protocol",
  "@amiba/dsh-client",
  "@amiba/model-plane",
  "@amiba/model-plane-adapter-dsh",
  "@amiba/mcp-host",
  "@amiba/managed-extensions",
  "@amiba/utils",
  "@amiba/extension-host",
  "@amiba/extension-api",
  "@amiba/extension-theme",
  "@amiba/tailwind-preset",
  "@amiba/dsh-distribution",
  "@amiba/dsh-runtime-manager",
];
for (const workspaceRoot of ["apps", "packages", "plugins", "bundles"]) {
  for (const entry of await readdir(path.join(root, workspaceRoot), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = `${workspaceRoot}/${entry.name}/package.json`;
    if (!(await exists(manifestPath))) continue;
    const manifest = await json(manifestPath);
    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    });
    for (const retired of retiredRuntimePackages) {
      if (manifest.name === retired || dependencyNames.includes(retired)) {
        fail(`${manifestPath} still references retired package ${retired}`);
      }
    }
    if (
      dependencyNames.some((name) => name.startsWith("@amiba/app-runtime/"))
    ) {
      fail(`${manifestPath} declares an export subpath as an npm dependency`);
    }
  }
}
for (const [manifestPath, packageName] of [
  ["packages/ui/package.json", "@amiba/ui"],
  ["packages/extension-sdk/package.json", "@amiba/extension-sdk"],
  ["bundles/dsh-bundle-amiba-core/package.json", "@amiba/dsh-bundle-amiba-core"],
  ["bundles/dsh-bundle-amiba-web/package.json", "@amiba/dsh-bundle-amiba-web"],
  ["bundles/dsh-bundle-amiba-desktop/package.json", "@amiba/dsh-bundle-amiba-desktop"],
]) {
  const manifest = await json(manifestPath);
  if (manifest.name !== packageName) {
    fail(`${packageName} must remain an independent package boundary`);
  }
}
const extensionSdk = await json("packages/extension-sdk/package.json");
if (extensionSdk.publishConfig?.access !== "public") {
  fail("@amiba/extension-sdk must remain a public DSH plugin SDK contract");
}
const extensionNative = await text("packages/extension-sdk/src/native.ts");
if (
  !extensionNative.includes("AmibaDshPluginManagerBridge") ||
  !extensionNative.includes("dsh plugin --profile web")
) {
  fail(
    "@amiba/extension-sdk must publish the narrow native DSH profile-management contract",
  );
}
const extensionTemplatePackage = await json(
  "apps/cli/src/template/package.json.tpl",
);
const extensionTemplateClient = await text(
  "apps/cli/src/template/src/client/index.tsx.tpl",
);
if (
  !extensionTemplatePackage.devDependencies?.["@amiba/extension-sdk"] ||
  !extensionTemplatePackage.dsh?.client?.inject?.includes(
    "@amiba/dsh-plugin-ui-shell",
  ) ||
  !extensionTemplateClient.includes(
    'ctx.slots.inject("conversation.session.header.utilities"',
  ) ||
  !extensionTemplateClient.includes("ctx.slots.register(") ||
  extensionTemplatePackage.scripts?.dev !== "amiba plugin dev" ||
  extensionTemplatePackage.scripts?.pack !== "amiba plugin pack"
) {
  fail(
    "Plugin scaffold must produce a DSH Client plugin with an Amiba child-slot contribution",
  );
}
if (
  extensionTemplateClient.includes("window.amiba") ||
  extensionTemplateClient.includes("webview") ||
  extensionTemplatePackage.peerDependencies?.electron
) {
  fail("Plugin scaffold must not recreate the Electron Extension/WebView API");
}
if (appRuntime.dependencies?.["@amiba/i18n"]) {
  fail("@amiba/app-runtime must not depend back on the UI i18n package");
}
for (const legacy of ["extension-host", "managed-extensions", "mcp", "model-plane"]) {
  const directory = `packages/app-runtime/src/${legacy}`;
  if (!(await exists(directory))) continue;
  const files = await sourceFiles(directory);
  if (files.length) {
    fail(`@amiba/app-runtime still contains legacy ${legacy} source`);
  }
}

for (const file of await sourceFiles("plugins/dsh-plugin-model-plane/src/plane")) {
  const body = await readFile(file, "utf8");
  if (
    /from\s+["']@deepseek-ai\//u.test(body) ||
    /from\s+["']\.\.\/plane-dsh/u.test(body)
  ) {
    fail(
      `canonical Model Plane depends on DSH in ${path.relative(root, file)}`,
    );
  }
}
// Model-plane client picker contract (R5): the plugin occupies BOTH model
// seats — the official session-scoped conversation.input.model (sessionId
// from the standard kit, locked from the owner, engine data over the
// official session.models/session.selectModel wire via ctx.get("connection"))
// and the vendor session-less hero seat (draft plumbing on the owner). The
// former owner-props agentModels pass-through must stay gone.
const modelPlaneClient = await text(
  "plugins/dsh-plugin-model-plane/src/client/index.tsx",
);
const modelPlanePicker = await text(
  "plugins/dsh-plugin-model-plane/src/client/DshComposerModelPicker.tsx",
);
if (!/slots\.inject\(\s*"conversation\.input\.model"/u.test(modelPlaneClient)) {
  fail("model-plane client must occupy the official conversation.input.model seat");
}
if (!/slots\.inject\(\s*"amiba\.composer\.modelPicker"/u.test(modelPlaneClient)) {
  fail("model-plane client must keep the vendor session-less hero seat");
}
if (!modelPlaneClient.includes('ctx.get("connection")')) {
  fail(
    "model-plane client must reach engine data over the official connection wire",
  );
}
if (
  !modelPlanePicker.includes("wire.models({ sessionId })") ||
  !modelPlanePicker.includes("wire.selectModel({")
) {
  fail(
    "model-plane picker must use the official session.models/session.selectModel wire faces",
  );
}
for (const body of [modelPlaneClient, modelPlanePicker]) {
  if (body.includes("agentModels")) {
    fail(
      "model-plane client must not resurrect the owner-props agentModels pass-through",
    );
  }
}
for (const file of await sourceFiles("apps/desktop/src")) {
  const body = await readFile(file, "utf8");
  if (/from\s+["']@amiba\/dsh-plugin-/u.test(body)) {
    fail(
      `Desktop imports a DSH plugin implementation in ${path.relative(root, file)}`,
    );
  }
  if (/extension-host|managed-extensions/u.test(body)) {
    fail(
      `Desktop still contains a legacy Extension runtime in ${path.relative(root, file)}`,
    );
  }
}
const nativeGateway = await text("apps/desktop/src/main/dsh-native-gateway.ts");
if (
  nativeGateway.includes("/catalog") ||
  nativeGateway.includes("inputSchema") ||
  nativeGateway.includes("ctx.tools")
) {
  fail(
    "Electron native gateway must execute operations, not own DSH tool/plugin metadata",
  );
}
const profilePluginManager = await text(
  "apps/desktop/src/main/dsh-profile-plugins.ts",
);
for (const required of [
  '"plugin",',
  '"--profile",',
  "this.paths.profileName",
  '"-w",',
  '"--dump-config"',
  ".rollback-",
  "assertInstalledBundle",
  "isRegistryDependencySpec",
]) {
  if (!profilePluginManager.includes(required)) {
    fail(
      `DSH profile plugin manager is missing official lifecycle guard ${required}`,
    );
  }
}
if (
  profilePluginManager.includes("ctx.loader") ||
  profilePluginManager.includes("extensionRegistry")
) {
  fail(
    "Electron plugin manager must delegate to the DSH profile command, not own Loader state",
  );
}
for (const packageName of pluginPackages) {
  const relative = `plugins/${packageName.slice("@amiba/".length)}/src/client`;
  if (!(await exists(relative))) continue;
  for (const file of await sourceFiles(relative)) {
    const body = await readFile(file, "utf8");
    if (
      body.includes("dshPlugins") &&
      packageName !== "@amiba/dsh-plugin-runtime-inventory"
    ) {
      fail(`${packageName} crosses the native profile-management boundary`);
    }
  }
}
const rendererEntry = await text("apps/desktop/src/renderer/index.tsx");
if (
  rendererEntry.includes("__AMIBA_DSH_ROOT__") ||
  rendererEntry.includes("createRoot(") ||
  rendererEntry.includes('from "./App"') ||
  !rendererEntry.includes("new DshApiClient") ||
  !/setPlatform\(\s*createElectronAdapter\(/u.test(rendererEntry) ||
  !rendererEntry.includes('new CustomEvent("amiba:open-session"') ||
  !productShell.includes("data-amiba-product-shell")
) {
  fail(
    "Electron renderer must only join DSH Client and load the plugin-owned product shell",
  );
}
for (const retiredDesktopRoot of [
  "apps/desktop/src/renderer/App.tsx",
  "apps/desktop/src/renderer/StartupScreen.tsx",
  "apps/desktop/src/renderer/chat/electron-engine-client.ts",
  "apps/desktop/src/main/chat/engine.ts",
  "apps/desktop/src/main/chat/dsh-turn.ts",
  "apps/desktop/src/main/chat/dsh-session-setup.ts",
  "apps/desktop/src/main/dsh-attachment-path.ts",
  "apps/desktop/src/main/model-plane.ts",
  "apps/desktop/src/main/model-credential-vault.ts",
  "apps/desktop/src/main/dsh-model-projection.ts",
]) {
  if (await exists(retiredDesktopRoot)) {
    fail(`Electron still owns DSH product logic ${retiredDesktopRoot}`);
  }
}
const dshPlatformAdapters = await text(
  "packages/app-runtime/src/dsh-client/platform-adapters.ts",
);
// Domain remotes (amibaMemory/amibaSkills/amibaTools/amibaSchedules/
// amibaMessaging/amibaMcp/amibaUsage/amibaModelPlane) are intentionally
// absent here: the pluginization-convergence migration made those domains
// fully plugin-owned (their Client plugins mount `ctx.remote` directly),
// retiring the host platform-adapter hop. Only mechanism-level surfaces
// remain in this layer.
for (const remote of [
  "amibaCommands",
  "amibaAttachments",
]) {
  if (!dshPlatformAdapters.includes(`\"${remote}/`)) {
    fail(`shared UI platform does not consume DSH Remote ${remote}`);
  }
}
const businessIpcPrefixes = [
  "agent-sessions",
  "agent-workspaces",
  "agent-presets",
  "agent-settings",
  "agent-credentials",
  "agent-permissions",
  "agent-memory",
  "agent-schedules",
  "agent-skills",
  "agent-commands",
  "agent-messages",
  "agent-mcp",
  "agent-tools",
  "agent-usage",
  "agent-attachments",
  "agent-models",
  "model-plane",
  "chat",
];
for (const relative of [
  "apps/desktop/src/main/ipc.ts",
  "apps/desktop/src/preload/index.ts",
]) {
  const body = await text(relative);
  for (const prefix of businessIpcPrefixes) {
    if (body.includes(`\"${prefix}:`)) {
      fail(`${relative} recreates DSH business transport ${prefix}`);
    }
  }
}
for (const duplicate of [
  "dsh-permissions.ts",
  "dsh-memory.ts",
  "dsh-schedule.ts",
  "dsh-skills.ts",
  "dsh-skill-document.ts",
  "dsh-messages.ts",
  "dsh-mcp.ts",
  "dsh-mcp-store.ts",
  "dsh-tools.ts",
  "dsh-usage.ts",
  "dsh-usage-projector.ts",
]) {
  if (await exists(`apps/desktop/src/main/${duplicate}`)) {
    fail(`Electron still owns duplicate DSH feature adapter ${duplicate}`);
  }
}
const desktopManifest = await json("apps/desktop/package.json");
const uiManifest = await json("packages/ui/package.json");
if (
  desktopManifest.devDependencies?.["tailwindcss-animate"] ||
  !uiManifest.dependencies?.["tailwindcss-animate"] ||
  !uiManifest.exports?.["./tailwind-preset"]
) {
  fail(
    "The shared UI package must own the Tailwind preset and animation plugin",
  );
}
if (
  Object.keys(desktopManifest.dependencies ?? {}).some((name) =>
    name.startsWith("@amiba/dsh-plugin-"),
  )
) {
  fail(
    "Desktop must consume plugin APIs over DSH, not depend on plugin implementations",
  );
}

for (const forbidden of [
  "packages/dsh-plugins",
  "packages/core",
  "packages/platform",
  "packages/runtime-protocol",
  "packages/dsh-client",
  "packages/model-plane",
  "packages/model-plane-adapter-dsh",
  "packages/mcp-host",
  "packages/managed-extensions",
  "packages/utils",
  "packages/extension-api",
  "packages/extension-host",
  "packages/extension-theme",
  "packages/tailwind-preset",
  "packages/dsh-distribution",
  "packages/dsh-runtime-manager",
  "apps/backend/pyproject.toml",
  "apps/browser-extension/package.json",
  "apps/desktop/scripts/prepare-hermes-runtime.mjs",
  "apps/desktop/scripts/prepare-dsh-runtime.mjs",
  "apps/desktop/scripts/smoke-dsh-runtime.mjs",
  "apps/desktop/dsh-runtime-manifest.json",
  "apps/desktop/src/main/managed-dsh-runtime.ts",
]) {
  if (await exists(forbidden))
    fail(`obsolete runtime surface still exists: ${forbidden}`);
}

const rootPackage = await json("package.json");
if (rootPackage.engines?.node !== "^22.19.0 || >=24.0.0") {
  fail("workspace Node engine must match DSH's supported runtime range");
}
for (const script of [
  "packages/app-runtime/scripts/dsh-runtime/prepare.mjs",
  "packages/app-runtime/scripts/dsh-runtime/smoke.mjs",
]) {
  const body = await text(script);
  if (/const pluginNames\s*=\s*\[/u.test(body)) {
    fail(`${script} hardcodes the bundle plugin list`);
  }
}
const prepare = await text("packages/app-runtime/scripts/dsh-runtime/prepare.mjs");
if (!prepare.includes("amibaSourceDigest")) {
  fail("managed runtime marker does not bind the current plugin source digest");
}
if (
  !prepare.includes("workspacePackages") ||
  !prepare.includes('dependency.startsWith("@amiba/")')
) {
  fail(
    "managed runtime source digest must cover the local Amiba dependency closure",
  );
}
const desktopPackage = await json("apps/desktop/package.json");
const cliPackage = await json("apps/cli/package.json");
const desktopDev = await text("apps/desktop/scripts/dev-desktop.mjs");
if (
  !desktopPackage.scripts?.predev?.includes("pnpm runtime:prepare") ||
  !desktopDev.includes('spawnSync(pnpm, ["runtime:prepare"]')
) {
  fail(
    "every desktop development entrypoint must refresh stale DSH plugin bundles before launch",
  );
}
if (
  desktopPackage.dependencies?.["@amiba/app-runtime"] !== "workspace:*" ||
  cliPackage.dependencies?.["@amiba/app-runtime"] !== "workspace:*"
) {
  fail(
    "CLI and Desktop must consume the app-runtime-owned DSH Runtime",
  );
}
const cliRuntime = await text("apps/cli/src/lib/dsh-runtime.ts");
if (
  cliRuntime.includes("process.execPath") ||
  cliRuntime.includes('require.resolve("@deepseek-ai/dsh') ||
  !cliRuntime.includes("command: managed.node") ||
  !cliRuntime.includes("verifyManagedDshRuntime")
) {
  fail("Amiba CLI must execute DSH through the shared managed Runtime");
}
if (
  !rootPackage.scripts?.["runtime:prepare"]?.includes(
    "packages/app-runtime",
  ) ||
  !desktopPackage.build?.extraResources?.some(
    (entry) =>
      entry.from ===
      "../../packages/app-runtime/resources/dsh-runtime",
  )
) {
  fail("Runtime preparation and Desktop packaging must consume the app-runtime DSH artifact");
}
if (
  !prepare.includes('const managedPnpmVersion = "9.12.0"') ||
  !prepare.includes("pnpmBinary(root)") ||
  !prepare.includes("pnpm: managedPnpmVersion")
) {
  fail(
    "managed DSH runtime must carry the pnpm used by the official plugin command",
  );
}

console.log(
  `[dsh-architecture] verified one app-runtime-owned DSH distribution, one public DSH plugin SDK, an execution-only Electron gateway, ${pluginPackages.length} independent DSH plugins, Core/Web/Desktop bundles, and a harness-independent Model Plane module`,
);
