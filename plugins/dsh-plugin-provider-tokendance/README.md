# TokenDance provider for DeepSeek Harness

One standard Cordis/DSH provider plugin, with no Amiba registration or UI dependency.
It advertises `tokendance` in the configurable directory while dormant, registers its route
through `ctx.llm.registerAdapter` only after a profile is saved, and declares its configuration
through `registerConfigurableProviders` and `ctx.settings`, and resolves API keys through
`ctx.credentials`. Amiba's desktop distribution includes it through the core bundle.
The direct DeepSeek provider remains the official `dsh-llm-deepseek` plugin.

## Use

Install this package alongside DSH **0.1.1-rc.2** and add:

```yaml
- name: '@amiba/dsh-plugin-provider-tokendance'
```

In Amiba, open **Settings → Models & services → TokenDance**, enter the API key,
then select a TokenDance model. Credential values never enter the settings document.
The credential reference defaults to `TOKENDANCE_API_KEY`.

A single public route supports OpenAI Chat Completions, OpenAI Responses, and
Anthropic Messages. The plugin supplies a mixed-protocol pi-ai provider to the official
exported `PiAiAdapter`, reusing its stream conversion, tool calls, replay, image handling,
attribution and call-generation freezing. No DSH patch or package-private import is used.

## Model directory and overrides

The public `https://tokendance.space/gateway/v1/models` directory supplies model IDs,
`context_length` and `supported_protocols`. A shipped snapshot from **2026-09-08** keeps
64 supported chat models available offline for configured routes. With no profile, the
plugin registers no route and performs no directory request. Startup refresh and the official model
discovery interface refresh this catalog in memory, retaining the previous generation
on failure. Unsupported image/video/audio-only models are omitted.

When multiple supported protocols are advertised, the default preference is Chat
Completions, Responses, then Messages. An explicit model override can select another
advertised protocol. Verified reasoning contracts can prefer a protocol (currently
Flash 0731 prefers Responses); explicit protocol overrides always win. An unknown
manual model must name its protocol.

```yaml
llm-tokendance:
  providers:
    tokendance:
      apiKeyEnv: TOKENDANCE_API_KEY
      baseURL: https://tokendance.space/gateway
      refreshCatalog: true
      models:
        - id: YOUR_MODEL_ID
          api: anthropic-messages
          contextWindow: 200000
```

Deleting `providers.tokendance` unregisters the route while retaining its configurable
directory entry, matching the official pi-ai provider lifecycle. Credential presence is
checked separately, as in the official provider.

An empty `models` list uses the public catalog. A nonempty list replaces the visible
catalog with those configured models, inheriting known metadata where omitted. Each
row can override `api`, its SDK `baseURL`, input modalities, capacities and explicit
`reasoningEfforts` wire mappings. Protocol validation rejects a choice contradicting
the current TokenDance catalog. Model IDs remain exact upstream IDs.

The gateway root is normalized once: OpenAI SDKs receive `/gateway/v1`; Anthropic
receives `/gateway` and appends `/v1/messages`. Per-model `baseURL` is an exact SDK base.

The directory does not generally expose image/reasoning/output-cap details. The plugin
does not infer these from model names: text-only/no selectable reasoning is the fallback;
unknown capacities use the same 262144/32768 defaults as DSH pi-ai. Configure verified
capabilities when needed.

Verified reasoning contracts (2026-09-10), applied to both live and offline catalogs:

| Exact model ID | Protocol | Selectable effort → wire value |
| --- | --- | --- |
| `kimi-k3` | Chat Completions | `low`, `high`, `max` → same top-level `reasoning_effort` |
| `deepseek-v4-flash-0731` | Responses | `off` → `reasoning.effort: none`; `high` → `reasoning.effort: high` |

Sources: [TokenDance Kimi guide](https://tokendance.space/docs/kimi-thinking-models.md),
[Kimi effort contract](https://platform.kimi.com/docs/guide/use-reasoning-effort), and
[TokenDance's official Responses catalog](https://au-tokendance.tos-cn-shanghai.volces.com/public/models.json)
linked by its [Codex guide](https://tokendance.space/docs/codex).
No prefix matching or inference across protocols is used. An explicit
`reasoningEfforts` mapping replaces the built-in mapping; `false` disables it.
Unknown models and alternate protocols retain provider-default behavior unless
explicitly configured. Kimi K3 does not offer Off. These mappings have local HTTP
request/streaming regression coverage, not authenticated gateway verification.

Google-native and non-chat protocols are not implemented.
API-key authentication is supported; TokenDance's optional OAuth key-creation flow is
not part of this plugin.

## Compatibility and verification

Official DSH's model picker sees one provider. Its stock settings UI currently has
handwritten editors for `llm-deepseek` and `llm-pi-ai`; it can discover this plugin's
settings address but does not render this custom schema fully. Amiba's schema-driven
editor does. Any other client can use the same official settings/credentials APIs.

Run `pnpm --filter @amiba/dsh-plugin-provider-tokendance test` and `build`.
Tests cover protocol selection, endpoint normalization, standard registration and
local HTTP streaming over all three protocols. No paid TokenDance call is made by
these tests. The package pins pi-ai 0.82.1 to match the bundled DSH adapter.

Sources: [integration guide](https://tokendance.space/docs/ai-integration.md),
[protocol directory](https://tokendance.space/docs/multi-protocol.md),
[live model directory](https://tokendance.space/gateway/v1/models).

## Optional Amiba media execution

When `@amiba/dsh-plugin-media` is installed, a configured TokenDance profile also registers a media adapter through the optional `amibaMedia` service. No second key or base URL is required. Deleting the profile or unloading media unregisters this capability; chat-only installations remain supported.

Media discovery is separate from the chat catalog filtering described above. It supports OpenAI/Ark image generation, Seedance/MiniMax v2/Kling/Wan/HappyHorse video tasks, MiniMax JSON/SSE speech, and Ark SSE TTS. Executable models are the intersection of the live directory and versioned parameter contracts in this plugin’s `src/media/model-contracts.ts`. Unknown models remain inventory-only. Supported native fields are validated before submission; defaults prefer complete base64 image / hex audio delivery. Unverified advanced fields fail locally. Agents receive contracts rather than researching protocol documentation.

See [media generation](../../docs/media-generation.md) for defaults, task recovery, previews, asset reuse, validation scope and first-version limitations. No real paid TokenDance media call has been made during development verification.

### Maintaining media model rules

This plugin owns `src/media/model-contracts.ts` and its boundary tests, including models routed through TokenDance from other vendors. To update a model, review the TokenDance protocol documentation, update its rule and contract version, and test its defaults and parameter combinations here. No other provider or shared media package needs a model-specific change.

The contracts describe the currently supported integration surface, not all upstream features. See [model coverage](MEDIA-COVERAGE.md) for the 23 catalog models, special parameters, partial-image recovery and remaining limitations. Seedream supports model-specific sizes, references, groups or layers where documented.

Rule sources (reviewed 2026-09-09):
- https://tokendance.space/docs/ark-image-generations.md
- https://tokendance.space/docs/protocol-seedance-generations.md
- https://tokendance.space/docs/protocol-ark-tts.md
- https://tokendance.space/docs/protocol-minimax-t2a-v2.md
- https://tokendance.space/docs/protocol-minimax-video-generation-v2.md
