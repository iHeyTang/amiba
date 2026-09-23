import { verifyToolDispatchContract } from './tool-dispatch-contract.mjs';
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

/**
 * Drop comments before pinning a source pattern.
 *
 * Load-bearing for any assertion whose pattern is also VOCABULARY the file's
 * own prose uses — the settings dialog's doc block quotes `role="dialog"` and
 * `aria-modal="true"` while explaining them, and the onboarding predicate
 * quotes upstream's selector verbatim, so a bare `.includes`/regex over the
 * raw source is satisfied by the explanation rather than by the code. (Same
 * class of gap as the P3 collapsing-row check, which a prose mention slipped
 * past three times.)
 */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/u.test(line))
    .join("\n");
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
      // Third-party code is never the subject of an architecture assertion,
      // and `packages/app-runtime/resources/dsh-runtime` stages a full npm
      // tree inside a scanned root. Without this the key-loss scan reports
      // `t("SemVer")` from a vendored yarn plugin as an Amiba call site —
      // and only on checkouts where the runtime happens to be staged, so it
      // passes in a fresh worktree and fails on a working machine.
      if (entry.name === "node_modules") continue;
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
      "@amiba/dsh-plugin-browser-core",
      "@amiba/dsh-plugin-browser-provider-cdp",
      "@amiba/dsh-plugin-catalog",
      "@amiba/dsh-plugin-commands-adapter",
      "@amiba/dsh-plugin-connector-core",
      "@amiba/dsh-plugin-connector-dingtalk",
      "@amiba/dsh-plugin-connector-weixin",
      "@amiba/dsh-plugin-connector-lark",
      "@amiba/dsh-plugin-cron",
      "@amiba/dsh-plugin-pets",
      "@amiba/dsh-plugin-mcp-manager",
      "@amiba/dsh-plugin-media",
      "@amiba/dsh-plugin-media-minimax",
      "@amiba/dsh-plugin-vision",
      "@amiba/dsh-plugin-memory-memos",
      "@amiba/dsh-plugin-messaging-core",
      "@amiba/dsh-plugin-model-plane",
      "@amiba/dsh-plugin-onboarding",
      "@amiba/dsh-plugin-notification-hub",
      "@amiba/dsh-plugin-conversation-notifications",
      "@amiba/dsh-plugin-pin",
      "@amiba/dsh-plugin-provider-tokendance",
      "@amiba/dsh-plugin-resources",
      "@amiba/dsh-plugin-schedule-adapter",
      "@amiba/dsh-plugin-skills",
      "@amiba/dsh-plugin-session-features",
      "@amiba/dsh-plugin-session-storage",
      "@amiba/dsh-plugin-background-jobs",
      "@amiba/dsh-plugin-steward",
      "@amiba/dsh-plugin-usage",
    ],
  },
  {
    directory: "dsh-bundle-amiba-web",
    name: "@amiba/dsh-bundle-amiba-web",
    plugins: [
      "@amiba/dsh-plugin-agent-preset",
      "@amiba/dsh-plugin-connector-webhook",
      "@amiba/dsh-plugin-markdown",
      "@amiba/dsh-plugin-file-preview",
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
const pluginPackages = [...new Set(bundleSpecs.flatMap((spec) => spec.plugins))].sort();
// Optional plugins own their activation layer instead of being activated by a
// mandatory distribution bundle. Count both layers to still reject duplicates.
for (const packageName of pluginPackages) {
  const project = `plugins/${packageName.slice("@amiba/".length)}`;
  const manifest = await json(`${project}/package.json`);
  const ownPatch = manifest.dsh?.bundle?.patch;
  if (ownPatch === undefined) continue;
  const projectRoot = path.join(root, project);
  if (typeof ownPatch !== "string" || !ownPatch.startsWith("./") ||
      !path.resolve(projectRoot, ownPatch).startsWith(`${projectRoot}${path.sep}`)) {
    fail(`${packageName} must declare a package-local dsh.bundle.patch`);
  }
  patches.push(await text(`${project}/${ownPatch}`));
}
const patch = patches.join("\n");
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
    fail(`${packageName} must occur exactly once across distribution and standalone activation layers`);
  for (const file of await sourceFiles(`${project}/src`)) {
    const body = await readFile(file, "utf8");
    for (const match of body.matchAll(/(?:webServer|server)\.register\(/gu)) {
      const beforeRegistration = body.slice(
        Math.max(0, (match.index ?? 0) - 200),
        match.index,
      );
      // Connection-scoped HTTP listeners are owned by ConnectorRuntime.stop,
      // whose provider registration is itself bound to Cordis. They must not
      // outlive an account merely because the plugin is still loaded.
      const connectorOwned = project === "plugins/dsh-plugin-connector-webhook"
        && /ctx\.effect\(\(\)\s*=>\s*ctx\.amibaConnectors\.registerProvider\(/u.test(body)
        && /async stop\(\)\s*\{\s*dispose\(\);?\s*\}/u.test(body)
        && body.includes("const dispose = server.register(");
      if (!beforeRegistration.includes("ctx.effect(") && !connectorOwned) {
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
  // Opaque, leased transport to installed native modules; carries no feature API.
  "nativeExtensions",
  // Existing companion window capability: geometry, pointer routing and navigation.
  // Notification content and acknowledgement state stay behind plugin remotes.
  "desktopPet",
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
  "@amiba/dsh-plugin-connector-webhook",
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
before("@amiba/dsh-plugin-catalog", "@amiba/dsh-plugin-memory-memos");
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
  "@amiba/dsh-plugin-connector-webhook",
);
// The notification hub composes before its posters (schedule-adapter) and
// before its presentation plugin (pets).
before(
  "@amiba/dsh-plugin-notification-hub",
  "@amiba/dsh-plugin-schedule-adapter",
);
before(
  "@amiba/dsh-plugin-notification-hub",
  "@amiba/dsh-plugin-pets",
);
before(
  "@amiba/dsh-plugin-ui-shell",
  "@amiba/dsh-plugin-agent-preset",
);

const uiShellManifest = await json("plugins/dsh-plugin-ui-shell/package.json");
if (
  JSON.stringify(uiShellManifest.dsh?.client?.inject) !==
  JSON.stringify(["@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-api-remotes"])
) {
  fail(
    "UI shell client graph must declare the official runtime and remote API services used by its Markdown bridge",
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
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  "conversation.session.header.utilities",
  "conversation.session.header.actions",
  "amiba.composer.modelPicker",
  "conversation.input.model",
  "conversation.input.plan",
  "conversation.input.overlay",
  "settings.section",
  // The six shell-level settings seats adopted with the settings dialog.
  // Membership on the children table is what AUTHORIZES the root to render
  // them at all — an undeclared key throws at register time for the
  // contributor and renders nothing for the host.
  "settings.trigger",
  "settings.header",
  "settings.action",
  "settings.close",
  "settings.onboarding",
  "settings.general.item",
  "shell.overlay",
  "tool.call.toolview",
  "amiba.conversation.question",
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
  // Amiba's keyed per-question row, same reasoning: entries registered with
  // `key: "<question id>"` would compile and never render under a divergent
  // kind, and a root scope would starve session-resolving occupants.
  ["amiba.conversation.question", "keyed", "session"],
  // The settings family. `settings.section` was pinned by membership only
  // until the dialog phase; all seven now carry the official kind/scope.
  // The single/list split is the load-bearing half here: a `list` where
  // upstream declares `single` would silently stack two trigger labels
  // inside one button, and a `single` where upstream declares `list` would
  // make the SECOND registrant throw instead of appending.
  ["settings.section", "list", "root"],
  ["settings.trigger", "single", "root"],
  ["settings.header", "single", "root"],
  ["settings.action", "list", "root"],
  ["settings.close", "single", "root"],
  ["settings.onboarding", "list", "root"],
  ["settings.general.item", "list", "root"],
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
  /renderSlot\(\s*"amiba\.workspace\.view",[\s\S]{0,800}?\{ only: viewId \}/u,
  /renderSlot\(\s*"shell\.overlay"/u,
  /renderSlot\(\s*"conversation\.session\.header\.utilities",\s*\{\}\s*,?\s*\)/u,
  // Title-adjacent counterpart of the utilities strip; the official owner
  // share is EMPTY, so anything but `{}` here would be a fabricated one.
  /renderSlot\(\s*"conversation\.session\.header\.actions",\s*\{\}\s*,?\s*\)/u,
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
  /renderSlot\(\s*"conversation\.input\.overlay",\s*\{\}\s*,?\s*\)/u,
  // The three settings seats whose official owner share is the EMPTY marker
  // interface (`SettingsHeaderOwnerProps` / `SettingsGeneralItemOwnerProps`,
  // both `{ children?: never }`). `{}` is the faithful dispatch; TypeScript
  // cannot flag a fabricated extra member against an empty owner (the P3
  // lesson), so this regex is the only thing that catches one.
  // These end at `[,)]`, NOT `)`: the owner share must stay `{}`, but a
  // third `RenderOpts` argument is legitimate and load-bearing here. The
  // two SINGLE seats below carry `fallback` — the only way Amiba can supply
  // its own copy for a seat it must not register into, since a `??` on the
  // dispatch result never fires (renderSlot returns a real `<div data-slot>`
  // for an EMPTY seat, not nullish). Pinning `)` once froze that bug in.
  /renderSlot\(\s*"settings\.header",\s*\{\}\s*[,)]/u,
  /renderSlot\(\s*"settings\.action",\s*\{\}\s*[,)]/u,
  /renderSlot\(\s*"settings\.general\.item",\s*\{\}\s*[,)]/u,
  // Same empty owner share, and the dispatch that names the dialog's close
  // button. Amiba deliberately registers NO entry of its own here: a
  // priority-0 occupant on a SINGLE slot makes the next registration throw.
  /renderSlot\(\s*"settings\.close",\s*\{\}\s*[,)]/u,
]) {
  if (!dispatch.test(productShellSource)) {
    fail(
      `Product shell must dispatch id-selected slots through renderSlot's official only-filter (${dispatch})`,
    );
  }
}
// The settings trigger seat. Its owner share is NOT empty — `{ wide }`, the
// sidebar column state — and it is a SINGLE slot, so both halves are pinned:
// the real owner value must be forwarded (a hard-coded `true` would be a
// fabricated one), and Amiba's own row content must ride as the dispatch
// `fallback`, since an unoccupied single seat otherwise renders nothing and
// the sidebar's settings row would go blank.
for (const [dispatch, what] of [
  [
    /renderSlot\(\s*"settings\.trigger",\s*owner,/u,
    "dispatch settings.trigger with the sidebar's real { wide } owner share",
  ],
  [
    /renderSlot\(\s*"settings\.trigger",[\s\S]{0,200}?fallback:\s*<SettingsTriggerContent\s+wide=\{owner\.wide\}\s*\/>/u,
    "pass Amiba's own gear + label as the settings.trigger fallback",
  ],
  [
    /renderSlot\(\s*"settings\.onboarding",[\s\S]{0,900}?\{\s*only:\s*onboardingStepId\s*\}/u,
    "render exactly ONE onboarding step through the official only-filter",
  ],
  [
    /renderSlot\(\s*"settings\.onboarding",[\s\S]{0,400}?stepId:\s*onboardingStepId/u,
    "hand the active step its own id",
  ],
  [
    /renderSlot\(\s*"settings\.onboarding",[\s\S]{0,400}?complete:\s*\(\)\s*=>\s*completeOnboardingStep\(onboardingStepId\)/u,
    "wire the step's complete() to the coordinator's hand-off",
  ],
  [
    /renderSlot\(\s*"settings\.onboarding",[\s\S]{0,900}?openSection:\s*openSettingsSection/u,
    "wire the step's openSection() to the same affordance the settings navigation uses",
  ],
]) {
  if (!dispatch.test(productShellSource)) {
    fail(`Product shell must ${what} (${dispatch})`);
  }
}
// The settings CONTAINER: a modal dialog layered over the chat surface, not
// a second top-level view. The retired `type View = "chat" | "settings"`
// route swap is what made `settings.close` unhonest (Amiba had only a back
// affordance), so its absence is asserted, not just the dialog's presence.
if (/type\s+View\s*=\s*"chat"\s*\|\s*"settings"/u.test(productShellSource)) {
  fail(
    "Settings must be a modal dialog layered over the chat surface, not a top-level view swap",
  );
}
if (
  !/<SettingsDialog[\s\S]{0,400}?open=\{settingsOpen\}/u.test(
    productShellSource,
  ) ||
  !/<SettingsDialog[\s\S]{0,400}?titleId=\{SETTINGS_TITLE_ID\}/u.test(
    productShellSource,
  ) ||
  !/headerId=\{SETTINGS_TITLE_ID\}/u.test(productShellSource)
) {
  fail(
    "The settings dialog must be named after the navigation heading the settings.header seat renders into (aria-labelledby)",
  );
}
const settingsDialog = code(
  await text("packages/ui/src/settings/SettingsDialog.tsx"),
);
for (const [pattern, what] of [
  [/role=\{open \? "dialog" : undefined\}/u, 'carry role="dialog" while open'],
  [/aria-modal=\{open \? "true" : undefined\}/u, "be modal while open"],
  [
    /aria-labelledby=\{open \? titleId : undefined\}/u,
    "name itself from the navigation heading",
  ],
  [
    /DIALOG_OVERLAY_MOTION_CLASS/u,
    "consume the shared Dialog overlay motion contract",
  ],
  [
    /DIALOG_CONTENT_MOTION_CLASS/u,
    "consume the shared Dialog content motion contract",
  ],
  [
    /setTimeout\(\(\)\s*=>\s*setPresent\(false\),\s*DIALOG_MOTION_MS\)/u,
    "retain the surface for the shared exit-motion duration",
  ],
  [/event\.key (?:===|!==) "Escape"/u, "close on Escape"],
  [
    /aria-hidden="true"[\s\S]{0,300}?onClick=\{\(\)\s*=>\s*\{[\s\S]{0,80}?onClose\(\)/u,
    "close on an outside (mask) click",
  ],
  [/restoreTo\.focus\(\)/u, "return focus to the element that opened it"],
]) {
  if (!pattern.test(settingsDialog)) {
    fail(`The settings dialog must ${what} (${pattern})`);
  }
}
// The onboarding coordinator's rules, at the two files that own them.
const onboardingPredicate = code(
  await text("plugins/dsh-plugin-ui-shell/src/client/settings-onboarding.ts"),
);
// Rule 1, byte-faithful to upstream's selector. Whitespace-insensitive.
if (
  !/state\.phase\s*===\s*"ready"\s*&&\s*\(\s*state\.current\s*===\s*undefined\s*\|\|\s*state\.byId\[state\.current\]\?\.blank\s*===\s*true\s*\)/u.test(
    onboardingPredicate,
  )
) {
  fail(
    "The onboarding active fact must be upstream's own predicate over the OFFICIAL sessions list snapshot (phase ready AND (no current OR current is blank))",
  );
}
const settingsShell = code(
  await text("plugins/dsh-plugin-ui-shell/src/client/settings-shell.ts"),
);
// …read through the FRAMEWORK's own useSessions standard hook, not a
// re-derivation from Amiba's own store. This is the whole reason the seat is
// honest: same service, same snapshot, same predicate.
if (!/useOfficialSessions\(isOnboardingActive\)/u.test(settingsShell)) {
  fail(
    "The onboarding active fact must be read through the framework's useSessions standard hook",
  );
}
const onboardingCoordinator = code(
  await text("packages/ui/src/settings/onboarding.ts"),
);
for (const [pattern, what] of [
  [
    /steps\.find\(\(step\)\s*=>\s*!completed\.has\(step\.id\)\)/u,
    "mount the FIRST registered step not yet completed (registry order)",
  ],
  [
    /if\s*\(active\)\s*return;[\s\S]{0,200}?setCompleted\(/u,
    "RESET the completed set when the active fact goes false — completion is deliberately NOT persisted",
  ],
]) {
  if (!pattern.test(onboardingCoordinator)) {
    fail(`The onboarding coordinator must ${what} (${pattern})`);
  }
}
// Persistence would be the tempting "improvement" and is explicitly ruled
// out: upstream is the authority on the flow's semantics, and a divergence
// would make third-party steps behave differently under Amiba.
if (
  /localStorage|sessionStorage|platform\.storage|getPlatform/u.test(
    onboardingCoordinator,
  )
) {
  fail(
    "The onboarding coordinator must not persist completion — upstream resets it and Amiba copies that",
  );
}
// ---------------------------------------------------------------------------
// THE LANGUAGE AUTHORITY
// ---------------------------------------------------------------------------
//
// One 语言 row, owned by `@deepseek-ai/dsh-client-locale`. Amiba's own
// competing control (a second `settings.ui.language` preference the official
// service could not see) is retired, and `@amiba/i18n` follows the official
// LocaleFace instead. Three things are pinned: the mapping is TOTAL and can
// never leak Amiba's `zh-CN` into `setLocale` (which throws on an
// unregistered id), the no-runtime fallback still exists for Quick-Ask and
// the notifier, and the retired control does not come back.
const i18nCore = code(await text("packages/i18n/src/index.ts"));
for (const [pattern, what] of [
  [
    /export function toOfficialLocaleId\(\s*language: ResolvedLanguage,?\s*\): OfficialLocaleId \{/u,
    "type the Amiba -> official mapping's RESULT as the official id union, so `zh-CN` cannot reach setLocale without a compile error",
  ],
  [
    /export type OfficialLocaleId = "zh" \| "en";/u,
    "restate the official LOCALE_IDS union verbatim (zh, en — never zh-CN)",
  ],
  [
    /export function fromOfficialLocaleId\(id: string\): ResolvedLanguage \{[\s\S]{0,200}?return[\s\S]{0,120}?"zh-CN" : "en";/u,
    "map every official id back to an Amiba language TOTALLY (a single return, no throw, unknown ids land on English)",
  ],
  [
    /export function detectBrowserLanguage\(\): ResolvedLanguage \{[\s\S]{0,400}?navigator\.languages/u,
    "keep the navigator.language resolution — it is the no-runtime fallback for Quick-Ask and the notifier",
  ],
  [
    /if \(source\) return fromOfficialLocaleId\(source\.getSnapshot\(\)\.active\);\s*return readDocumentLanguage\(\) \?\? detectBrowserLanguage\(\);/u,
    "resolve the active language from the OFFICIAL snapshot when one is installed and fall back to the document/navigator chain when none is",
  ],
  [
    /registry\.unsubscribe = source\.subscribe\(notifyRealm\);/u,
    "subscribe to the official locale service ONCE for the realm and fan the change out to every bundled copy, so a switch re-renders Amiba copy with no reload",
  ],
  [
    /const OFFICIAL_LOCALE_KEY = Symbol\.for\("@amiba\/i18n\/official-locale"\);/u,
    "keep the official source on the realm-wide symbol registry — a module-level `let` is set only in the ONE bundle whose `apply` holds a `ctx`",
  ],
  [
    /officialLocaleRegistry\(\)\.observers\.add\(refreshLanguage\);/u,
    "join the realm's install-notification list at load, so a copy that finished loading BEFORE installOfficialLocale is woken rather than left on the no-runtime fallback",
  ],
]) {
  if (!pattern.test(i18nCore)) {
    fail(`@amiba/i18n must ${what} (${pattern})`);
  }
}
// The global/not-global boundary. The SOURCE is realm-singular; the language
// cache and the two subscriber sets are NOT — each bundled copy notifies its
// own React trees, and hoisting those onto the realm would make every copy's
// `useSyncExternalStore` fire for every other copy's mount.
const localeRegistryShape =
  /interface OfficialLocaleRegistry \{([\s\S]*?)\n\}/u.exec(i18nCore);
if (!localeRegistryShape) {
  fail(
    "@amiba/i18n must declare the realm registry as `interface OfficialLocaleRegistry` so its membership can be checked",
  );
} else {
  const members = localeRegistryShape[1];
  if (!/\bsource\b/u.test(members) || !/\bobservers\b/u.test(members)) {
    fail(
      "The realm locale registry must carry the official `source` and the `observers` install-notification list",
    );
  }
  for (const perCopy of [
    "cachedLanguage",
    "languageSubscribers",
    "storeSubscribers",
  ]) {
    if (members.includes(perCopy)) {
      fail(
        `${perCopy} must NOT live on the realm-wide locale registry — each bundled copy of @amiba/i18n notifies its OWN React trees, and sharing it would cross-trigger every other copy`,
      );
    }
  }
}
for (const [pattern, what] of [
  [
    /^const languageSubscribers = new Set<LanguageSubscriber>\(\);$/mu,
    "keep the non-React language subscribers per bundle copy",
  ],
  [
    /^const storeSubscribers = new Set<\(\) => void>\(\);$/mu,
    "keep the useSyncExternalStore listeners per bundle copy",
  ],
  [
    /^let cachedLanguage: ResolvedLanguage = resolveActiveLanguage\(\);$/mu,
    "keep the resolved-language cache per bundle copy",
  ],
]) {
  if (!pattern.test(i18nCore)) {
    fail(
      `@amiba/i18n must ${what} — module scope, never the realm registry (${pattern})`,
    );
  }
}
// Keep the official namespace type contract; the locale bridge only mirrors
// the active language and performs no preference migration.
const localeBridge = code(
  await text("plugins/dsh-plugin-ui-shell/src/client/locale-bridge.ts"),
);
for (const [pattern, what] of [
  [
    /const LOCALE_SETTINGS_NAMESPACE: typeof UpstreamLocaleNamespace = "locale";/u,
    "read the OFFICIAL locale settings namespace, annotated with upstream's own const type",
  ],
]) {
  if (!pattern.test(localeBridge)) {
    fail(`The locale bridge must ${what} (${pattern})`);
  }
}
// Repo-wide: `LocaleRuntime.setLocale` THROWS on an unregistered id, so a
// literal argument may only ever be one of the two shipped ids. Tests are
// scanned too — a test asserting `setLocale("zh-CN")` would be asserting the
// throw path as if it were normal.
for (const scanRoot of ["packages", "plugins", "apps"]) {
  for (const file of await sourceFiles(scanRoot)) {
    const source = await readFile(file, "utf8");
    for (const [, literal] of source.matchAll(
      /setLocale\(\s*["']([^"']*)["']\s*\)/gu,
    )) {
      if (literal !== "zh" && literal !== "en") {
        fail(
          `setLocale called with "${literal}" in ${path.relative(root, file)} — the official service registers only "zh" and "en" and throws on anything else`,
        );
      }
    }
  }
}
// The retired control must not come back: one row, one authority.
const settingsPreferences = code(
  await text("packages/ui/src/settings/SettingsPreferences.tsx"),
);
if (
  /options\.preference\.language/u.test(settingsPreferences) ||
  /useStoredLanguagePreference|LanguagePreference/u.test(settingsPreferences)
) {
  fail(
    "Amiba must not draw a second 语言 row — the official locale plugin owns the one that exists (settings.general.item)",
  );
}
for (const retired of [
  "useStoredLanguagePreference",
  "saveLanguagePreference",
  "resolveLanguage",
]) {
  if (i18nCore.includes(`export function ${retired}`)) {
    fail(
      `@amiba/i18n still exports ${retired} — the Amiba-owned language preference has no writer left`,
    );
  }
}

// ---------------------------------------------------------------------------
// THE DICTIONARY: OWNED BY ITS SURFACE, REGISTERED ONCE, ABSENT FROM BUNDLES
// ---------------------------------------------------------------------------
//
// `@amiba/i18n` used to compile both catalogs in, so every one of the eleven
// DSH client plugin bundles inlined all of Amiba's copy (~82 KB each) —
// including `dsh-plugin-runtime-inventory`, which renders no `useT` copy at
// all. The dictionaries now live with their owners, meet the mechanism at
// RUNTIME through the realm message registry, and are registered with the
// official locale service as ONE namespace by the shell.
//
// Four things are pinned, in the order they can break:
//   1. the mechanism package ships no dictionary and no compile-time catalog;
//   2. `@amiba/ui`'s dictionary is reachable ONLY as its own entry point (the
//      trap: reachable through the component graph and tree-shaking keeps it,
//      putting all of it back into every bundle);
//   3. there is exactly ONE `locale.register` call site and ONE namespace;
//   4. the BUILT plugin bundles really are free of the copy.
for (const gone of ["packages/i18n/src/en.ts", "packages/i18n/src/zh-CN.ts"]) {
  if (await exists(gone)) {
    fail(
      `${gone} is back — the message catalogs belong to their owning surfaces (@amiba/ui/locales, the ui-shell's own locales, apps/desktop's window copy), not to the mechanism package`,
    );
  }
}
const i18nMessages = code(await text("packages/i18n/src/messages.ts"));
const i18nPlugin = code(await text("packages/i18n/src/plugin.ts"));
for (const [source, name] of [
  [i18nCore, "packages/i18n/src/index.ts"],
  [i18nPlugin, "packages/i18n/src/plugin.ts"],
]) {
  if (/from "\.\/(en|zh-CN)"/u.test(source)) {
    fail(
      `${name} imports a compile-time catalog — the dictionary reaches this package through the realm message registry, and a static import would put all of it back into every plugin bundle`,
    );
  }
}
for (const [pattern, what] of [
  [
    /const MESSAGES_KEY = Symbol\.for\("@amiba\/i18n\/messages"\);/u,
    "keep the template source on the realm-wide symbol registry, so every bundled copy of @amiba/i18n resolves the ONE dictionary the shell registered",
  ],
  [
    /export function installMessages\(resolve: MessageResolver\): \(\) => void \{[\s\S]{0,400}?const superseded = registry\.resolve;/u,
    "let a later install SUPERSEDE an earlier one and restore it on dispose — the shell installs its compile-time catalogs first and the official namespace binding on top",
  ],
  [
    /if \(registry\.resolve !== resolve\) return;/u,
    "make an out-of-order dispose a no-op instead of clobbering somebody else's install",
  ],
  [
    /registry\.epoch \+= 1;/u,
    "bump the registry revision on every install, so a dictionary that arrives after the first paint still repaints mounted trees (the shell registers inside ctx.inject, which resolves whenever the locale service does)",
  ],
  [
    /return messageRegistry\(\)\.resolve\?\.\(key, language\) \?\? key;/u,
    "answer an unknown key with the key itself — fail loud, the same last resort upstream's LocaleRuntime.translate takes",
  ],
]) {
  if (!pattern.test(i18nMessages)) {
    fail(`@amiba/i18n's message registry must ${what} (${pattern})`);
  }
}
// The epoch has to reach React, or a late registration repaints nothing.
if (!/messagesEpoch\(\)/u.test(i18nCore) || !/subscribeMessages\(refreshLanguage\)/u.test(i18nCore)) {
  fail(
    "packages/i18n/src/index.ts must fold the message-registry epoch into its store snapshot and join the registry's observer list — otherwise a dictionary installed after mount leaves already-rendered trees showing raw keys",
  );
}
if (!/useSyncExternalStore\(\s*subscribeMessages,/u.test(i18nPlugin)) {
  fail(
    "usePluginT must observe the message registry too — its host-vocabulary fallback has the same late-registration problem useT does",
  );
}
if (!/resolveMessage\(key, language\)\s*\);/u.test(i18nPlugin)) {
  fail(
    "usePluginT's fallback chain must end at the realm's host template resolver (overlay -> overlay English -> realm -> key)",
  );
}
// Entry-point separation. `@amiba/ui`'s components are inlined into ten plugin
// bundles; the dictionary must not be reachable from the same module graph.
const uiPackage = await json("packages/ui/package.json");
if (uiPackage.exports?.["./locales"] !== "./src/locales/index.ts") {
  fail(
    "@amiba/ui must expose its dictionary as the separate `./locales` entry point — that separation is what keeps it out of the ten plugin bundles",
  );
}
for (const file of await sourceFiles("packages/ui/src")) {
  const relative = path.relative(root, file);
  if (relative.startsWith(path.join("packages", "ui", "src", "locales"))) continue;
  if (/(__tests__|\.test\.|[\\/]test[\\/])/u.test(relative)) continue;
  const source = code(await readFile(file, "utf8"));
  // Deliberately NOT anchored to a whole line: `import { en } from "./locales";
  // void en;` is a value import too, and an assertion that only recognised a
  // tidy one-import-per-line file would miss it (it did, until a mutation
  // caught the gap). The specifier is found first, then the statement it
  // belongs to is reconstructed backwards to decide whether it is type-only.
  for (const specifier of [
    ...source.matchAll(/from\s+"(\.[^"]*locales[^"]*)"/gu),
    ...source.matchAll(/import\s*\(\s*"(\.[^"]*locales[^"]*)"/gu),
  ]) {
    const before = source.slice(0, specifier.index);
    const keyword = Math.max(
      before.lastIndexOf("import"),
      before.lastIndexOf("export"),
    );
    const statement = keyword < 0 ? specifier[0] : source.slice(keyword, specifier.index + specifier[0].length);
    if (/^(?:import|export)\s+type\b/u.test(statement)) continue;
    fail(
      `${relative} reaches @amiba/ui's dictionary through the component graph (${statement.replace(/\s+/gu, " ").trim()}). Only \`import type\` may, and only for the key union — a value import puts all ~82 KB of copy back into every plugin bundle that renders one Amiba component.`,
    );
  }
}
// ONE namespace, ONE registration site. Upstream throws on a duplicate
// (ns, locale): "single occupant; a namespace's texts have one owner".
const shellMessages = code(
  await text("plugins/dsh-plugin-ui-shell/src/client/messages.ts"),
);
for (const [pattern, what] of [
  [
    /export const AMIBA_LOCALE_NS = "amiba";/u,
    "name the ONE namespace as a single exported constant",
  ],
  [
    /locale\.register\(\s*AMIBA_LOCALE_NS,\s*toOfficialCatalog\(amibaMessages\),?\s*\)/u,
    "register the merged owner dictionaries through the TYPED overload, re-keyed by the official locale ids through the existing mapping",
  ],
  [
    /const untypedNamespace: string = AMIBA_LOCALE_NS;\s*const translate = locale\.bind\(untypedNamespace\);/u,
    "bind through a string-typed namespace, which selects upstream's untyped bind overload — the realm resolver is handed keys that are SUPPOSED to miss (usePluginT consults it before its own overlay's English)",
  ],
  [
    /amiba: AmibaLocaleKey;/u,
    "declare the namespace in upstream's LocaleNamespaceMap, which is what makes the typed register check the dictionary key-for-key in both languages",
  ],
]) {
  if (!pattern.test(shellMessages)) {
    fail(`The Amiba locale namespace module must ${what} (${pattern})`);
  }
}
for (const scanRoot of ["packages", "plugins", "apps"]) {
  for (const file of await sourceFiles(scanRoot)) {
    const relative = path.relative(root, file);
    if (relative.includes(`${path.sep}lib${path.sep}`)) continue;
    if (relative.includes(`${path.sep}out${path.sep}`)) continue;
    const source = code(await readFile(file, "utf8"));
    for (const [, namespace] of source.matchAll(
      /\blocale\.register\(\s*([A-Za-z_$][\w$]*|"[^"]*")/gu,
    )) {
      if (
        relative ===
          path.join(
            "plugins",
            "dsh-plugin-ui-shell",
            "src",
            "client",
            "messages.ts",
          ) &&
        namespace === "AMIBA_LOCALE_NS"
      ) {
        continue;
      }
      fail(
        `${relative} registers a locale namespace (${namespace}). Amiba has exactly ONE, registered from the ui-shell's messages.ts — a second one would need useT to walk a lookup chain Amiba invented on top of upstream's.`,
      );
    }
  }
}
// The shell must still render real strings in a composition with no locale
// service at all: the compile-time catalogs go in unconditionally, and the
// official registration is guarded by `locale` ALONE (not by the
// fiber that owns the language authority).
const shellClient = code(
  await text("plugins/dsh-plugin-ui-shell/src/client/index.tsx"),
);
if (!/^\s*const disposeMessageCatalog = installAmibaMessageCatalog\(\);$/mu.test(shellClient)) {
  fail(
    "amiba-ui-shell must install the compile-time catalogs unconditionally in apply — `ctx.locale` is optional in this composition, and without them a graph missing dsh-client-locale renders every Amiba string as its raw dotted key",
  );
}
if (
  !/ctx\.inject\(\["locale"\],\s*\(scope\) => \{[\s\S]{0,300}?registerAmibaMessages\(scope\.locale\)/u.test(
    shellClient,
  )
) {
  fail(
    "the Amiba namespace registration must ride its own ctx.inject([\"locale\"]) fiber — folding it into the authority fiber would make real strings depend on settingsScope, which the dictionary does not need",
  );
}
// The EXCEPTION the purity rule must not break: Quick-Ask and the notifier
// boot no DSH plugin graph at all, so no `ctx.locale` exists in their realm and
// nothing would ever fill the message registry for them. They render
// `@amiba/ui` components that call `useT()`, so they are the one place outside
// the shell that legitimately imports the dictionaries.
const windowLocales = code(
  await text("apps/desktop/src/renderer/locales/index.ts"),
);
for (const [pattern, what] of [
  [
    /from "@amiba\/ui\/locales"/u,
    "take the UI components' copy from its own entry point — those windows render @amiba/ui components with no shell to register anything for them",
  ],
  [
    /en: \{ \.\.\.uiEn, \.\.\.en \}/u,
    "merge the UI copy with this app's own window copy (the notifier and Quick-Ask strings no plugin realm can render)",
  ],
]) {
  if (!pattern.test(windowLocales)) {
    fail(
      `apps/desktop's runtime-less window catalog must ${what} (${pattern})`,
    );
  }
}
for (const entry of [
  "apps/desktop/src/renderer/quick-ask/index.tsx",
]) {
  const source = code(await text(entry));
  if (!/installWindowMessages\(\)/u.test(source)) {
    fail(
      `${entry} must call installWindowMessages() before it renders — it boots no plugin graph, so nothing else will ever put a dictionary in its realm and every string would render as its raw dotted key`,
    );
  }
  if (!/seedDocumentLanguage\(\)/u.test(source)) {
    fail(
      `${entry} must still call seedDocumentLanguage() — the other half of the runtime-less contract`,
    );
  }
}

// ---------------------------------------------------------------------------
// BUNDLE PURITY, MEASURED ON THE BUILT OUTPUT
// ---------------------------------------------------------------------------
//
// The source-level assertions above are necessary and not sufficient: a
// type-only import that stops being type-only, a barrel re-export, or a
// bundler change would each put the copy back while every pattern above still
// matched. This one reads the emitted `lib/client.js` files.
//
// The sentinels are dictionary VALUES, not keys: a key literal also appears at
// its call site, which legitimately IS in the plugin bundles.
const LOCALE_SENTINELS = [
  ["packages/ui/src/locales/en.ts", "Unable to send your answer."],
  ["packages/ui/src/locales/zh-CN.ts", "无法发送你的回答。"],
];
for (const [file, sentinel] of LOCALE_SENTINELS) {
  if (!(await text(file)).includes(sentinel)) {
    fail(
      `the bundle-purity probe string ${JSON.stringify(sentinel)} is no longer in ${file}, so the purity assertion below proves nothing. Pick another value-side string only that catalog carries and update both.`,
    );
  }
}
const SHELL_CLIENT_BUNDLE = "plugins/dsh-plugin-ui-shell/lib/client.js";
if (!(await exists(SHELL_CLIENT_BUNDLE))) {
  console.warn(
    "[dsh-architecture] SKIPPED the bundle-purity assertion: no built plugin client bundles found. Run `pnpm -r build` first — this check is only meaningful on emitted output.",
  );
} else {
  const shellBundle = await text(SHELL_CLIENT_BUNDLE);
  for (const [, sentinel] of LOCALE_SENTINELS) {
    if (!shellBundle.includes(sentinel)) {
      fail(
        `${SHELL_CLIENT_BUNDLE} does NOT carry ${JSON.stringify(sentinel)}. The ui-shell is the ONE bundle that must — it imports every owner's dictionary to register it. Either the registration stopped importing the catalogs (the whole realm would render raw keys) or the probe is looking at the wrong artifact, and either way the purity assertion below would pass vacuously.`,
      );
    }
  }
  for (const entry of await readdir(path.join(root, "plugins"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const relative = path.join("plugins", entry.name, "lib", "client.js");
    if (relative === SHELL_CLIENT_BUNDLE) continue;
    if (!(await exists(relative))) continue;
    const bundle = await text(relative);
    for (const [owner, sentinel] of LOCALE_SENTINELS) {
      if (bundle.includes(sentinel)) {
        fail(
          `${relative} carries ${JSON.stringify(sentinel)} from ${owner} — Amiba's dictionary is back in a plugin bundle (~82 KB of copy per bundle). Look for a value import of @amiba/ui/locales, or a re-export that made the dictionary reachable from the component graph.`,
        );
      }
    }
  }
}
// ---------------------------------------------------------------------------
// ZERO KEY LOSS
// ---------------------------------------------------------------------------
//
// With the dictionaries split across owners, "no surface renders a raw key" is
// no longer something the compiler alone can promise for every call site (a
// program that cannot see an owner's augmentation resolves MessageKey to
// `never`, which IS a compile error — but a plugin overlay key is typed
// `string` on purpose). So the cross-reference runs here: every `t("…")`
// literal in the tree must be defined by some dictionary.
//
// Test files are excluded: their fixtures deliberately name keys that exist
// nowhere, to pin the missing-key behaviour.
const dictionaryKeys = new Set();
const DICTIONARY_FILE =
  /(locales[\\/](en|zh-CN)\.ts|src[\\/]client[\\/](i18n[^\\/]*|(?:[^\\/]+-)?locales)\.ts)$/u;
let dictionaryFileCount = 0;
for (const scanRoot of ["packages", "plugins", "apps"]) {
  for (const file of await sourceFiles(scanRoot)) {
    const relative = path.relative(root, file);
    if (relative.includes(`${path.sep}lib${path.sep}`)) continue;
    if (!DICTIONARY_FILE.test(relative)) continue;
    if (/\.test\.tsx?$/u.test(relative)) continue;
    dictionaryFileCount += 1;
    // Plugin dictionaries also use identifier keys and multiline string values.
    for (const [, quotedKey, identifierKey] of code(await readFile(file, "utf8")).matchAll(
      /^\s+(?:["']([^"']+)["']|([A-Za-z_$][\w$]*)):\s*["'`]/gmu,
    )) {
      dictionaryKeys.add(quotedKey ?? identifierKey);
    }
  }
}
if (dictionaryFileCount < 3 || dictionaryKeys.size < 400) {
  fail(
    `the zero-key-loss cross-reference found only ${dictionaryKeys.size} keys across ${dictionaryFileCount} dictionary files — the dictionary discovery pattern has drifted and the check below would pass by finding nothing to check`,
  );
}
let translationCallSites = 0;
for (const scanRoot of ["packages", "plugins", "apps"]) {
  for (const file of await sourceFiles(scanRoot)) {
    const relative = path.relative(root, file);
    if (relative.includes(`${path.sep}lib${path.sep}`)) continue;
    if (relative.includes(`${path.sep}out${path.sep}`)) continue;
    if (/(__tests__|\.test\.tsx?$|[\\/]test[\\/])/u.test(relative)) continue;
    for (const [, key] of code(await readFile(file, "utf8")).matchAll(
      /\bt\(\s*"([^"]+)"/gu,
    )) {
      translationCallSites += 1;
      if (!dictionaryKeys.has(key)) {
        fail(
          `${relative} renders t(${JSON.stringify(key)}), which no dictionary defines. After the owner split a missing key renders as the raw dotted string in the product.`,
        );
      }
    }
  }
}
if (translationCallSites < 700) {
  fail(
    `the zero-key-loss cross-reference matched only ${translationCallSites} t("…") call sites — the call-site pattern has drifted and the check above is no longer covering the tree`,
  );
}

// Preserve wire identity, optional runtime capabilities and both fallback layers.
verifyToolDispatchContract(productShellSource);
for (const [dispatch, what] of [
  [
    /renderSlot\(\s*"amiba\.conversation\.question",\s*request\.owner,\s*\{\s*entryKey:\s*request\.owner\.request\.questions\[0\]\?\.id \?\? "",\s*fallback:\s*request\.fallback,?\s*\}\s*\)/u,
    "dispatch the amiba.conversation.question seat keyed by the question id with the banner as fallback",
  ],
]) {
  if (!dispatch.test(productShellSource)) {
    fail(`Product shell must ${what}`);
  }
}

// Explicitly reviewed keyed contracts only. Settings entries remain list slots;
// new main/tool/command keys must not make arbitrary keyed settings legal.
const KEYED_CHILD_DECLARATIONS = new Set([
  "main",
  "conversation.chat.commandview",
  "amiba.conversation.notice",
  "tool.call.toolview",
  "amiba.conversation.question",
]);
const keyedChildDeclarations = [
  ...uiShellClient.matchAll(/"([\w.-]+)":\s*\{\s*kind:\s*"keyed"/gu),
].map((match) => match[1]);
if (
  keyedChildDeclarations.some((slot) => !KEYED_CHILD_DECLARATIONS.has(slot)) ||
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
// ---------------------------------------------------------------------------
// The official input-trigger pipeline (Phase 4.3 completion). Three groups of
// facts, each of which turns a lie into a compile-time-invisible runtime bug
// if it drifts.
// ---------------------------------------------------------------------------

// 1. THE SHADOW. Both official overlay entries must be shadowed at the SAME id
//    with a STRICTLY LOWER priority — that is the whole mechanism by which the
//    official services stay live while Amiba owns the pixels. A missing or
//    non-negative priority silently puts TWO menus on screen (and the official
//    one paints transparent, because `--dsw-*` is undefined here).
const triggerSeatsSource = await text(
  "plugins/dsh-plugin-ui-shell/src/client/trigger-seats.tsx",
);
if (
  !/SLASH_MENU_ENTRY_ID\s*=\s*"slash-menu"/u.test(triggerSeatsSource) ||
  !/COMMAND_POPUP_ENTRY_ID\s*=\s*"command-popup"/u.test(triggerSeatsSource) ||
  !/SHADOW_PRIORITY\s*=\s*-1\b/u.test(triggerSeatsSource)
) {
  fail(
    "ui-shell must shadow the official conversation.input.overlay entries at their exact ids (slash-menu, command-popup) with priority -1",
  );
}
const shellClientSource = await text(
  "plugins/dsh-plugin-ui-shell/src/client/index.tsx",
);
for (const entry of ["SLASH_MENU_ENTRY_ID", "COMMAND_POPUP_ENTRY_ID"]) {
  const registration = new RegExp(
    String.raw`name: "conversation\.input\.overlay",\s*id: ${entry},\s*priority: SHADOW_PRIORITY,`,
    "u",
  );
  if (!registration.test(shellClientSource)) {
    fail(
      `ui-shell must register ${entry} into conversation.input.overlay at the shadowing priority`,
    );
  }
}

// 2. THE FOUR BAIL LISTENERS. Each scoped `slash/input-*` event must be
//    answered, and each answer must be `true` ONLY when the editor verb
//    reported an applied mutation — the ternary is the load-bearing part. A
//    listener returning a bare `true` lies to every source author.
const triggerBridgeSource = await text(
  "plugins/dsh-plugin-ui-shell/src/client/input-trigger-bridge.ts",
);
if (!/const current = \(\) => editors\.get\(sessionId\) === binding;/u.test(code(triggerBridgeSource))) {
  fail("input-trigger bridge must reject superseded editor bindings");
}
const bailListeners = [
  ["slash/input-begin-command", "ops.beginCommand(request.claim, request.span)"],
  [
    "slash/input-insert-reference",
    "ops.insertReference(request.reference, request.span)",
  ],
  ["slash/input-consume-token", "ops.consumeToken(request.guard)"],
  ["slash/input-insert-text", "ops.insertText(request.text, request.span)"],
];
for (const [event, call] of bailListeners) {
  const wiring = new RegExp(
    String.raw`actx\.on\("${event}", \(request\) =>\s*current\(\) && ${call
      .replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
      .replace(/\\\(/gu, String.raw`\(`)} \? true : undefined`,
    "u",
  );
  if (!wiring.test(triggerBridgeSource)) {
    fail(
      `input-trigger bridge must answer ${event} with true ONLY when the editor verb reports an applied mutation`,
    );
  }
}
// The claim submit must carry the REAL session-scope ctx. `@amiba/ui` has no
// access to one; fabricating it is the exact half-honest member this adoption
// refuses.
// Arity is upstream's business — DSH 0.1.1 appended composer images — so the
// check ends at `actx` and tolerates further arguments. What it must keep
// pinning is that `actx` is the resolved scope in the ctx position.
const directClaimSubmit = /claim\.submit\(args, actx[,)]/u.test(triggerBridgeSource);
const typedClaimSubmit = /const submit\s*=\s*claim\.submit\s+as/u.test(triggerBridgeSource) &&
  /submit\.call\(claim, args, actx[,)]/u.test(triggerBridgeSource);
if (!directClaimSubmit && !typedClaimSubmit) {
  fail(
    "input-trigger bridge must run CommandClaim.submit against the resolved session-scope context",
  );
}

// 3. THE DRIVER CALL SITES. Without these, `registerSource` succeeds and is
//    never consulted. `track` feeds candidates, `onSpace` reaches
//    `matchSpace`, `adjudicate` reaches `matchEnter`, `serializeReference`
//    reaches `codec`. `onSpace` must ride a NATIVE root keydown listener, not
//    a Lexical command: a command handler runs inside `editor.update`, where a
//    nested update is deferred and the verbs could not report applied-truth.
const driverSource = await text(
  "packages/ui/src/chat/composer/plugins/OfficialTriggerPlugin.tsx",
);
for (const [pattern, what] of [
  [/runtime\.bindEditor\(/u, "bindEditor (the four scoped bail listeners)"],
  [/controller\.track\(/u, "controller.track on every editor update"],
  [/controller\.onSpace\(\)/u, "controller.onSpace"],
  [/registerRootListener/u, "a native root keydown listener for onSpace"],
  [/claims\.watch\(/u, "the claim token integrity watch"],
]) {
  if (!pattern.test(driverSource)) {
    fail(`OfficialTriggerPlugin must drive ${what}`);
  }
}
if (/registerCommand[\s\S]{0,200}onSpace/u.test(driverSource)) {
  fail(
    "onSpace must not ride a Lexical command: a nested editor.update is deferred, so the bail verbs could not report applied-truth",
  );
}
const composerTriggerSource = composerSource;
for (const [pattern, what] of [
  [/controller\.adjudicate\(/u, "controller.adjudicate on the Enter path"],
  // Pinned inside the expansion CALL, not as a bare identifier: the same
  // string appears in the prose above it, and a prose-satisfiable check let
  // an earlier mutation slip past.
  [
    /expandMentionPartsAsync\(\s*parts,\s*providerRegistry\.all,\s*trigger\.resolver,\s*attempt\.signal,/u,
    "reference serialization through the source codec at submit time",
  ],
  [/useComposerTriggers\(/u, "the composer trigger session"],
]) {
  if (!pattern.test(composerTriggerSource)) {
    fail(`Composer must drive ${what}`);
  }
}
// The two mount paths must stay exclusive: one menu per composer.
const richComposerSource = await text(
  "packages/ui/src/chat/composer/RichComposerEditor.tsx",
);
if (
  !/if \(session\.official\) return <OfficialTriggerPlugin trigger=\{session\} \/>/u.test(
    richComposerSource,
  ) ||
  !/<TriggerMenuPlugin/u.test(richComposerSource)
) {
  fail(
    "RichComposerEditor must mount EXACTLY ONE trigger path: the official driver when a controller exists, the surface-local menu otherwise",
  );
}
// Amiba must not register a second ('/', "command") source: `ui-commands`
// owns that identity in-session and the service throws on duplicates.
const dshSourcesSource = await text(
  "packages/ui/src/chat/composer/providers/dsh-sources.ts",
);
if (
  !/export function officialTriggerSources\(\): InputTriggerSource\[\] \{\s*return \[makeSkillSource\(\), makeSessionSource\(\)\];/u.test(
    dshSourcesSource,
  )
) {
  fail(
    "officialTriggerSources must publish exactly the skill and session sources — ui-commands owns ('/', \"command\") in-session",
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

const memoryManifest = await json("plugins/dsh-plugin-memory-memos/package.json");
if (memoryManifest.exports?.["./package.json"] !== "./package.json") {
  fail("dual-face Memory plugin must export package.json for DSH discovery");
}
if (
  JSON.stringify(memoryManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail("memory Client plugin must depend on DSH Remote and Amiba's slot owner");
}
const memoryClient = await text(
  "plugins/dsh-plugin-memory-memos/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_MEMORY_REMOTE)",
  '"settings.section"',
  "id: SECTION_ID",
  "label: () => labels().nav",
  "inject: () => ({ navIcon:",
  "MemosPanel getStatus={getStatus}",
  '"amiba.workspace.navigation"',
  '"amiba.workspace.view"',
  "MemoryPage",
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
  "plugins/dsh-plugin-memory-memos/src/remote-service.ts",
);
if (memoryManifest.exports?.["./memory-store"]) {
  fail("memory must not export the retired memory store");
}
for (const file of await sourceFiles("plugins/dsh-plugin-memory-memos/src")) {
  if (/\.test\.tsx?$/u.test(file)) continue;
  const body = await readFile(file, "utf8");
  if (/AmibaMemoryStore|memory-store|Legacy memory|旧版记忆|旧版归档|api\/amiba\/memory/u.test(body)) {
    fail("memory must use MemOS only, with no archive implementation or compatibility API");
  }
}
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
if (messagingManifest.dsh?.client || messagingManifest.exports?.["./client"]) {
  fail("messaging-core must remain headless: no client entry or settings registration");
}
for (const group of ["dependencies", "peerDependencies", "devDependencies"]) {
  for (const dependency of Object.keys(messagingManifest[group] ?? {})) {
    if (/react|ui-shell|@amiba\/ui|dsh-client|api-remotes|typert/u.test(dependency)) {
      fail(`messaging-core must not depend on UI or management Remote: ${dependency}`);
    }
  }
}
const connectorManifest = await json(
  "plugins/dsh-plugin-connector-core/package.json",
);
if (
  JSON.stringify(connectorManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "connector-core Client plugin must depend on DSH Remote and the slot owner",
  );
}
const connectorClient = await text(
  "plugins/dsh-plugin-connector-core/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_CONNECTORS_REMOTE)",
  '"remote.amibaConnectors"',
  '"settings.section"',
  "DshSettingsConnect",
]) {
  if (!connectorClient.includes(required)) {
    fail(`connector-core Client plugin is missing ${required}`);
  }
}
const connectorHost = await text(
  "plugins/dsh-plugin-connector-core/src/remote-service.ts",
);
if (
  !connectorHost.includes("TypertRemoteService") ||
  !connectorHost.includes("@Remote")
) {
  fail("connector-core Host plugin must expose management through DSH Typert");
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
  "plugins/dsh-plugin-connector-webhook/package.json",
);
if (
  webhookManifest.dependencies?.["@amiba/dsh-plugin-connector-core"] !==
  "workspace:*"
) {
  fail("webhook must register through connector-core, not directly through messaging-core");
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
]) {
  if (!catalogClient.includes(required)) {
    fail(
      `catalog Client plugin is missing Tools inventory contract ${required}`,
    );
  }
}

const skillsManifest = await json("plugins/dsh-plugin-skills/package.json");
if (
  JSON.stringify(skillsManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
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
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
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
  "const api = ctx.remote",
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
  "renderPresetSection?.(section, { profileId: profile.id })",
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
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail("MCP Client plugin must declare its settings shell dependency");
}
const mcpClient = await text(
  "plugins/dsh-plugin-mcp-manager/src/client/index.tsx",
);
for (const required of [
  "ctx.remote.$mount(AMIBA_MCP_REMOTE)",
  '"remote.amibaMcp"',
  'slots.inject("settings.section"',
  'name: "settings.section"',
  "DshMcpToolsTab",
]) {
  if (!mcpClient.includes(required)) {
    fail(`MCP Client plugin is missing settings contribution ${required}`);
  }
}
if (catalogClient.includes("amiba.tools.panel") || mcpClient.includes("amiba.tools.panel")) {
  fail("Tools must remain an inventory; MCP management belongs in its own settings section");
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
if (scheduleManifest.dsh !== undefined) {
  fail(
    "Schedule adapter is a runtime-only notification bridge and must ship no client half",
  );
}
const cronManifest = await json("plugins/dsh-plugin-cron/package.json");
if (
  JSON.stringify(cronManifest.dsh?.client?.inject) !==
  JSON.stringify([
    "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-api-remotes",
    "@amiba/dsh-plugin-ui-shell",
  ])
) {
  fail(
    "Cron Client plugin must depend on DSH Remote and the workspace slot owner",
  );
}
// The schedule adapter is a runtime-only notification bridge now — its
// dashboard, remote and HTTP faces were deleted with the reminder UI. The
// workspace nav/view contribution for timed work belongs to the cron client.
const cronClient = await text("plugins/dsh-plugin-cron/src/client/index.tsx");
for (const required of [
  "ctx.remote.$mount(AMIBA_CRON_REMOTE)",
  '"remote.amibaCron"',
  "DshCronPage",
]) {
  if (!cronClient.includes(required)) {
    fail(`Cron Client plugin is missing workspace contribution ${required}`);
  }
}
for (const slot of ["amiba.workspace.navigation", "amiba.workspace.view"]) {
  if (!new RegExp(`slots\\.inject\\(\\s*"${slot}"`, "u").test(cronClient)) {
    fail(`Cron Client plugin is missing workspace contribution ${slot}`);
  }
}
// Reminder management is conversation-native (the model's own schedule_*
// tools); the adapter keeps only the dispatch→notification bridge. Cron owns
// timed NEW-session work and must spawn through the official registry.
const scheduleHost = await text(
  "plugins/dsh-plugin-schedule-adapter/src/notify.ts",
);
if (!scheduleHost.includes("amibaNotifications")) {
  fail("Schedule adapter must bridge reminder dispatches into the hub");
}
const cronHost = await text("plugins/dsh-plugin-cron/src/service.ts");
if (
  !cronHost.includes("this.ctx.agents.create(") ||
  !cronHost.includes(".followup(") ||
  !cronHost.includes("whenIdle()")
) {
  fail(
    "Cron Host plugin must spawn fresh sessions through the official registry and release them on idle",
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
const modelUiNative = await text("plugins/dsh-plugin-model-plane/src/client/native-settings.ts");
if (modelPlaneHost.includes("applyModelPlaneRemote") ||
    !modelUiNative.includes("this.api.llm.listConfigurableProviders") ||
    !modelUiNative.includes("this.api.session.modelCatalog") ||
    !modelUiNative.includes("this.api.settings.mutate") ||
    !modelUiNative.includes("this.api.credentials")) {
  fail("Model UI must directly consume native DSH APIs without an Amiba provider RPC");
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
    if (workspaceRoot === "plugins" && manifest.dsh?.client) {
      const configPath = `${workspaceRoot}/${entry.name}/vite.config.ts`;
      const config = code(await text(configPath));
      if (!/\binlineDynamicImports\s*:\s*true\b/u.test(config)) {
        fail(
          `${configPath} must inline dynamic imports: DSH cannot load relative CJS chunks`,
        );
      }
    }
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
const extensionTemplateVite = code(await text(
  "apps/cli/src/template/vite.config.ts.tpl",
));
if (!/\binlineDynamicImports\s*:\s*true\b/u.test(extensionTemplateVite)) {
  fail("Plugin scaffold must inline dynamic imports for the DSH module table");
}
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
// official session.modelCatalog/session.selectModel wire via ctx.get("connection"))
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
if (!modelPlaneClient.includes("const api = ctx.remote")) {
  fail(
    "model-plane client must reach engine data over the official connection wire",
  );
}
if (
  !modelPlanePicker.includes("wire.modelCatalog()") ||
  !modelPlanePicker.includes("wire.selectModel({")
) {
  fail(
    "model-plane picker must use the official session.modelCatalog/session.selectModel wire faces",
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
// amibaConnectors/amibaMcp/amibaUsage/amibaModelPlane) are intentionally
// absent here: the pluginization-convergence migration made those domains
// fully plugin-owned (their Client plugins mount `ctx.remote` directly),
// retiring the host platform-adapter hop. Only mechanism-level surfaces
// remain in this layer.
for (const remote of [
  "amibaCommands",
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
  desktopPackage.scripts?.dev !== "node scripts/dev-desktop.mjs" ||
  !desktopDev.includes('spawnSync(pnpm, ["runtime:prepare"]')
) {
  fail(
    "every desktop development entrypoint must refresh stale DSH plugin bundles before launch",
  );
}
if (
  desktopPackage.dependencies?.["@amiba/app-runtime"] !== "workspace:*" ||
  cliPackage.devDependencies?.["@amiba/app-runtime"] !== "workspace:*"
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
  (await json("packages/app-runtime/host-dependencies.json")).dependencies?.pnpm !== "9.12.0"
) {
  fail(
    "managed DSH runtime must carry the pnpm used by the official plugin command",
  );
}

console.log(
  `[dsh-architecture] verified one app-runtime-owned DSH distribution, one public DSH plugin SDK, an execution-only Electron gateway, ${pluginPackages.length} independent DSH plugins, Core/Web/Desktop bundles, and a harness-independent Model Plane module`,
);

// Notification presentation belongs to plugins, never to a fixed host window.
for (const retired of ["apps/desktop/src/main/notifier-window.ts", "apps/desktop/src/renderer/notifier/index.tsx"]) {
  if (await exists(retired)) fail(`${retired} must not return; desktop notices are plugin-rendered`);
}

for (const retired of ["apps/desktop/src/main/notifier-window.ts", "apps/desktop/src/renderer/notifier/index.tsx"]) {
  if (await exists(retired)) fail(`${retired} must not return; desktop notices are plugin-rendered`);
}
