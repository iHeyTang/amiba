# Interrupted model requests

A failed turn keeps its streamed text, reasoning and tool evidence visible. The renderer flushes pending buffers before settling the assistant row and re-reads native session history without switching tabs. A late history response cannot replace messages changed by a new submission or a tab switch. If history is unavailable, local evidence remains visible. Pending user messages stay queued and paused.

The error card offers Retry alongside diagnostics. An accepted turn continues in the same native session with a continuation prompt; it does not resend the original task or reconstruct model context from rendered messages. A rejected submission remains in the existing queue with its attachments and uses the queue's explicit resend path.

The reviewed `dsh-llm-retry` patch keeps `TRANSPORT` and `TIMEOUT` failures retrying with the provider's capped exponential backoff until the request succeeds or the user stops the turn. It acts inside the native agent's failed model-request recovery point, so previously completed tool steps are not replayed. A provider policy with zero retries or an excluded error code remains respected. Other error codes keep the provider's existing policy and finite budget.

Native `llm/retry` and `llm/retry-started` events remain the durable source of retry records. Live rendering, engine snapshots and historical replay project one row per attempt. Waiting and started attempts appear in the conversation; settled turns retain the records without an active waiting indicator. Closing the app is not an offline background execution guarantee.

Validation:

- `node --test packages/app-runtime/scripts/dsh-runtime/network-retry.test.mjs`
- Runtime tests: `retry`, `chat-engine`, `assistant-text-source`, `runtime-session-history`, `dsh-sessions-store`
- UI tests: `RetryRow`, `ErrorBlock`, `CompactionRow`, `useStreamBuffer.reasoning`
