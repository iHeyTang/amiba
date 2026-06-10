# {{NAME}} — amiba mention source

{{DESCRIPTION}}

A **mention source**: it lets the amiba desktop composer `@`-mention
{{NAME}} resources. It is NOT a hermes plugin — it only feeds the composer's
@-mention discovery (search) and ships a resolver skill so the agent can act on
what you picked.

## Files

| File | Purpose |
|---|---|
| `source.py` | implement `async search(rtype, query, limit) -> {ok, items}` |
| `mention-source.yaml` | declare the `@` types + `fields` + `serialize` templates |
| `skills/resolve.md` | teach the agent to act on a picked handle |
| `__init__.py` | re-exports `search` (the loader grabs it) |

The `search` items' `payload` keys must be a superset of the manifest's
`fields`; `serialize` interpolates them into the handle inserted on pick.

## Install (maintained as a git repo)

```bash
# local dev — install the working copy into a running backplane:
curl -XPOST 127.0.0.1:9394/hermes/mention-sources \
  -d '{"from_path":"'$PWD'","name":"{{NAME}}"}'

# or publish this repo and install by URL (updates via git pull):
curl -XPOST 127.0.0.1:9394/hermes/mention-sources \
  -d '{"from_git":"<this repo url>"}'
```

Verify: `curl 127.0.0.1:9394/hermes/mention-resources` should list
`{{NAME}}.thing`, and `curl '127.0.0.1:9394/mention-sources/{{NAME}}/search?type=thing&q=test'`
should return items.

Author: {{AUTHOR}}
