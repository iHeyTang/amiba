import { getPlatform } from "@amiba/app-runtime/platform";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
// Type-only: SlotMap entries for `amiba.sessions.item.menu` /
// `amiba.sessions.list.group`.
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";

import { pinMenuFace, pinnedGroupFace, unpinMenuFace } from "./faces.js";
import { createPinState } from "./state.js";

export const name = "amiba-pin-ui";
export const inject = ["slots"];

const MENU_PIN_ID = "pin";
const MENU_UNPIN_ID = "unpin";
const GROUP_ID = "pinned";

function isZh(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith("zh");
}

/** Same resolution style as the steward's `copy()`/`adoptCopy()` — read
 *  outside React since the registered menu/group component is never
 *  mounted (see `NoopComponent`'s doc comment). */
function pinLabel(): string {
  return isZh() ? "置顶" : "Pin";
}

function unpinLabel(): string {
  return isZh() ? "取消置顶" : "Unpin";
}

function groupLabel(): string {
  return isZh() ? "置顶" : "Pinned";
}

/**
 * The registered component for `amiba.sessions.item.menu` /
 * `amiba.sessions.list.group` — never rendered. The shell reads these
 * registrations by enumerating `entriesOfSlot` and calling `options.label` /
 * `inject().visible` / `inject().run` / `inject().claim` directly (see
 * `createSessionMenuItemsSource` / `createSessionGroupsSource` in
 * `dsh-plugin-ui-shell`'s `session-list-sources.ts`); it never mounts the
 * component through a slot renderer. A component is still required to
 * satisfy `ctx.slots.register`'s signature — same convention as the
 * steward's badge/group/menu registrations.
 */
function NoopComponent(): ReactNode {
  return null;
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const state = createPinState(getPlatform().storage);
  // Fire-and-forget: `state.load()` never rejects (it tolerates a missing
  // or malformed stored value internally) and notifies subscribers once it
  // resolves, so the row/group re-renders with the persisted set as soon
  // as it's available — the same "don't block apply on a read" convention
  // the steward uses for `ensureStewardSession`/`refreshAdopted`.
  void state.load();

  const fiber = ctx.inject(["slots"], (injectedCtx) => {
    // Session row ⋯ menu: "置顶"/"取消置顶" are mutually exclusive per row
    // (see `pinMenuFace`/`unpinMenuFace`'s `visible`), both reading the same
    // live `state`, so toggling from either flips the other and the
    // "置顶" group below.
    const disposePinMenu = injectedCtx.slots.inject("amiba.sessions.item.menu", () =>
      injectedCtx.slots.register(
        {
          name: "amiba.sessions.item.menu",
          id: MENU_PIN_ID,
          order: 10,
          label: pinLabel,
          inject: () => pinMenuFace(state),
        },
        NoopComponent,
      ),
    );
    const disposeUnpinMenu = injectedCtx.slots.inject("amiba.sessions.item.menu", () =>
      injectedCtx.slots.register(
        {
          name: "amiba.sessions.item.menu",
          id: MENU_UNPIN_ID,
          order: 10,
          label: unpinLabel,
          inject: () => unpinMenuFace(state),
        },
        NoopComponent,
      ),
    );
    // Session list: every pinned session moves into its own "置顶" group,
    // ahead of the steward's group and the regular channel sections (see
    // plan 8.5 — the pin plugin's group is meant to render first).
    const disposeGroup = injectedCtx.slots.inject("amiba.sessions.list.group", () =>
      injectedCtx.slots.register(
        {
          name: "amiba.sessions.list.group",
          id: GROUP_ID,
          order: 0,
          label: groupLabel,
          inject: () => pinnedGroupFace(state),
        },
        NoopComponent,
      ),
    );
    return () => {
      disposeGroup();
      disposeUnpinMenu();
      disposePinMenu();
    };
  });
  await fiber;
  return async () => {
    await fiber.dispose();
  };
}
