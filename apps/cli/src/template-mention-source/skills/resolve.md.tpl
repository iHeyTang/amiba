---
name: {{NAME}}-resolve
description: >
  Resolve {{NAME}} handles that appear in a message — "[{{NAME}}] <title>
  (id=<id>)" — into the resource's content or into an action.
when_to_use: >
  The user's message contains a "[{{NAME}}] … (id=…)" handle AND the task needs
  that resource's content or an action against it.
---

# Resolving {{NAME}} handles

{{NAME}} resources mentioned in a message arrive as **self-describing reference
lines**, not inlined content: `[{{NAME}}] <title> (id=<id>)`. Resolve them on
demand using the `<id>`.

## How to resolve

<!-- TODO: describe how the agent acts on the id. Prefer an EXISTING hermes
     plugin / skill / MCP server if one already covers {{NAME}}; otherwise call
     your CLI or HTTP API. Example: -->

- Read it:  `your-cli read --id "<id>" --format json`
- Act on it: `your-cli ... --id "<id>"`

## Notes

- Resolve lazily: if the task only needs the title (already in the handle),
  don't fetch the body.
- Degrade gracefully: if resolution fails, tell the user what you'd need —
  don't invent contents.
- This skill is the bridge from a mention handle to an action; the actual
  read/write capability should live in a tool/CLI/MCP, not be reimplemented here.
