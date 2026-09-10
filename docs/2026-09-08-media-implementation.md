# Media implementation work log

## Accepted scope

A provider-neutral media plugin owns Agent tools, task lifecycle, durable artifacts and shared media presentation. Existing TokenDance provider optionally registers media support and reuses its settings and credentials. Provider-native request bodies remain open; Agents consult official documentation rather than a comprehensive maintained model parameter schema. Provider settings and optional cross-provider defaults live in the existing models/services UI. No standalone media settings destination.

Initial end-to-end scope: image generation, video generation, text-to-speech. Include asset reuse, remote task references, progress and output presentation. Unknown submission outcomes must never trigger automatic generation retries. Remote cancellation is optional and must not be confused with stopping local observation.

## Implemented so far

- New workspace package `@amiba/dsh-plugin-media`, provider contracts, registry, lifecycle disposal and route validation.
- TokenDance media protocol directory: OpenAI/Ark images, Seedance/MiniMax videos, MiniMax/Ark speech. New models on these protocols are dynamically discoverable.
- Standalone TokenDance adapter: native request bodies, image decoding, async video submission/query, MiniMax hex audio, correctly framed Ark SSE audio, uncertain-submission errors without retries.
- Tests: registry (3), media protocols/SSE/adapter (5). Media package build and TokenDance typecheck passed.

## Remaining required work

- Review/harden adapter response validation, limits and error classification; verify MiniMax submission shapes against current docs/fixtures.
- Connect optional media registration to TokenDance configuration/credential lifecycle without affecting chat-only installations. Avoid static runtime imports of optional media service implementation.
- Agent describe/generate tools, official documentation access, source registration and system-prompt instructions.
- DSH jobs integration, remote task persistence/query recovery and interruption semantics.
- Managed artifact persistence, safe fetching, MIME validation, attachment reuse and session authorization.
- Existing provider UI capability display and optional media defaults; shared tool result image/audio/video presentation with visual QA.
- Core/web bundle composition, packaging, architecture gates and integration tests.
- Production calls only with usable credentials; report actual validation scope. No real paid call has been made.

## Workspace notes

The repository already contained extensive uncommitted work before implementation. Do not reset unrelated files. pnpm install was run offline with scripts disabled to link the new workspace package. The default shell Node is 22.17.0 while the repository asks for ^22.19.0 or >=24; use a compatible available runtime for runtime verification.

## Second implementation pass

Implemented optional TokenDance registration via Cordis service injection; settings changes register/unregister the media route. Added Agent describe/generate tools with exact advertised documentation reading and native JSON parameters. Added DSH media jobs, durable session-scoped records, explicit query-only resumption, and atomic artifact records. Added public HTTPS artifact downloads with pinned DNS, byte caps, and media signature checks. Added inspect/chunked artifact RPC and core bundle composition.

Verification: media suite now includes 6 tests (registry plus persistence, session isolation, invalid content rejection and query-only resumption); TokenDance suite contains 14 tests including existing chat protocol tests. Media build/typecheck and TokenDance build/typecheck passed. The expanded lifecycle test is being run separately after correcting initial-unconfigured assertions.

Still required: frontend/client packaging and preview, provider/default-model UI, reusable asset references, full tool-runtime integration tests, retry/persistence edge hardening, architecture/build/runtime gates and visual QA. No paid generation performed. The existing work log remaining list is not a completion claim.

## Third implementation pass

Added media client bundle and media_generate tool view: durable record polling, image previews, on-demand audio/video players, chunked artifact reads and download links. Object URLs are released on unmount. Added generic child slot `amiba.models.extension` to the existing Models & services section and media settings contribution (capability refresh and per-operation defaults). Defaults use official settings with optimistic revisions and are read by Agent tools when selection is omitted. Added session-scoped `$mediaAsset` placeholders resolving generated files to data URLs, with a 32 MiB input budget.

Verification: media tests 11 passed; model-plane tests 38 passed; extension-sdk build, media build/typecheck and model-plane typecheck passed. Pluginization passed. Architecture verifier updated with the new media bundle member and README; now stops at the pre-existing UI-shell client-graph assertion (verify-dsh-architecture.mjs around line 325), as noted before media work. No visual or packaged desktop runtime verification yet.

Next audit/work:
- Exercise actual client registration/slot rendering and visual QA (the component tests alone do not prove runtime UI integration).
- Test media settings UI and real tool lifecycle end-to-end with local protocol fixtures; complete desktop packaging/runtime verification with a compatible Node.
- Harden task state on process restart and post-generation artifact-save failures. Current inspect can show stale submitting/running after restart; synchronous completed output can be lost on failed saving. Do not mark end-to-end completion until handled.
- Add upload/user-attachment reference path if required by the initial workflow; current reuse handles generated artifacts as data URLs only and does not implement arbitrary provider upload-only workflows.
- Review MIME sniffing, DNS filtering and byte limits; remote chunk reader still uses metadata path and needs symlink/size integrity review.
- Confirm actual MiniMax task submission shape and protocol errors. Real paid calls remain unperformed.

## Fourth implementation pass

Added durable staging of completed provider outputs before final file persistence. Resume can now finish a synchronous generation after a save failure without resubmission; partial successful artifacts are skipped. Inspect maps orphaned in-flight records to interrupted/unknown rather than indefinitely running. Artifact chunk reading verifies file size and rejects symlinks. Added regression tests for save recovery and stale submissions.

Actual packaged-runtime smoke exposed a Cordis duplicate-service bug: the media registry and Typert remote service both used amibaMedia. Fixed by keeping provider-facing amibaMedia and naming UI RPC amibaMediaUi. Added a real Cordis regression test. The isolated DSH media smoke now exercises actual tool execution, jobs, persistence, RPC bytes and cross-session denial and PASSES. It uses an installed local fixture provider, not paid calls.

Verification this pass: media tests 14 passed, managed runtime rebuilt successfully (Node 22.22.0), desktop build and bundle verification passed, architecture verifier passed after correcting stale existing assertions to actual official remote dependency, keyed notice slot and preset ID dispatch. Local browser QA at qa/ validated actual MediaSettings and ArtifactPreview components, default selection, light/dark themes and a 640x360 PNG test pattern. Removed protocol identifiers from ordinary default-model labels.

Full bare-web visual attempt hit existing Pin plugin getPlatform initialization (desktop owns initialization), so it does not prove full web-product boot. An isolated Electron app was started and then stopped; native automation could not distinguish two running Electron apps and displayed the other DeepSeek Harness window, so do NOT claim full desktop UI visual verification from that attempt. Owned QA servers/apps have been stopped. Runtime UI smoke completed and cleaned itself. Last runtime:verify handle was 70243; inspect its actual result/log if needed rather than restarting blindly.

Remaining completion audit: protocol-level fixtures for all implemented image/video/TTS paths and task/error edge cases; no generated paid result has been tested against real TokenDance credentials. Review pending-source cleanup and interrupted resume without provider registration; add bounded network timeouts if needed. Verify client graph/slot contribution in packaged runtime beyond component QA. Docs should be consolidated into final behavior and validation rather than just this chronological log before delivery.

## Implementation acceptance

The agreed first-version implementation is complete and locally verified. Final user-facing behavior and supported protocol scope are documented in `docs/media-generation.md`. Historical remaining-work lists above describe intermediate states, not the final acceptance state.

Final evidence:
- Media package: 14 tests pass (routing, Cordis RPC/service separation, durable artifacts, isolation, generated-asset reuse, save recovery, stale submissions, defaults revisions, chunked previews).
- TokenDance: 21 tests pass, including real localhost HTTP transport across all six implemented media protocols, both asynchronous video queries, SSE framing, native field preservation, URL/hex audio and existing chat lifecycle/protocol tests.
- Model-plane: 38 existing tests passed after the settings extension; media/model-plane/TokenDance typechecks and extension SDK build passed.
- Managed runtime rebuilt and runtime:verify passed on Node 22.22.0. Final media runtime smoke passed after the latest source changes, including shipped client graph and bundle contributions, actual official tool execution/jobs, durable file/RPC access and cross-session denial.
- Built TokenDance adapter checked against the built media contract: SUBMISSION_UNKNOWN retains shared MediaError identity across package boundaries.
- Desktop build and production dependency/bundle verification passed. Architecture and pluginization checks passed; git diff --check clean.
- Actual media settings and image preview components inspected in local browser, default selection exercised, light/dark themes inspected. Full bare-web product boot is limited by existing desktop-only PlatformAdapter use in Pin; no claim of full native UI visual verification is made.

Limitations are deliberate and documented: no paid TokenDance call/account permission verification; no unsupported provider protocols, WebSocket audio, voice cloning/recognition or arbitrary proprietary uploads in this first version. Inline reuse supports protocols accepting data URLs; raw PCM is rejected before submission. These are outside the agreed initial image/video/TTS protocol implementation, not silently advertised as available.
