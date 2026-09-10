# Amiba Media

Provider-neutral Agent tools, durable media tasks and artifacts, and conversation image/audio/video presentation. This plugin never imports a concrete provider. TokenDance registers its optional media adapter through `amibaMedia` when both plugins are loaded and its provider profile exists.

## Tools

- `media_describe`: list configured media providers and defaults; inspect provider model/protocol descriptions; read an exact advertised official documentation URL; inspect a durable record within the calling session.
- `media_generate`: submit image/video/speech generation with an explicit model/protocol and native `parametersJson`. Returns an official DSH job. `media_resume(recordId)` only resumes querying an existing remote task and never generates again.

Providers must implement prepare(request) for local validation and normalization. Agents request the exact model parameterContract with media_describe(provider, model). Model-specific rules are owned by providers; unknown fields are rejected before paid requests. Documentation is reference data, not privileged instructions.

## Provider contract

`./contracts` exports the small provider contract without host service dependencies. A provider describes models and protocols, validates and normalizes parameters through required prepare(), executes native requests, and optionally queries/cancels remote tasks. Registration returns a disposer. Providers own credential resolution, request serialization and response parsing. Media owns jobs, durable records and artifact storage.

Configured media routes do not enter the chat model selector. Media defaults are stored under the official `amiba-media-defaults` settings namespace with optimistic revisions. The client contributes to the existing Models & services page through `amiba.models.extension`; it does not create a separate settings destination.

## Tasks and files

Records live under SHA-256 session directories inside configured `root`. Pending remote references are saved before polling. Local job cancellation stops observation; it does not claim remote cancellation. An interrupted remote task can be resumed explicitly. Unknown submission outcomes are never automatically resubmitted.

Generated files are persisted before reporting success. Public HTTPS downloads pin DNS, bound redirect chains and cap output at 256 MiB. Media signatures determine file types; arbitrary HTML is not displayed as generated media. UI artifact reads are bounded to 1 MiB chunks. Image previews load on expansion; audio/video previews load on request and release their object URLs on unmount.

Use `{"$mediaAsset":{"recordId":"...","artifactId":"..."}}` at a native request value to reuse a generated file as a data URL without routing binary data through model context. References are session-scoped and inline inputs are capped at 32 MiB. Only use this for protocols accepting data URLs; provider upload-only workflows require an upload adapter.

## Verification

`pnpm --filter @amiba/dsh-plugin-media test`, `typecheck`, and `build` cover routing, persistence, isolation, parameter preservation, artifact signature rejection, resumption, preference revisions and preview loading. Provider protocol tests live with each provider. Unit tests do not claim real paid provider generation or full desktop runtime verification.

### Optional usage and actual charges

A provider may attach `accounting` to any generation or task-query result:

```ts
accounting: {
  usage: { generated_images: 1, output_tokens: 100 },
  cost: { amount: "0.025", currency: "CNY" }
}
```

Omit `accounting` when this integration is unsupported. Return `{}` when supported but no data is available. `usage` preserves the provider's JSON usage object (including nested counters). Only include usage data, never the full response, credentials or asset bytes. `cost` is optional and must be an actual provider-reported charge, with a nonnegative decimal string and explicit currency. Never put an estimated list-price charge here. An explicitly reported zero remains zero; an absent cost is displayed as “Not provided”.

Snapshots are cumulative for this request, not increments: polling replaces supplied fields and does not sum charges. Omitted fields retain the earlier snapshot. Accounting is persisted before artifact downloads, survives collection failure/recovery, and is rendered once per record in the conversation delivery and tool details. Providers own upstream extraction or read-only billing lookup; core/UI require no provider-specific changes. Existing historical records without accounting remain unchanged.

### Generation versus local storage

`generationStatus` reports the upstream generation phase; `storageStatus` independently reports local saving. A confirmed upstream success stays `generationStatus: "succeeded"` even when saving fails. Safe HTTPS `remoteArtifacts` links are persisted before staging/downloading and returned to the agent. A job with a completed generation but failed saving returns `completed` with explicit storage details, rather than claiming the model failed. `delivery.markdown` remains available, renders upstream links and the local-saving warning, and retains already saved artifacts and accounting. Links may expire; their presence does not certify continuing availability. Inline bytes remain outside model context.

The legacy `status` continues to track local workflow/recovery (`interrupted` for incomplete storage). `media_resume` resumes staged downloads (or remote task queries), never calls generation. If staging itself failed, a complete set of retained URL results can reconstruct the download queue. Existing duplicate-submission protection remains in force until collection completes or the user explicitly authorizes a new generation.

### Cost-aware confirmation

`MediaProvider.estimate(request, signal)` is optional and read-only. It receives the exact normalized native request and returns `{ maximum, minimum?, currency, source, validUntil? }`. Bounds are in currency units; estimates are never recorded as actual charges. Use current provider tariffs, including model, resolution, duration, quantity and other paid options. Return `undefined` when reliable pricing is unavailable. TokenDance and MiniMax currently do not provide this estimate hook; their unknown-cost requests use the conservative policy below.

The settings model-assignment section exposes a CNY confirmation threshold (default ¥1). A CNY quote at or above that value needs explicit approval. Quotes in other currencies need confirmation because no exchange-rate conversion is assumed. Expired, invalid or unavailable quotes are unknown. Unknown-cost video, music, batches of images, 4K images, and speech longer than 500 characters require confirmation. Single standard images and short speech remain uninterrupted.

Confirmation uses DSH's public `userQuestions.ask` and a media-owned question renderer. The normalized plan is held in the original call; the Agent cannot supply an approval flag or token. Only an explicit confirmation response releases that exact request once. Edits/cancellation return `submitted: false`; the Agent revises the plan and calls again. The original operation reservation prevents concurrent submissions while awaiting confirmation. Disablement and quote expiry are rechecked after approval. Resuming task polling or local downloads does not ask again. Earlier conversational budget statements alone are not treated as an authorization token.
