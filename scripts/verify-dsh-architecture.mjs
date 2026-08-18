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
      "@amiba/dsh-plugin-schedule-adapter",
      "@amiba/dsh-plugin-skills",
      "@amiba/dsh-plugin-usage",
    ],
  },
  {
    directory: "dsh-bundle-amiba-web",
    name: "@amiba/dsh-bundle-amiba-web",
    plugins: [
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

const corePatch = patches[0];
for (const desktopOrWebOnly of [
  "@amiba/dsh-plugin-browser-provider-electron",
  "@amiba/dsh-plugin-runtime-gateway",
  "@amiba/dsh-plugin-messaging-channel-webhook",
  "@amiba/dsh-plugin-runtime-inventory",
  "@amiba/dsh-plugin-ui-shell",
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
for (const slot of [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  "amiba.chat.header.after",
  "amiba.chat.content.overlay",
  "amiba.settings.navigation.before",
  "amiba.settings.navigation.assistant",
  "amiba.settings.navigation.after",
  "amiba.settings.section",
  "amiba.settings.content.overlay",
  "amiba.shell.overlay",
]) {
  if (!uiShellClient.includes(`\"${slot}\"`)) {
    fail(`UI shell is missing semantic child slot ${slot}`);
  }
}
if (
  !uiShellClient.includes('name: "root"') ||
  !uiShellClient.includes("createPortal(") ||
  !uiShellClient.includes('ctx.reflect.provide("layout"') ||
  !uiShellClient.includes('entriesOfSlot("amiba.settings.section")') ||
  !uiShellClient.includes("resolveSlotLabel(") ||
  !uiShellClient.includes("only: target.filterId") ||
  !uiShellClient.includes('kind: "list"')
) {
  fail(
    "UI shell must own the DSH root, layout service, list-slot ledger projection, and portals",
  );
}
if (
  uiShellClient.includes('kind: "keyed"') ||
  uiShellClient.includes("data-amiba-dsh-slot-key")
) {
  fail(
    "Settings children must use DSH list-slot ledger routing, not keyed dual registration",
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
  '"amiba.settings.section"',
  "id: SECTION_ID",
  "label: () => labels().nav",
  "inject: () => ({ listMemory, resetMemory })",
]) {
  if (!memoryClient.includes(required)) {
    fail(`memory Client plugin is missing ${required}`);
  }
}
if (memoryClient.includes('"amiba.settings.navigation.assistant"')) {
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
  '"amiba.settings.section"',
  "id: SECTION_ID",
  "MessagingSettingsView",
]) {
  if (!messagingClient.includes(required)) {
    fail(`messaging-core Client plugin is missing ${required}`);
  }
}
if (
  messagingClient.includes("getPlatform") ||
  messagingClient.includes("ipc")
) {
  fail("messaging-core Client plugin must not route its UI through Electron");
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
const productShell = await text(
  "plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx",
);
if (
  !slotsSdk.includes("activeSection?: string") ||
  !uiShellClient.includes('getAttribute("data-amiba-dsh-active-section")') ||
  !uiShellClient.includes("active={activeSection === section.id}") ||
  uiShellClient.includes("useActiveSettingsSection") ||
  !settingsView.includes("assistantNavigation?.(dshSectionFromTab(mainTab))") ||
  !productShell.includes(
    "data-amiba-dsh-active-section={activeSettingsSection}",
  )
) {
  fail(
    "Settings Shell must be the single selection source for built-in and DSH slot navigation",
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
  '"amiba.settings.section"',
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
if (catalogClient.includes("getPlatform") || catalogClient.includes("ipc")) {
  fail("catalog Client plugin must not route Tools UI through Electron");
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
  '"amiba.settings.section"',
  "SkillsDirectoryView",
]) {
  if (!skillsClient.includes(required)) {
    fail(`Skills Client plugin is missing ${required}`);
  }
}
if (skillsClient.includes("getPlatform") || skillsClient.includes("ipc")) {
  fail("Skills Client plugin must not route its UI through Electron");
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
  "McpToolsView",
]) {
  if (!mcpClient.includes(required)) {
    fail(`MCP Client plugin is missing child contribution ${required}`);
  }
}
if (mcpClient.includes("getPlatform") || mcpClient.includes("ipc")) {
  fail("MCP Client plugin must not route its UI through Electron");
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
if (scheduleClient.includes("getPlatform") || scheduleClient.includes("ipc")) {
  fail("Schedule Client plugin must not route its UI through Electron");
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
  "./model-plane",
  "./model-plane-dsh",
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
    'ctx.slots.inject("amiba.chat.header.after"',
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
for (const legacy of ["extension-host", "managed-extensions", "mcp"]) {
  const directory = `packages/app-runtime/src/${legacy}`;
  if (!(await exists(directory))) continue;
  const files = await sourceFiles(directory);
  if (files.length) {
    fail(`@amiba/app-runtime still contains legacy ${legacy} source`);
  }
}

for (const file of await sourceFiles("packages/app-runtime/src/model-plane")) {
  const body = await readFile(file, "utf8");
  if (
    /from\s+["']@deepseek-ai\//u.test(body) ||
    /from\s+["']@amiba\/app-runtime\/model-plane-dsh/u.test(body) ||
    /from\s+["']\.\.\/model-plane-dsh/u.test(body)
  ) {
    fail(
      `canonical Model Plane depends on DSH in ${path.relative(root, file)}`,
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
for (const remote of [
  "amibaMemory",
  "amibaSchedules",
  "amibaSkills",
  "amibaCommands",
  "amibaMessaging",
  "amibaMcp",
  "amibaTools",
  "amibaUsage",
  "amibaAttachments",
  "amibaModelPlane",
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
