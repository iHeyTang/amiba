/**
 * Re-exports from @hermes-x/core. The actual implementation (HermesClient
 * class, streamChat, runHermesAgent, postHermesApprovalDecision, all wire
 * protocol types) lives in `packages/core/src/hermes-client.ts` so the
 * desktop Electron-main chat engine can share the exact same code path.
 */
export * from "@hermes-x/core";
