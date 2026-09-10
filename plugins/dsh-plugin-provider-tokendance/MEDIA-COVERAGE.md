# TokenDance media coverage

Reviewed 2026-09-09. Rules live in this plugin. Contract version: `2026-09-09.2`.
The checked catalog snapshot contains **23 image/video/speech models**; all have a generation route. This means executable coverage, **not exhaustive upstream feature coverage or a guarantee of successful paid execution**.

| Models | Implemented fields and result handling |
|---|---|
| seedream-5.0-lite | 2K/3K/4K and custom pixel area/ratio checks; 14 references; groups with combined 15-image budget; web search; prompt optimization; PNG/JPEG; base64/URL; SSE; successful partial images retained |
| seedream-5.0-pro | 1K/1.5K/2K and custom pixels; 10 references; standard/fast optimization; transparent background; layer decomposition with one input, preset/auto size; every image plus a JSON manifest preserving layer order and bounding boxes |
| seedance-2.0 / -fast / -mini / seedance-2.5 | Per-version resolution, duration and reference limits; frame/reference exclusivity; 2.5 edit/extend/output format; audio, watermark, seed, priority, expiry, callback, end-user identifier, last-frame delivery; asset URIs |
| minimax-h3 / minimax-h3-max | Per-model resolutions and duration, reference restrictions, roles and ratio checks, watermark/callback; task-based collection |
| minimax-speech-2.8-hd / -turbo | Voice/speed/pitch/volume, pronunciation, language, mixed voices, effects, audio formats, streaming, subtitles; PCM WAV wrapping |
| seed-tts-2.0 | Text, speaker, audio format, sample rate, speech rate, loudness; SSE assembly and PCM WAV wrapping |
| kling-3.0 / kling-3.0-turbo | Native prompt/contents/settings/options; first/last-frame distinction (Turbo excludes last frame); task ID and outputs-array collection |
| kling-3.0-omni | Prompt, reference images/elements, frames, base/feature video, audio off/original, multi-shot, resolution/duration/ratio; editing follows input duration |
| wan3.0-video / wan3.0-video-prime | input/parameters; frames, image/video/audio references, file/link; counts and mode exclusivity; resolution/ratio/duration/audio/seed/prompt_extend/watermark; task-based collection |
| happyhorse-1.0-t2v / -i2v / -r2v / -video-edit; happyhorse-1.1-t2v / -i2v / -r2v | Separate mode inputs; native media and documented legacy fields; generation duration, resolution/ratio, watermark/seed; editing references and audio preservation; task-based collection |

## Remaining limitations

- Seed TTS `req_params.additions` (context/style/filtering and other advanced controls) remains incomplete. Its linked upstream page returned an error shell, and the TokenDance page does not specify the complete field types and interactions. Fields are not guessed or enabled through paid trial calls.
- Kling fields beyond TokenDance's public protocol examples remain incomplete. Its linked full official reference did not expose readable parameter content during this review. In particular, do not interpret model-level support as support for all native audio or shot-control settings.
- Voice cloning/design, voice administration and bidirectional WebSocket transports are separate operations and are not exposed here. HTTP/SSE covers ordinary generation for the listed speech models.
- Input URLs remain subject to upstream accessibility, codec, duration, account and content checks. Local preflight validates JSON, combinations, inline base64 size and selected PNG dimension/alpha constraints; it does not fully inspect every media container.
- Tests use local fixtures and mock transports. No paid per-model generation tests were run.

## Sources

- Live inventory: https://tokendance.space/gateway/v1/models
- Gateway protocol references: https://tokendance.space/llms.txt
- Seedream request and output specification: https://docs.byteplus.com/docs/ModelArk/1541523
- Seedance request specification: https://docs.byteplus.com/docs/ModelArk/1520757
- MiniMax speech: https://platform.minimax.cn/docs/api-reference/speech-t2a-http.md
- MiniMax H3: https://platform.minimax.cn/docs/api-reference/video-generation-v2-create.md
- Wan: https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference
- HappyHorse: https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference, https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference, https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference, https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference

To update a model, edit this plugin's rule and tests, bump its contract version and review this table. New catalog entries are not automatically authorized for execution.
