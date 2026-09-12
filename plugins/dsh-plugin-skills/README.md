# @amiba/dsh-plugin-skills

Amiba's dual-face DSH plugin for skill management.

The Host face reads the official `ctx.skills` registry, persists only user-authored
`SKILL.md` bundles under the configured DSH skill root, and exposes that authoring
surface through a Typert Remote. The Client face registers the existing Amiba skill
library as one `settings.section` contribution. Discovery, precedence,
workspace scope, invocation policy, and model loading remain owned by the official
`@deepseek-ai/dsh-skill` and `dsh-skill-filesystem` plugins.

The package also ships an Amiba adaptation of OpenAI Codex's Apache-2.0
`skill-creator`. Its pinned source, original guide, Python helpers and license
live under `skills/skill-creator`; the Amiba entrypoint adds DSH-specific paths,
connector authoring rules and a validator using the real DSH loader. The official
filesystem provider registers it as `bundled`, without writing into user skills.
Users can load `skill-creator` to create or improve a skill. Connector provisioning
stays deterministic; merely installing this guide does not trigger an LLM call
or prove an external workflow works. Validate structure, discovery and actual
authorized behavior separately.

Authoring now parses YAML before publishing a document. A malformed header is
reported at save time, rather than saved and silently omitted from discovery.
