# @amiba/dsh-plugin-vision

Assignable vision capability for Amiba. A model that cannot accept images is no
longer a dead end: DSH replaces the image bytes with a placeholder, and this
plugin reads the image through a model that *can* see.

## What it adds

| Surface | Contribution |
| --- | --- |
| Tool | `vision_recognize` — read one image with the assigned vision model and return its text |
| Settings | One **Vision** row in Settings → Model services → Model assignment (the `amiba.models.extension` slot, alongside the media capability's four rows) |
| Remote | `amibaVisionUi.catalog` / `amibaVisionUi.setDefault` for the assignment UI |
| Prompt | A short instruction telling the agent to hand images it cannot read to this tool |

The candidate list is **derived, never maintained by hand**: only models whose
own catalog entry declares `image` among its input modalities can be assigned.
`deepseek-v4-pro` therefore never appears, while a model that gains vision
upstream appears without an Amiba change. `Let the Agent choose` (the default)
picks the first advertised route at call time.

## Why the prompt text is not the interface

`vision_recognize` takes a **path**. For that to be possible, two DSH behaviours
are patched in this repository (see `patches/`):

1. `dsh-api-session-controller` no longer refuses an image attachment when the
   selected model is text-only. Refusing it removed the user's only way to
   attach the image; the request layer already projects the bytes to text.
2. `dsh-llm` now names the image's **read-only normalized path** in that
   text-only placeholder, mirroring what it already does for durable files
   (`fileReadPath`). Without it the agent would know an image exists but have no
   way to reach it.

Both are candidates for an upstream pull request; until then they ride the
repository's reviewed patch set.

## Flow

```
user attaches an image
  → the text-only main model receives: [image omitted because this model accepts
    text only; attachment sha256:xxxxxxxx] Normalized copy (read-only): "/…/image.png" …
  → the agent calls vision_recognize({ image: "/…/image.png", prompt: "…" })
  → the plugin saves the bytes as a durable attachment and streams one
    image + text message to the assigned vision model
  → the description returns as tool output; the image never enters the main
    model's context
```

## Testing

```
pnpm --filter @amiba/dsh-plugin-vision typecheck
pnpm --filter @amiba/dsh-plugin-vision test
```
