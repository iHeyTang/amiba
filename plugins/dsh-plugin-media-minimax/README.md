# MiniMax China media extension

Adds image generation (`image-01`, `image-01-live`), H3/H3-Max and legacy Hailuo video, synchronous speech and eligible music models to the existing `minimax-cn` provider. It does not register, subclass, replace or patch a DSH LLM adapter.

Uses public `llm.listConfigurableProviders()` → `settings.get(settingsNs)` at the advertised `settingsPath` → `credentials.resolve(apiKeyEnv)`. Supports the published `llm-pi-ai` profile schema with an explicit API Key. Only official China endpoint hosts `api.minimax.cn` and `api.minimaxi.com` are accepted; the media endpoint uses their origin rather than the chat-specific `/anthropic` path. OAuth grants, ambient credentials, coding-plan-only authentication and arbitrary compatible gateways are not assumed to authorize paid media APIs. Requests resolve credentials afresh; secrets never enter client catalog responses.

Registration follows the official provider's availability and is removed on extension unload. Model contracts and validation are owned by this plugin in `src/model-contracts.ts`. Unknown fields fail locally. Media jobs, switches, recovery and display use `@amiba/dsh-plugin-media`. No independent settings screen or duplicate provider entry is installed.

References (reviewed 2026-09-09):
- https://platform.minimax.cn/docs/api-reference/video-generation-v2-create.md
- https://platform.minimax.cn/docs/api-reference/video-generation-v2-query.md
- https://platform.minimax.cn/docs/api-reference/image-generation-t2i.md
- https://platform.minimax.cn/docs/api-reference/image-generation-i2i.md
- https://platform.minimax.cn/docs/api-reference/speech-t2a-http.md

This plugin supports generation and delivery, not voice cloning, voice design, asynchronous long-text speech, transcription or every service exposed by MiniMax. Advanced fields not in the advertised contract are rejected rather than passed through. No paid external requests run in automated tests.

### Maintaining media model rules

This plugin owns `src/model-contracts.ts` and its boundary tests. To update a model, review the official MiniMax API documentation, update its rule and contract version, and test its defaults and parameter combinations here. The official DSH chat provider and TokenDance plugin do not need changes.

Contracts describe the currently supported integration surface, not all upstream features. Remote asset validity, account permissions and provider availability can still cause upstream failures. See [model coverage](MEDIA-COVERAGE.md) for all 24 model routes, supported parameters and remaining limitations. Music access is restricted by MiniMax to historical paid users.

Rule sources (reviewed 2026-09-09):
- https://platform.minimax.cn/docs/api-reference/video-generation-v2-create.md
- https://platform.minimax.cn/docs/api-reference/image-generation-t2i.md
- https://platform.minimax.cn/docs/api-reference/image-generation-i2i.md
- https://platform.minimax.cn/docs/api-reference/speech-t2a-http.md
