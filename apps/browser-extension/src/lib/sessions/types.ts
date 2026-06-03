// All session types + storage keys now live in @hermes-x/core. This file
// stays as a re-export so existing `~lib/sessions/types` imports keep working.
export {
  type SessionMeta,
  type SessionLocalMeta,
  type SessionMessage,
  SESSION_KEYS,
  LOCAL_META_KEY,
} from "@hermes-x/core";
