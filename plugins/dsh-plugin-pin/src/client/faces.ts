import type {
  SessionBadgeTarget,
  SessionGroupContribution,
  SessionMenuContribution,
} from "@amiba/dsh-plugin-ui-shell/client";

import type { PinState } from "./state.js";

/**
 * The `amiba.sessions.item.menu` business face for the "置顶" (pin) item:
 * visible on every session that isn't pinned yet, adds it on click. Mirrors
 * the steward's `stewardMenuFace` shape — `state` is read live at call
 * time, so a later `state.pin`/`state.unpin` (from either menu item, or the
 * initial `load()`) is reflected the next time the host asks.
 */
export function pinMenuFace(state: PinState): SessionMenuContribution {
  return {
    visible: (session: SessionBadgeTarget) => !state.isPinned(session.id),
    run: (session: SessionBadgeTarget) => state.pin(session.id),
    subscribe: state.subscribe,
  };
}

/**
 * The `amiba.sessions.item.menu` business face for the "取消置顶" (unpin)
 * item — the exact inverse of `pinMenuFace`'s `visible`/`run`, so the two
 * registrations are mutually exclusive on any given row.
 */
export function unpinMenuFace(state: PinState): SessionMenuContribution {
  return {
    visible: (session: SessionBadgeTarget) => state.isPinned(session.id),
    run: (session: SessionBadgeTarget) => state.unpin(session.id),
    subscribe: state.subscribe,
  };
}

/**
 * The `amiba.sessions.list.group` business face: a session is claimed by
 * the "置顶" group exactly when it's pinned.
 */
export function pinnedGroupFace(state: PinState): SessionGroupContribution {
  return {
    claim: (session: SessionBadgeTarget) => state.isPinned(session.id),
    subscribe: state.subscribe,
  };
}
