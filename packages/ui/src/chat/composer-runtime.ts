/** Headless native input machinery, without loading view or terminal modules. */
export { CommandClaimStore } from "./composer/triggers/claim";
export { createResidentInputTransaction } from "./internal/resident-input-transaction";
export { sessionPendingQueue, type PendingChatTurn } from "./internal/pending-queue-store";
export { expandMentionPartsAsync } from "./composer/expandMentions";

export { commandAcceptsImages, commandImagePayload } from "./composer/command-contract";
