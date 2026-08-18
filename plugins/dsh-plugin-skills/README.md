# @amiba/dsh-plugin-skills

Amiba's dual-face DSH plugin for skill management.

The Host face reads the official `ctx.skills` registry, persists only user-authored
`SKILL.md` bundles under the configured DSH skill root, and exposes that authoring
surface through a Typert Remote. The Client face registers the existing Amiba skill
library as one `amiba.settings.section` contribution. Discovery, precedence,
workspace scope, invocation policy, and model loading remain owned by the official
`@deepseek-ai/dsh-skill` and `dsh-skill-filesystem` plugins.
