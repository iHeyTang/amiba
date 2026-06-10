name: {{NAME}}
version: 0.1.0
description: {{DESCRIPTION}}

# Each entry becomes an @-mention type in the composer.
#  - `fields`    must match the keys your search items put in `payload`.
#  - `serialize` is the line inserted into the message when the user picks a
#                candidate — the self-describing handle the agent later resolves.
mention_resources:
  - type: thing
    label: {{NAME}} thing
    icon: {{NAME}}-thing
    fields: [id, title]
    serialize: "[{{NAME}}] {title} (id={id})"

# The agent-side skill that turns a picked handle into a read/action.
resolver_skill: skills/resolve.md

# External commands this source needs at runtime (optional, informational).
requires:
  binaries: []
