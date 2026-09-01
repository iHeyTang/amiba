import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * One seed = one preset directory (`<root>/<id>/`) and the files it needs,
 * keyed by filename relative to that directory. Content is embedded as
 * string constants in this module — never read from the vendored DSH tree at
 * runtime, so a deployment upgrade to that tree cannot change what gets
 * seeded underneath a user who already has a `restricted` preset of their
 * own.
 */
export interface PresetSeed {
  id: string;
  files: Record<string, string>;
}

// Derived from the shipped `standard` preset
// (packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml)
// by deleting every row/group that grants shell, filesystem, background-job,
// or delegation capability. Everything else — persona, planning, compaction,
// skills, goal, ask-user, todo, and the read-only web tool — is copied
// verbatim, including `standard`'s exact `isolate`/`disabled` structure and
// `tool-web` config (`fetch: false`).
const RESTRICTED_AGENT_CORDIS_YML = "# The `restricted` agent preset: seeded for IM-originated sessions by Amiba\n# connector-core (plugins/dsh-plugin-connector-core/src/preset-seed.ts) at\n# apply time, create-only — if this directory already exists the seeder never\n# overwrites it, so any edit made here is preserved across restarts.\n#\n# Derived from the shipped `standard` preset by deleting every row/group that\n# grants shell access, filesystem access, background-job control, or\n# delegation (the whole subagent/workflow/sub-loop group). A session mounting\n# `restricted` keeps `standard`'s persona, planning, compaction, skills, goal,\n# ask-user, todo, and read-only web rows — it gets no terminal, no file\n# writes, and cannot spawn other agents.\n#\n# This file is an AGENT-PLANE composition. The roster mounts it ONCE under a\n# standing scope; every session naming it joins by scope parentage, so the\n# tools and prompt sections registered here cover each joined agent while a\n# session's own state stays keyed per Session/Agent inside the plugins. The\n# host composition (`base.cordis.yml` + `web.cordis.yml`) keeps everything a\n# preset must not own: the registries themselves, the sandbox and approval\n# stack, persistence, and the model route.\n#\n# A service row here MUST sit inside a group carrying an `isolate` realm.\n# Without one it publishes into the root realm, where it is process-global —\n# another preset publishing the same name collides, and a host reader would\n# resolve one preset's instance for every session; `dsh-agent-presets` rejects\n# that at mount. `true` means an entry-local realm: this standing mount's own\n# private instance, apart from every other preset's. (A shared label does NOT\n# pool instances — `provide()` throws on the second registration under the\n# same realm symbol; labels join REALMS, and are not what this file needs.)\n\n# ── identity ────────────────────────────────────────────────────────────────\n\n# The preset's own persona, shadowing the deployment default for this agent.\n# `{{model}}` and `{{cwd}}` resolve from the agent's own route and workspace.\n- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: >-\n      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.\n\n- id: agent-instructions\n  name: '@deepseek-ai/dsh-agent-instructions'\n  config:\n    maxBytes: 65536\n\n# ── skills ──────────────────────────────────────────────────────────────────\n\n# The skill REGISTRY lives in the host composition and is layered per scope:\n# these rows register into THIS preset's layer of it, so they need no realm.\n# `skill-filesystem` contributes local-root discovery for agents on this preset, and\n# `tool-skill` gives them the catalog and loader; the merged catalog also\n# carries whatever the deployment registered globally (repository plugins).\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n\n# ── goals ───────────────────────────────────────────────────────────────────\n\n# Only the model-facing tool. The goal SERVICE, its session driver, and the\n# `/goal` command stay on the host plane: the Gateway serves the goal domain as\n# Remote endpoints whose receiver comes from a generated descriptor, so it\n# resolves `goals` on the host and an entry-local realm here would hide it. The\n# registry is keyed by session anyway, so one host instance serves every\n# session. What a preset chooses is whether its agent can call the goal tool.\n- id: tool-goal\n  name: '@deepseek-ai/dsh-tool-goal'\n\n# ── plan mode ───────────────────────────────────────────────────────────────\n\n# Plan state is per-agent by nature, so an entry-local realm is not a\n# workaround here — it is the correct lifetime.\n- id: planning\n  name: cordis:group\n  group: true\n  isolate:\n    planMode: true\n  config:\n    - id: plan-mode\n      name: '@deepseek-ai/dsh-plan-mode'\n      config:\n        section: |\n              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.\n\n              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.\n\n              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.\n\n              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.\n\n              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.\n\n              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask \"should I proceed?\" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.\n\n# ── compaction ──────────────────────────────────────────────────────────────\n\n# `compaction-basic` reads `toolResultPrune` through `ctx.get`, so the pruner must\n# share this realm rather than sit outside it.\n#\n# `tokenMeter` is deliberately NOT in this realm: the meter stays on the HOST\n# plane, and the rows here resolve that one instance. It takes no configuration,\n# keys every fold by Session, and owns the context-meter projection units the\n# browser reads for every session — behind a realm those units would come and go\n# with whichever presets happen to be mounted. What a preset chooses is whether\n# its agent compacts at all, which is `compaction-basic` below.\n- id: compaction\n  name: cordis:group\n  group: true\n  isolate:\n    compaction: true\n    toolResultPruner: true\n  config:\n    - id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'\n\n    - id: command-compact\n      name: '@deepseek-ai/dsh-command-compact'\n\n    - id: tool-result-pruner\n      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'\n      config:\n        thresholdChars: 8192\n        headChars: 4096\n        tailChars: 1024\n\n# ── remaining model-facing rows ─────────────────────────────────────────────\n\n- id: tool-ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'\n\n- id: tool-todo\n  name: '@deepseek-ai/dsh-tool-todo'\n  config:\n    allowParallelInProgress: true\n\n# The `web` service and its search provider stay in the host composition; only\n# the model-facing tool is per-session.\n- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: false\n    searchTimeoutMs: 60000\n";

const RESTRICTED_PRESET_YML = "name: 受限（IM）\ndescription: IM 渠道会话的受限预设：无终端、无文件写入、无子代理；仅规划/技能/只读网页等安全能力。Seeded by Amiba connector-core; edits are preserved.\norder: 10\n";

/**
 * The restricted IM agent preset. Mounted by name (`"restricted"`) whenever
 * an IM-originated session is created; connector-core seeds this composition
 * into the writable roster root so the mount resolves instead of falling
 * back to an unrestricted session with a warning.
 */
export const RESTRICTED_PRESET: PresetSeed = {
  id: "restricted",
  files: {
    "agent.cordis.yml": RESTRICTED_AGENT_CORDIS_YML,
    "preset.yml": RESTRICTED_PRESET_YML,
  },
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Idempotent, create-only seeding of the given presets into `root`
 * (the writable roster root, e.g. `<dshHome>/.agent-presets`).
 *
 * For each seed: if `<root>/<id>` already exists — in any form, even a
 * broken or hand-edited one — it is left untouched, because a user's own
 * copy is authoritative. Otherwise the directory is created and its files
 * are written. A seeding failure (I/O error, root path unusable, ...) is
 * caught and logged as a warning; it must never abort the caller, since this
 * runs during plugin `apply()` and one preset failing to seed must not
 * prevent the rest of the plugin — or any other seed in this same call —
 * from starting.
 */
export async function seedAgentPresets(
  root: string,
  seeds: PresetSeed[],
  log: { info?(msg: string): void; warn(msg: string): void },
): Promise<void> {
  for (const seed of seeds) {
    try {
      const dir = join(root, seed.id);
      if (await pathExists(dir)) continue;
      await mkdir(dir, { recursive: true });
      for (const [filename, content] of Object.entries(seed.files)) {
        await writeFile(join(dir, filename), content, "utf8");
      }
      log.info?.(`seeded agent preset "${seed.id}" into ${root}`);
    } catch (error) {
      log.warn(
        `failed to seed agent preset "${seed.id}" into ${root}: ${String(error)}`,
      );
    }
  }
}
