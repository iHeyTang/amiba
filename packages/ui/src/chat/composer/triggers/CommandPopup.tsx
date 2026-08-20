/**
 * Amiba's popupSelect shell — the SHADOW of `ui-commands`' own
 * `command-popup` overlay entry.
 *
 * WHY SHADOW RATHER THAN ADOPT THE OFFICIAL PIXELS. `PopupSelectView` is
 * styled from a CSS module written against the `--dsw-*` token layer, which
 * only `@deepseek-ai/dsh-client-ui-theme` defines and Amiba must keep out.
 * That alone might have been bridgeable. Its risk gate is not: the shell
 * composes `RiskConfirmation` (and `Modal`, `Checkbox`, `Button`, …) from
 * `@deepseek-ai/dsh-client-ui-primitives`, whose CSS modules ship STUBBED —
 * 23 `\0dsh-css-stub` regions, every export `{}` — because their rules live
 * in the official web frontend bundle, which Amiba does not serve. A token
 * bridge would have painted the card and left the confirmation modal a bare
 * stack of unstyled divs.
 *
 * WHAT IS NOT SHADOWED. Everything behavioural: the controller is the
 * official `PopupSelectController` resolved through `commandUi.popupFor`.
 * Single-flight select, retry-on-failed-load, local filtering, the
 * acknowledge-then-confirm gate, post-select token consumption and composer
 * refocus are all its logic. This file renders its state and calls its verbs.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "../../../primitives";
import { Button } from "../../../primitives";
import { Checkbox } from "../../../primitives";
import { Input } from "../../../primitives";
import type { ObservableSnapshot, PopupState, SelectOption } from "@amiba/extension-sdk";

/**
 * The official `PopupSelectController` face this shell drives. Structural, so
 * the real controller satisfies it directly.
 */
export interface CommandPopupController {
  readonly state: ObservableSnapshot<PopupState>;
  setSearch(search: string): void;
  move(dir: 1 | -1): void;
  highlight(index: number): void;
  select(index: number): Promise<void>;
  acknowledge(acknowledged: boolean): void;
  cancelConfirmation(): void;
  confirm(): Promise<void>;
  dismiss(opts?: { readonly focusComposer?: boolean }): void;
}

export interface CommandPopupCopy {
  searchPlaceholder: string;
  loading: string;
  applying: string;
  empty: string;
  retry: string;
}

const DEFAULT_COPY: CommandPopupCopy = {
  searchPlaceholder: "搜索…",
  loading: "正在加载选项…",
  applying: "正在应用…",
  empty: "无选项",
  retry: "重试",
};

/**
 * Filter option rows against the shell's search text. Byte-for-byte the
 * official `filterOptions` rule (case-insensitive substring over label and
 * detail; a blank search keeps every row) — mirrored rather than imported
 * because `@deepseek-ai/dsh-client-ui-commands` is a plugin bundle, not a
 * dependency `@amiba/ui` may pull runtime code from.
 */
export function filterOptions(
  options: readonly SelectOption[],
  search: string,
): readonly SelectOption[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return options;
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      (option.detail ?? "").toLowerCase().includes(needle),
  );
}

export function CommandPopup({
  popup,
  copy,
  onRetry,
}: {
  popup: CommandPopupController;
  copy?: Partial<CommandPopupCopy>;
  /** The official controller's `retry()`, when the host wired one. */
  onRetry?: () => void;
}) {
  const text = { ...DEFAULT_COPY, ...copy };
  const subscribe = useCallback(
    (listener: () => void) => popup.state.subscribe(listener),
    [popup],
  );
  const getSnapshot = useCallback(() => popup.state.getSnapshot(), [popup]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => filterOptions(state.options, state.search),
    [state.options, state.search],
  );

  // Keyboard, in the capture phase, matching TriggerMenu's contract: the
  // composer keeps focus and the popup intercepts before Lexical sees a key.
  useEffect(() => {
    if (!state.open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        popup.move(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (state.confirming !== null) void popup.confirm();
        else void popup.select(state.active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (state.confirming !== null) popup.cancelConfirmation();
        else popup.dismiss({ focusComposer: true });
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [popup, state.active, state.confirming, state.open]);

  // Outside pointerdown dismisses — same probe the official occupants use:
  // anything inside the composer card is "inside".
  useEffect(() => {
    if (!state.open) return;
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (cardRef.current?.contains(event.target)) return;
      if (cardRef.current?.closest("[data-composer-card]")?.contains(event.target))
        return;
      popup.dismiss();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [popup, state.open]);

  if (!state.open) return null;
  const confirming = state.confirming;
  const confirmation = confirming?.confirmation;

  return (
    <div
      ref={cardRef}
      data-composer-overlay=""
      data-ui-overlay="popover"
      data-command-popup={state.command ?? ""}
      className={cn(
        "absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-popover",
        "origin-bottom duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none",
      )}
      role="dialog"
      aria-label={`/${state.command ?? ""}`}
    >
      <div className="border-b border-border p-1.5">
        <Input
          aria-label={`/${state.command ?? ""}`}
          className="h-7 text-sm"
          onChange={(event) => popup.setSearch(event.target.value)}
          onMouseDown={(event) => event.stopPropagation()}
          placeholder={text.searchPlaceholder}
          value={state.search}
        />
      </div>
      {state.error ? (
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1">{state.error}</span>
          {state.status === "failed" && onRetry ? (
            <Button onClick={onRetry} size="sm" variant="ghost">
              {text.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="max-h-64 overflow-y-auto p-1">
        {state.status === "pending" ? (
          <div className="flex h-16 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {text.loading}
          </div>
        ) : null}
        {state.submitting ? (
          <div className="flex h-16 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {text.applying}
          </div>
        ) : null}
        {state.status === "ready" && rows.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            {text.empty}
          </div>
        ) : null}
        {state.status === "ready" && !state.submitting ? (
          <div aria-label={`/${state.command ?? ""}`} role="listbox">
            {rows.map((option, index) => (
              <button
                aria-selected={index === state.active}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                  index === state.active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void popup.select(index)}
                onMouseEnter={() => popup.highlight(index)}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{option.label}</span>
                  {option.detail ? (
                    <span
                      className={cn(
                        "block truncate text-xs",
                        index === state.active
                          ? "text-accent-foreground/75"
                          : "text-muted-foreground",
                      )}
                    >
                      {option.detail}
                    </span>
                  ) : null}
                </span>
                {option.active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {/* The SHARED confirmation gate. Copy, acknowledgement state and the
          cancel/confirm verbs are all the official controller's; only the
          chrome is Amiba's. Rendered inside the card rather than as a modal
          so the composer keeps focus, which is the same reason the menu is a
          non-Radix popover. */}
      {confirming && confirmation ? (
        <div
          className="border-t border-destructive/40 bg-destructive/5 p-2.5"
          data-command-confirmation=""
          role="alertdialog"
          aria-label={confirmation.title}
        >
          <div className="text-sm font-medium text-foreground">
            {confirmation.title}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {confirmation.description}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={state.acknowledged}
              onCheckedChange={(next) => popup.acknowledge(next === true)}
            />
            {confirmation.acknowledgeLabel}
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              onClick={() => popup.cancelConfirmation()}
              size="sm"
              variant="ghost"
            >
              {confirmation.cancelLabel}
            </Button>
            <Button
              disabled={!state.acknowledged || state.submitting}
              onClick={() => void popup.confirm()}
              size="sm"
              variant="destructive"
            >
              {confirmation.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
