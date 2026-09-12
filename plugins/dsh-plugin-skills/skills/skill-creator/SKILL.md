---
name: skill-creator
description: Create, improve, or troubleshoot reusable Agent Skills in Amiba. Use when authoring SKILL.md instructions or connector-specific workflows, choosing supporting resources, or validating skill discovery and behavior; not for ordinary use of an existing connection.
metadata:
  short-description: 创建、改进和验证技能
  upstream: openai/codex
---

# Skill Creator for Amiba

Based on OpenAI's Apache-2.0 skill-creator. Read [the upstream authoring guide](references/upstream-skill-creator.md) when creating or substantially redesigning a skill. Apply the Amiba integration rules below where Codex-specific paths, metadata, or tooling differ. The source revision and license are in `NOTICE` and `license.txt`.

## Start from the task

Identify the intended requests, the environment's actual tools, and the observable outcome. Ask only for missing information that affects the result. Do not expand authorization just because a skill can automate an action.

Assume the agent is capable. Include non-obvious operational guidance, concrete decision criteria, and verified examples; avoid generic tutorials and exhaustive tool catalogs. Keep the description precise enough for discovery. Put large or conditional detail in linked references and load it only when relevant.

For a connection or CLI-backed skill, read [connector authoring rules](references/amiba-connectors.md) before writing instructions. That reference covers account binding, supported capabilities, error diagnosis, regeneration, and behavioral checks. For other skills, skip it.

## Write for this runtime

- The required artifact is a directory with `SKILL.md`, containing YAML `name` and `description` plus the instruction body. Use a lowercase kebab-case name under 64 characters. Match its directory name.
- The skill's resource base is supplied when it is loaded. Resolve `references/`, `scripts/`, and `assets/` relative to that base, not the user's working directory.
- For a user-owned skill, use the configured user skill root shown in Settings → Skills, normally `$DSH_HOME/skills`. Respect an explicitly requested project location. Do not default to a Codex directory or modify this bundled skill's installed files.
- Bundled skills belong to their plugin package; generated connection skills belong to that connection. A skill's apparent filesystem location does not make it user-owned. Preserve user-authored resources and distinguish them from regenerable artifacts.
- DSH reads invocation policy from `user-invocable` and `disable-model-invocation` in frontmatter. Omission enables both user and model use. Do not add Codex-only invocation policy to `agents/openai.yaml` and assume DSH enforces it. OpenAI UI metadata is optional interoperability data.
- Serialize frontmatter with a YAML library or JSON-quote scalar strings. Descriptions with `provider: lark`, quotes, multiline account names, `#`, or non-ASCII text must survive a parse round trip. Never interpolate unescaped text into YAML.
- Write only resources the workflow uses. References must exist and be linked. Scripts need explicit inputs, useful errors, and a reproducible invocation in the target environment.

The upstream Python initializer and helpers are included under `scripts/`. They require Python and, for validation/metadata, PyYAML. Use them if available and useful; their default Codex metadata is not required by Amiba. Do not install extra dependencies just to run a scaffold when a short, valid document is sufficient.

## Validate before calling it ready

Use the Amiba validator, which exercises the installed DSH filesystem loader:

```bash
node <skill-creator-resource-base>/scripts/validate_dsh.mjs <skill-directory>
```

Use the host's Node runtime if `node` is not available in the shell. A successful parse is only structural validation; it does not prove the instructions are effective or the external permissions are sufficient.

For a substantive workflow, test a realistic request with the actual available tool or CLI. Include an appropriate negative case, such as no search results or a denied resource. Keep writes within the user's authorization. State what was tested and what remains unverified; never label guessed commands or an unexecuted workflow as validated.

After installation or saving, verify that DSH lists and can load the skill, its intended invocation policy is active, and referenced resources are readable. If a user skill overrides a bundled skill with the same name, identify the winning source instead of overwriting the user's work. Improve instructions from observed failures rather than adding broad rules for hypothetical cases.
