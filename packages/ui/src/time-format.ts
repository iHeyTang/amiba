import { getPlatform } from "@amiba/app-runtime/platform";
import { useEffect, useState } from "react";

export type TimeFormatPreference = "12h" | "24h";

export const TIME_FORMAT_PREF_STORAGE_KEY = "settings.ui.timeFormat";

export function defaultTimeFormatPreference(
  locale?: string,
): TimeFormatPreference {
  try {
    const options = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions();
    return options.hour12 ? "12h" : "24h";
  } catch {
    return "24h";
  }
}

export function normalizeStoredTimeFormat(
  value: unknown,
  locale?: string,
): TimeFormatPreference {
  return value === "12h" || value === "24h"
    ? value
    : defaultTimeFormatPreference(locale);
}

export async function loadTimeFormatPreference(
  locale?: string,
): Promise<TimeFormatPreference> {
  try {
    const stored = await getPlatform().storage.get([
      TIME_FORMAT_PREF_STORAGE_KEY,
    ]);
    return normalizeStoredTimeFormat(
      stored[TIME_FORMAT_PREF_STORAGE_KEY],
      locale,
    );
  } catch {
    return defaultTimeFormatPreference(locale);
  }
}

export async function saveTimeFormatPreference(
  preference: TimeFormatPreference,
): Promise<void> {
  await getPlatform().storage.set({
    [TIME_FORMAT_PREF_STORAGE_KEY]: preference,
  });
}

/**
 * One reactive authority for the product's persisted time-display preference.
 * When no override is stored, the active app locale decides the initial
 * 12/24-hour convention.
 */
export function useStoredTimeFormatPreference(locale?: string) {
  const [preference, setPreference] = useState<TimeFormatPreference>(() =>
    defaultTimeFormatPreference(locale),
  );

  useEffect(() => {
    let mounted = true;
    void loadTimeFormatPreference(locale).then((next) => {
      if (mounted) setPreference(next);
    });
    const unsubscribe = getPlatform().storage.watch(
      [TIME_FORMAT_PREF_STORAGE_KEY],
      (changes) => {
        const change = changes[TIME_FORMAT_PREF_STORAGE_KEY];
        if (!change || change.newValue === undefined) return;
        setPreference(normalizeStoredTimeFormat(change.newValue, locale));
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [locale]);

  const update = async (next: TimeFormatPreference) => {
    setPreference(next);
    await saveTimeFormatPreference(next);
  };

  return [preference, update] as const;
}

export function formatClockTime(
  timestamp: number | undefined,
  preference: TimeFormatPreference,
  locale?: string,
): { dateTime: string; label: string } | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const hourCycle = preference === "24h" ? "h23" : "h12";
  return {
    dateTime: date.toISOString(),
    label: date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle,
    }),
  };
}

/** Full local date and time for messages that may span multiple days or years. */
export function formatMessageTime(
  timestamp: number | undefined,
  preference: TimeFormatPreference,
  locale?: string,
): { dateTime: string; label: string } | null {
  const clock = formatClockTime(timestamp, preference, locale);
  if (!clock) return null;
  const dateLabel = new Date(clock.dateTime).toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return { ...clock, label: `${dateLabel} ${clock.label}` };
}
