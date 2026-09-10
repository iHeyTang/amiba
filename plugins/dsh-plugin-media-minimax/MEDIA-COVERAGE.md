# MiniMax China media coverage

Reviewed 2026-09-09. Rules live in this extension; the official DSH chat provider is unchanged. Contract version `2026-09-09.2`. **24 models have generation routes**, including three music models restricted by the provider to historical paid users.

| Models | Implemented support |
|---|---|
| MiniMax-H3 / MiniMax-H3-Max | v2 content roles, counts, frame/reference exclusivity, model-specific duration/resolution, ratio, callback, watermark; durable task query |
| MiniMax-Hailuo-2.3 / MiniMax-Hailuo-2.3-Fast / MiniMax-Hailuo-02 | v1 text/frame inputs, last frame only for 02, 6s/10s and resolution combinations, optimizer/fast pretreatment, callbacks/watermarks; query task then retrieve file URL |
| T2V-01 / T2V-01-Director | Text-only 6s/720P, prompt/optimizer/callback/watermark |
| I2V-01 / I2V-01-Director / I2V-01-live | First-frame 6s/720P, prompt/optimizer/callback/watermark |
| S2V-01 | One character reference; prompt/optimizer/callback/watermark |
| image-01 / image-01-live | Prompt, character reference, output count/seed/optimizer/watermark, URL/base64; image-01 dimensions and live-only style checks |
| speech-2.8-hd / -turbo; speech-2.6-hd / -turbo; speech-02-hd / -turbo; speech-01-hd / -turbo | Model/language/emotion differences; account voice lookup; voice, effects, mixing, pronunciation, language, audio settings, stream options, subtitles; full output assembly and raw PCM conversion to WAV |
| music-3.0 / music-2.6 / music-cover | Lyrics/instrumental/optimizer and cover reference combinations; audio format, stream, watermark; audio delivery |

## Boundaries

- The official 2026-08-20 notice limits music API access to historical paid users and retires the free models. Retired free models are excluded; registration cannot certify an account's entitlement.
- Long-text asynchronous speech, bidirectional WebSocket sessions, voice cloning/design/administration, ASR and video-agent templates are separate workflows, not exposed by these generation tools.
- The API voice list does not enumerate unused, unactivated clones. Such voices currently fail the account voice preflight; this extension does not activate newly cloned voices.
- URL asset contents, duration, codecs and account access remain upstream-validated; JSON validation cannot guarantee remote success.
- Tests verify declared model rules and response handling with fixtures, not real paid generation for every model.

## Sources

Official documentation index: https://platform.minimaxi.com/docs/llms.txt

- H3: https://platform.minimax.cn/docs/api-reference/video-generation-v2-create.md
- Legacy video: https://platform.minimaxi.com/docs/api-reference/video-generation-t2v.md, https://platform.minimaxi.com/docs/api-reference/video-generation-i2v.md, https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v.md, https://platform.minimaxi.com/docs/api-reference/video-generation-s2v.md
- Images: https://platform.minimax.cn/docs/api-reference/image-generation-t2i.md, https://platform.minimax.cn/docs/api-reference/image-generation-i2i.md
- Speech: https://platform.minimax.cn/docs/api-reference/speech-t2a-http.md
- Music and retirement notice: https://platform.minimaxi.com/docs/api-reference/music-generation.md
