/**
 * Amiba's visual shadow of the official locale plugin's LanguageRow.
 *
 * The locale plugin remains the sole owner of language state, persistence,
 * dictionaries, and the `t` framework seat. Only its pixels are replaced:
 * the official row imports DSH's `Menu`, whose styles require the excluded
 * `dsh-client-ui-theme`; this row uses Amiba's standard Select instead.
 */

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@amiba/ui/primitives";
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { useCallback, useSyncExternalStore } from "react";

/** Slot id used by the official locale plugin's LanguageRow. */
export const LANGUAGE_ROW_ENTRY_ID = "language";

/** Strictly below the official entry's implicit priority `0`. */
export const LANGUAGE_ROW_SHADOW_PRIORITY = -1;

/** The official locale service members the visual shadow consumes. */
export type LanguageLocaleRuntime = Pick<
  LocaleRuntime,
  "getSnapshot" | "setLocale" | "subscribe"
>;

export interface AmibaLanguageRowProps extends PropsLocale<"amiba"> {
  /** Official locale authority; this component owns no language state. */
  locale: LanguageLocaleRuntime;
}

/**
 * The one visible language preference row in Appearance settings.
 *
 * `useSyncExternalStore` reads the same immutable snapshot consumed by the
 * framework locale seat, so the control updates immediately when any official
 * plugin changes the active locale. Selecting an item writes straight back to
 * that official service.
 */
export function AmibaLanguageRow({
  locale,
  t,
}: AmibaLanguageRowProps): React.JSX.Element {
  const subscribe = useCallback(
    (listener: () => void) => locale.subscribe(listener),
    [locale],
  );
  const getSnapshot = useCallback(() => locale.getSnapshot(), [locale]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const label = t("shell.settings.language");
  const activeLabel =
    snapshot.locales.find((option) => option.id === snapshot.active)?.label ??
    snapshot.active;

  return (
    <div
      className="flex items-center justify-between gap-4 py-1"
      data-amiba-language-row=""
    >
      <Label htmlFor="amiba-settings-language" className="text-sm font-normal">
        {label}
      </Label>
      <Select
        value={snapshot.active}
        onValueChange={(id) => locale.setLocale(id)}
      >
        <SelectTrigger
          id="amiba-settings-language"
          aria-label={label}
          className="w-36"
        >
          <SelectValue>{activeLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {snapshot.locales.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
