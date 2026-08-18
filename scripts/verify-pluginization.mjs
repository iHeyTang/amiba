#!/usr/bin/env node
/**
 * Pull-the-plugin verification harness.
 *
 * Doctrine (2026-08-18-pluginization-convergence-design.md): the core owns
 * mechanisms only; domain concepts (memory, skills, tools/catalog, MCP,
 * messaging, schedules, usage, tool metering) belong to plugins.
 * Acceptance test per module = "pull the plugin": delete the plugin and a
 * repo-wide grep of the HOST tree (`packages/` + `apps/`) must show zero
 * dangling references to its remote namespace, its retired platform
 * adapter/shape types, and its host-owned UI components/files.
 *
 * This script encodes that grep per module. Each module carries
 * `enforced: true | false`:
 *   - `true`  modules must currently pass — a violation fails the script.
 *   - `false` modules are still mid-migration; violations are reported as
 *     known, expected gaps (informational) and do NOT fail the script.
 *     Flip a module to `true` once its module-surgery task lands and a
 *     manual `node scripts/verify-pluginization.mjs` run comes back clean.
 *
 * Deliberately OUT of scope for this scan (see `shouldSkipDir`):
 *   - node_modules/lib/out/dist/build/.turbo/.vite - build output, not
 *     source.
 *   - packages/i18n - the host i18n bundles. Purging `options.<domain>.*`
 *     copy keys from them is T11's job (the final sweep), not T10's; those
 *     keys are expected to still be present on this tree. Pass
 *     `--strict-i18n` to include this directory anyway (useful once T11
 *     starts, to see how much copy is left to purge).
 *   - any `scripts/` directory - dev/ops tooling such as
 *     `packages/app-runtime/scripts/dsh-runtime/smoke.mjs`, which
 *     deliberately calls a plugin's public RPC surface end-to-end (e.g.
 *     `"amibaMemory/list"`) to black-box-smoke-test that the bundled
 *     plugin responds. That validates the plugin *mechanism*, not host/UI
 *     code coupling to a specific plugin's shape, so it is not the kind of
 *     leak this harness looks for. Plugin implementations themselves
 *     (`plugins/*`) are never scanned for the same reason: this harness
 *     checks the HOST (`packages/` + `apps/`), not the plugins.
 *
 * `plugins/` and `bundles/` are never scanned: a plugin's own client/host
 * code is expected to reference its own remote namespace, adapter, and
 * components - that is what "plugin-owned" means.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strictI18n = process.argv.includes("--strict-i18n");

const SCAN_ROOTS = ["packages", "apps"];
const SOURCE_EXT = /\.[cm]?[jt]sx?$/u;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "lib",
  "out",
  "dist",
  "build",
  ".turbo",
  ".vite",
  "coverage",
]);

function shouldSkipDir(name) {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name === "scripts") return true;
  if (!strictI18n && name === "i18n") return true;
  return false;
}

async function exists(relative) {
  return stat(path.join(root, relative)).then(
    () => true,
    () => false,
  );
}

async function collectSourceFiles() {
  const files = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        await visit(path.join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  for (const relative of SCAN_ROOTS) await visit(path.join(root, relative));
  return files;
}

function boundary(identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "u");
}

/**
 * Module definitions. `text` patterns are matched against every scanned
 * source file's contents. `paths` are files/directories that must not
 * exist at all once the module is fully plugin-owned (a deleted host
 * component leaves no text to grep, so its old path is asserted absent
 * directly).
 */
const MODULES = [
  {
    id: "memory",
    enforced: true,
    todo: null,
    text: [
      { label: "agentMemory platform-adapter key", pattern: boundary("agentMemory") },
      { label: "AgentMemoryAdapter platform type", pattern: boundary("AgentMemoryAdapter") },
      { label: "AgentMemoryTarget shape type", pattern: boundary("AgentMemoryTarget") },
      { label: "AgentMemoryTargetView shape type", pattern: boundary("AgentMemoryTargetView") },
      { label: "AgentMemoryEntry shape type", pattern: boundary("AgentMemoryEntry") },
      { label: "SettingsMemory host component", pattern: boundary("SettingsMemory") },
      { label: "amibaMemory DSH remote namespace", pattern: /amibaMemory/u },
    ],
    paths: [
      "packages/ui/src/settings/SettingsMemory.tsx",
      "packages/app-runtime/src/core/runtime-memory.ts",
    ],
  },
  {
    id: "skills",
    enforced: true,
    todo: null,
    text: [
      // NOTE: `agentSkills` / `AgentSkillsAdapter` / `AgentSkillMention` are
      // NOT forbidden - the chat composer's `/`-skill mention provider is a
      // genuinely distinct, engine-native concern (backed by the DSH-native
      // `skill.list` RPC, not the plugin's Remote face) that is explicitly
      // meant to stay host-visible per the design's non-goals. Only the
      // full authoring/CRUD shape contract - which moved into
      // dsh-plugin-skills' own client types - is forbidden here.
      { label: "AgentSkillEntry CRUD shape type", pattern: boundary("AgentSkillEntry") },
      { label: "AgentSkillDocument CRUD shape type", pattern: boundary("AgentSkillDocument") },
      { label: "AgentSkillFileList CRUD shape type", pattern: boundary("AgentSkillFileList") },
      { label: "AgentSkillFileContent CRUD shape type", pattern: boundary("AgentSkillFileContent") },
      { label: "AgentSkillFileEntry CRUD shape type", pattern: boundary("AgentSkillFileEntry") },
      { label: "AgentSkillResourceBase CRUD shape type", pattern: boundary("AgentSkillResourceBase") },
      { label: "SkillsPage host component", pattern: boundary("SkillsPage") },
    ],
    paths: [
      "packages/ui/src/plugin-skills.ts",
      "packages/ui/src/skills",
    ],
  },
  {
    id: "catalog",
    enforced: true,
    todo: null,
    text: [
      { label: "agentTools platform-adapter key", pattern: boundary("agentTools") },
      { label: "AgentToolsAdapter platform type", pattern: boundary("AgentToolsAdapter") },
      { label: "AgentToolInventory shape type", pattern: boundary("AgentToolInventory") },
      { label: "AgentToolSchemaView shape type", pattern: boundary("AgentToolSchemaView") },
      { label: "AgentToolSourceView shape type", pattern: boundary("AgentToolSourceView") },
      { label: "AgentToolSourceKind shape type", pattern: boundary("AgentToolSourceKind") },
      { label: "ToolsPage host component", pattern: boundary("ToolsPage") },
      { label: "AgentCapabilitiesPage host component", pattern: boundary("AgentCapabilitiesPage") },
      { label: "DshAgentCapabilitiesPage host component", pattern: boundary("DshAgentCapabilitiesPage") },
      { label: "toolActivitySource dead threading", pattern: boundary("toolActivitySource") },
      { label: "amibaTools DSH remote namespace", pattern: /amibaTools/u },
    ],
    paths: [
      "packages/ui/src/plugin-tools.ts",
      "packages/ui/src/usage/AgentCapabilitiesPage.tsx",
      "packages/ui/src/usage/ToolsPage.tsx",
      "packages/ui/src/usage/DshAgentCapabilitiesPage.tsx",
    ],
  },
  {
    id: "mcp",
    enforced: true,
    text: [
      { label: "agentMcp platform-adapter key", pattern: boundary("agentMcp") },
      { label: "AgentMcpAdapter platform type", pattern: boundary("AgentMcpAdapter") },
      { label: "McpToolsTab host component", pattern: boundary("McpToolsTab") },
      { label: "DshMcpToolsTab host component", pattern: boundary("DshMcpToolsTab") },
      { label: "amibaMcp DSH remote namespace", pattern: /amibaMcp/u },
    ],
    paths: [
      "packages/ui/src/plugin-mcp.ts",
      "packages/ui/src/settings/McpToolsTab.tsx",
      "packages/ui/src/settings/DshMcpToolsTab.tsx",
    ],
  },
  {
    id: "messaging",
    enforced: true,
    text: [
      { label: "agentMessages platform-adapter key", pattern: boundary("agentMessages") },
      { label: "AgentMessagesAdapter platform type", pattern: boundary("AgentMessagesAdapter") },
      { label: "AgentMessageCenterSnapshot shape type", pattern: boundary("AgentMessageCenterSnapshot") },
      { label: "DshSettingsMessaging host component", pattern: boundary("DshSettingsMessaging") },
      { label: "amibaMessaging DSH remote namespace", pattern: /amibaMessaging/u },
    ],
    paths: [
      "packages/ui/src/plugin-messaging.ts",
      "packages/ui/src/settings/DshSettingsMessaging.tsx",
    ],
  },
  {
    id: "schedules",
    enforced: true,
    text: [
      { label: "agentSchedules platform-adapter key", pattern: boundary("agentSchedules") },
      { label: "AgentSchedulesAdapter platform type", pattern: boundary("AgentSchedulesAdapter") },
      { label: "AgentScheduleView shape type", pattern: boundary("AgentScheduleView") },
      { label: "AgentScheduleCreateInput shape type", pattern: boundary("AgentScheduleCreateInput") },
      { label: "DshScheduledTasksPage host component", pattern: boundary("DshScheduledTasksPage") },
      { label: "ScheduledTasksPage host component", pattern: boundary("ScheduledTasksPage") },
      { label: "useScheduledRuns host hook", pattern: boundary("useScheduledRuns") },
      { label: "amibaSchedules DSH remote namespace", pattern: /amibaSchedules/u },
    ],
    paths: [
      "packages/ui/src/plugin-schedule.ts",
      "packages/ui/src/chat/DshScheduledTasksPage.tsx",
      "packages/ui/src/chat/ScheduledTasksPage.tsx",
      "packages/ui/src/chat/internal/useScheduledRuns.tsx",
    ],
  },
  {
    id: "usage",
    enforced: true,
    text: [
      { label: "agentUsage platform-adapter key", pattern: boundary("agentUsage") },
      { label: "AgentUsageAdapter platform type", pattern: boundary("AgentUsageAdapter") },
      { label: "AgentUsageRecord shape type", pattern: boundary("AgentUsageRecord") },
      { label: "TokensPage host component", pattern: boundary("TokensPage") },
      { label: "TokensTab host component", pattern: boundary("TokensTab") },
      { label: "amibaUsage DSH remote namespace", pattern: /amibaUsage/u },
    ],
    paths: [
      "packages/ui/src/usage/TokensPage.tsx",
      "packages/ui/src/usage/TokensTab.tsx",
      "packages/ui/src/usage/token-usage.ts",
    ],
  },
  {
    id: "tool-metering",
    enforced: true,
    text: [
      { label: "toolActivity IPC/preload surface", pattern: boundary("toolActivity") },
      { label: "tool-activity IPC channel prefix", pattern: /tool-activity:/u },
      { label: "ToolsActivityTab host component", pattern: boundary("ToolsActivityTab") },
    ],
    paths: [
      "apps/desktop/src/main/tool-activity.ts",
      "packages/app-runtime/src/core/tool-activity.ts",
      "packages/ui/src/usage/ToolsActivityTab.tsx",
    ],
  },
];

async function run() {
  const files = await collectSourceFiles();
  const contents = new Map();
  for (const file of files) {
    contents.set(file, await readFile(file, "utf8"));
  }

  const enforcedViolations = [];
  const informationalViolations = [];

  for (const module of MODULES) {
    const moduleViolations = [];

    for (const [file, body] of contents) {
      for (const check of module.text) {
        if (check.pattern.test(body)) {
          moduleViolations.push({
            module: module.id,
            rule: check.label,
            location: path.relative(root, file),
          });
        }
        // RegExp with the `g` flag would carry lastIndex state across
        // files; none of the patterns above use `g`, but reset defensively
        // in case a future pattern does.
        check.pattern.lastIndex = 0;
      }
    }

    for (const relative of module.paths) {
      if (await exists(relative)) {
        moduleViolations.push({
          module: module.id,
          rule: "host-owned path must not exist",
          location: relative,
        });
      }
    }

    if (moduleViolations.length === 0) continue;
    if (module.enforced) enforcedViolations.push(...moduleViolations);
    else informationalViolations.push(...moduleViolations);
  }

  if (informationalViolations.length > 0) {
    console.log(
      `[pull-the-plugin] ${informationalViolations.length} known, expected reference(s) in modules still mid-migration (enforced: false) - not a failure:`,
    );
    const byModule = new Map();
    for (const violation of informationalViolations) {
      if (!byModule.has(violation.module)) byModule.set(violation.module, []);
      byModule.get(violation.module).push(violation);
    }
    for (const [moduleId, violations] of byModule) {
      const module = MODULES.find((candidate) => candidate.id === moduleId);
      console.log(`  - ${moduleId} (${violations.length} reference(s)) - ${module.todo}`);
    }
  }

  if (enforcedViolations.length > 0) {
    console.error(
      `[pull-the-plugin] ${enforcedViolations.length} violation(s) in enforced modules:`,
    );
    for (const violation of enforcedViolations) {
      console.error(`  [${violation.module}] ${violation.rule} - ${violation.location}`);
    }
    throw new Error(
      "pull-the-plugin verification failed: an enforced module still leaks into packages/ or apps/. " +
        "See violations above; either the module surgery is incomplete or this pattern list needs correcting.",
    );
  }

  const strictNote = strictI18n ? " (including i18n bundles, --strict-i18n)" : "";
  const clean = MODULES.filter((module) => module.enforced).map((module) => module.id);
  const pending = MODULES.filter((module) => !module.enforced).map((module) => module.id);
  console.log(
    `[pull-the-plugin] verified ${files.length} source files across ${SCAN_ROOTS.join(", ")}${strictNote}: ` +
      `${clean.join(", ")} are clean` +
      (pending.length ? `; ${pending.join(", ")} remain mid-migration.` : "."),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
