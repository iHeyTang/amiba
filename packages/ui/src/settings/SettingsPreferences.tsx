import { useEffect, useState, type ReactNode } from "react";

import { Label } from "../primitives";
import { Switch } from "../primitives";
import { Input } from "../primitives";
import { Button } from "../primitives";
import { useT } from "@amiba/i18n";
import type { MessageKey, TranslateFn } from "@amiba/i18n";
import { getPlatform } from "@amiba/app-runtime/platform";
import {
  ACCENTS,
  type AccentPreference,
  type ThemePreference,
  useStoredAccentPreference,
  useStoredThemePreference,
} from "../theme";
import { cn } from "../primitives";
import type { MessagesMaxWidth } from "../chat/internal/types";
import {
  type TimeFormatPreference,
  useStoredTimeFormatPreference,
} from "../time-format";
import { SettingsPageDescription } from "./page-chrome";

const ACCENT_LABEL_I18N: Record<AccentPreference, MessageKey> = {
  violet: "options.preference.accent.violet",
  coral: "options.preference.accent.coral",
  cyan: "options.preference.accent.cyan",
  lime: "options.preference.accent.lime",
  graphite: "options.preference.accent.graphite",
};

const NEWTAB_WALLPAPER_KEY = "settings.newtab.wallpaper.enabled";
const SUMMON_HOTKEY_KEY = "settings.desktop.summonHotkey";
// Mirrors the key used by FullScreenChatView so a write here propagates
// to the chat surface via the shared storage.watch subscription.
const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

function isMessagesMaxWidth(v: unknown): v is MessagesMaxWidth {
  return v === "narrow" || v === "comfortable" || v === "full";
}

type SummonModifier = "Meta" | "Control" | "Alt" | "Shift";
type SummonHotkey =
  | { kind: "disabled" }
  | { kind: "doubleTap"; modifier: SummonModifier }
  | { kind: "accelerator"; accelerator: string };

const DEFAULT_SUMMON_HOTKEY: SummonHotkey = {
  kind: "doubleTap",
  modifier: "Meta",
};

function parseSummonHotkey(raw: unknown): SummonHotkey {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SUMMON_HOTKEY;
  const v = raw as { kind?: string } & Record<string, unknown>;
  if (v.kind === "disabled") return { kind: "disabled" };
  if (v.kind === "doubleTap") {
    const mods: SummonModifier[] = ["Meta", "Control", "Alt", "Shift"];
    if (mods.includes(v.modifier as SummonModifier)) {
      return { kind: "doubleTap", modifier: v.modifier as SummonModifier };
    }
  }
  if (v.kind === "accelerator" && typeof v.accelerator === "string") {
    return { kind: "accelerator", accelerator: v.accelerator };
  }
  return DEFAULT_SUMMON_HOTKEY;
}

export interface SettingsAppearanceProps {
  /**
   * The official `settings.general.item` seat — one preference row per
   * registrant, contributed by the feature plugin that owns the preference
   * (upstream: locale → Language, ui-theme → Appearance, ui-conversation →
   * Composer Enter). This page IS Amiba's General section: it stacks the
   * rows the product owns itself (theme, accent, wallpaper, message width)
   * and this seat appends the contributed ones underneath.
   *
   * 语言 is NOT a core-owned preference. The official locale plugin registers
   * the `language` cell into this seat and remains the one state authority;
   * UI Shell shadows only that cell's DSH-Menu-based presentation with an
   * Amiba Select. The retired `settings.ui.language` preference never returns:
   * one row, one authority. See `plugins/dsh-plugin-ui-shell/src/client/`'s
   * `locale-bridge.ts` and `language-seat.tsx`.
   *
   * The owner share is empty by contract — "the section column only stacks
   * rows, so a row draws its own internals, including its label" — so the
   * host passes the dispatched node straight through and adds no chrome
   * around it. Hosts outside a DSH plugin runtime (Quick-Ask, the browser
   * extension) pass nothing and the page renders exactly as before.
   */
  generalItems?: ReactNode;
}

/**
 * Appearance settings — a top-level tab. Merges what used to be the
 * "Appearance" + "Chat" preference sub-tabs into one page (theme, accent,
 * wallpaper, time format, message width). 语言 is dispatched through
 * `generalItems`: official locale state behind an Amiba UI Shell visual.
 */
export function SettingsAppearance({
  generalItems,
}: SettingsAppearanceProps = {}) {
  const { t, language } = useT();
  const [themePref, setThemePref] = useStoredThemePreference();
  const [accentPref, setAccentPref] = useStoredAccentPreference();
  const [timeFormat, setTimeFormat] = useStoredTimeFormatPreference(language);
  // Default `true` matches the new-tab page's runtime default (see
  // `useWallpaper`).
  const [wallpaperEnabled, setWallpaperEnabled] = useState(true);
  const [messagesWidth, setMessagesWidth] = useState<MessagesMaxWidth>(
    DEFAULT_MESSAGES_WIDTH,
  );
  const isDesktop = getPlatform().kind === "desktop";

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "auto", label: t("options.preference.theme.auto") },
    { value: "light", label: t("options.preference.theme.light") },
    { value: "dark", label: t("options.preference.theme.dark") },
  ];

  const widthOptions: { value: MessagesMaxWidth; label: string }[] = [
    { value: "narrow", label: t("chat.width.narrow") },
    { value: "comfortable", label: t("chat.width.medium") },
    { value: "full", label: t("chat.width.full") },
  ];

  const timeFormatOptions: {
    value: TimeFormatPreference;
    label: string;
  }[] = [
    { value: "12h", label: t("options.preference.timeFormat.12h") },
    { value: "24h", label: t("options.preference.timeFormat.24h") },
  ];

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    const keys = [NEWTAB_WALLPAPER_KEY, MESSAGES_WIDTH_KEY];
    void storage.get(keys).then((r) => {
      if (cancelled) return;
      const wp = r[NEWTAB_WALLPAPER_KEY];
      if (typeof wp === "boolean") setWallpaperEnabled(wp);
      const w = r[MESSAGES_WIDTH_KEY];
      if (isMessagesMaxWidth(w)) setMessagesWidth(w);
    });
    const unsub = storage.watch(keys, (changes) => {
      const wp = changes[NEWTAB_WALLPAPER_KEY];
      if (wp && typeof wp.newValue === "boolean") {
        setWallpaperEnabled(wp.newValue);
      }
      const w = changes[MESSAGES_WIDTH_KEY];
      if (w && isMessagesMaxWidth(w.newValue)) setMessagesWidth(w.newValue);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return (
    <div className="space-y-8">
      <SettingsPageDescription>
        {t("options.preference.subtitle")}
      </SettingsPageDescription>
      <AppearanceSection
        t={t}
        themePref={themePref}
        accentPref={accentPref}
        themeOptions={themeOptions}
        onThemeChange={(v) => void setThemePref(v)}
        onAccentChange={(v) => void setAccentPref(v)}
        // Wallpaper backdrop is rendered by the extension's new-tab
        // surface; the desktop home doesn't surface it, so we hide
        // the toggle there to avoid a no-op control.
        showWallpaper={!isDesktop}
        wallpaperEnabled={wallpaperEnabled}
        onWallpaperChange={(next) => {
          setWallpaperEnabled(next);
          void getPlatform().storage.set({
            [NEWTAB_WALLPAPER_KEY]: next,
          });
        }}
      />
      <ChatSection
        t={t}
        timeFormat={timeFormat}
        timeFormatOptions={timeFormatOptions}
        onTimeFormatChange={(v) => void setTimeFormat(v)}
        messagesWidth={messagesWidth}
        widthOptions={widthOptions}
        onWidthChange={(v) => {
          setMessagesWidth(v);
          void getPlatform().storage.set({
            [MESSAGES_WIDTH_KEY]: v,
          });
        }}
      />
      {generalItems}
    </div>
  );
}

/**
 * Keyboard shortcuts — a top-level tab. Desktop-only: the summon hotkey only
 * fires inside Electron. SettingsView hides the nav entry elsewhere.
 */
export function SettingsShortcuts() {
  const { t } = useT();
  const [summonHotkey, setSummonHotkey] = useState<SummonHotkey>(
    DEFAULT_SUMMON_HOTKEY,
  );

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get([SUMMON_HOTKEY_KEY]).then((r) => {
      if (cancelled) return;
      if (SUMMON_HOTKEY_KEY in r) {
        setSummonHotkey(parseSummonHotkey(r[SUMMON_HOTKEY_KEY]));
      }
    });
    const unsub = storage.watch([SUMMON_HOTKEY_KEY], (changes) => {
      const hk = changes[SUMMON_HOTKEY_KEY];
      if (hk) setSummonHotkey(parseSummonHotkey(hk.newValue));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return (
    <div className="space-y-8">
      <SettingsPageDescription>
        {t("options.preference.hotkey.desc")}
      </SettingsPageDescription>
      <HotkeySection
        summonHotkey={summonHotkey}
        onSummonHotkeyChange={(next) => {
          setSummonHotkey(next);
          void getPlatform().storage.set({
            [SUMMON_HOTKEY_KEY]: next,
          });
        }}
      />
    </div>
  );
}

/* ---------- sub-tab content sections ---------- */

function AppearanceSection({
  t,
  themePref,
  accentPref,
  themeOptions,
  onThemeChange,
  onAccentChange,
  showWallpaper,
  wallpaperEnabled,
  onWallpaperChange,
}: {
  t: TranslateFn;
  themePref: ThemePreference;
  accentPref: AccentPreference;
  themeOptions: { value: ThemePreference; label: string }[];
  onThemeChange: (v: ThemePreference) => void;
  onAccentChange: (v: AccentPreference) => void;
  showWallpaper: boolean;
  wallpaperEnabled: boolean;
  onWallpaperChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <SegmentedRow
        label={t("options.preference.theme")}
        ariaLabel={t("options.preference.theme")}
        value={themePref}
        options={themeOptions}
        onChange={onThemeChange}
      />
      <AccentRow t={t} value={accentPref} onChange={onAccentChange} />
      {showWallpaper && (
        <SwitchRow
          id="prefs-newtab-wallpaper"
          label={t("options.preference.newtab.wallpaper.label")}
          checked={wallpaperEnabled}
          onChange={onWallpaperChange}
        />
      )}
    </div>
  );
}

function ChatSection({
  t,
  timeFormat,
  timeFormatOptions,
  onTimeFormatChange,
  messagesWidth,
  widthOptions,
  onWidthChange,
}: {
  t: TranslateFn;
  timeFormat: TimeFormatPreference;
  timeFormatOptions: { value: TimeFormatPreference; label: string }[];
  onTimeFormatChange: (v: TimeFormatPreference) => void;
  messagesWidth: MessagesMaxWidth;
  widthOptions: { value: MessagesMaxWidth; label: string }[];
  onWidthChange: (v: MessagesMaxWidth) => void;
}) {
  return (
    <div className="space-y-3">
      <SegmentedRow
        label={t("options.preference.timeFormat")}
        ariaLabel={t("options.preference.timeFormat")}
        value={timeFormat}
        options={timeFormatOptions}
        onChange={onTimeFormatChange}
      />
      <SegmentedRow
        label={t("chat.width.label")}
        ariaLabel={t("chat.width.label")}
        value={messagesWidth}
        options={widthOptions}
        onChange={onWidthChange}
      />
    </div>
  );
}

function HotkeySection({
  summonHotkey,
  onSummonHotkeyChange,
}: {
  summonHotkey: SummonHotkey;
  onSummonHotkeyChange: (next: SummonHotkey) => void;
}) {
  return (
    <div className="space-y-3">
      <SummonHotkeyRow value={summonHotkey} onChange={onSummonHotkeyChange} />
    </div>
  );
}

/* ---------- shared layout primitives ---------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {hint && (
          <p className="truncate text-[11px] text-muted-foreground/80">
            {hint}
          </p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <Label
          htmlFor={id}
          className={cn(
            "text-sm font-normal",
            disabled && "text-muted-foreground/60",
          )}
        >
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/**
 * Brand-accent picker — a row of colour swatches. Selecting one writes the
 * accent preference; `useResolvedTheme` then swaps the `.accent-*` class on
 * `<html>` and every `--primary` / `--ring` surface recolours live.
 */
function AccentRow({
  t,
  value,
  onChange,
}: {
  t: TranslateFn;
  value: AccentPreference;
  onChange: (next: AccentPreference) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <Label className="text-sm font-normal">
        {t("options.preference.accent")}
      </Label>
      <div
        className="inline-flex items-center gap-3.5"
        role="radiogroup"
        aria-label={t("options.preference.accent")}
      >
        {ACCENTS.map((a) => {
          const active = value === a.id;
          const label = t(ACCENT_LABEL_I18N[a.id]);
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={label}
              onClick={() => onChange(a.id)}
              className={cn(
                "h-5 w-5 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                active
                  ? "scale-110 ring-2 ring-foreground"
                  : "ring-1 ring-black/10 dark:ring-white/15",
              )}
              style={{ backgroundColor: a.swatch }}
            />
          );
        })}
      </div>
    </div>
  );
}

function SegmentedRow<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <Label className="text-sm font-normal">{label}</Label>
      <div
        className="inline-flex gap-0.5 rounded-md bg-muted/40 p-0.5"
        role="radiogroup"
        aria-label={ariaLabel}
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- summon hotkey row ---------- */

/**
 * Two-stage row: the mode picker (disabled / double-tap / accelerator)
 * controls which detail editor appears below it. Picking a mode that's
 * already active is a no-op so we don't churn the store with identical
 * writes. macOS users get an Accessibility-permission hint near the
 * double-tap controls so the first run isn't confusing.
 */
function SummonHotkeyRow({
  value,
  onChange,
}: {
  value: SummonHotkey;
  onChange: (next: SummonHotkey) => void;
}) {
  const { t } = useT();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const modeOptions: { value: SummonHotkey["kind"]; label: string }[] = [
    {
      value: "doubleTap",
      label: t("options.preference.hotkey.mode.doubleTap"),
    },
    {
      value: "accelerator",
      label: t("options.preference.hotkey.mode.accelerator"),
    },
    { value: "disabled", label: t("options.preference.hotkey.mode.disabled") },
  ];

  const modifierOptions: { value: SummonModifier; label: string }[] = [
    { value: "Meta", label: t("options.preference.hotkey.modifier.Meta") },
    {
      value: "Control",
      label: t("options.preference.hotkey.modifier.Control"),
    },
    { value: "Alt", label: t("options.preference.hotkey.modifier.Alt") },
    { value: "Shift", label: t("options.preference.hotkey.modifier.Shift") },
  ];

  function pickMode(kind: SummonHotkey["kind"]) {
    if (kind === value.kind) return;
    if (kind === "disabled") return onChange({ kind: "disabled" });
    if (kind === "doubleTap")
      return onChange({ kind: "doubleTap", modifier: "Meta" });
    return onChange({
      kind: "accelerator",
      accelerator: "CommandOrControl+Shift+H",
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-sm font-normal">
          {t("options.preference.hotkey.label")}
        </Label>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("options.preference.hotkey.desc")}
        </p>
      </div>

      <SegmentedRow
        label={t("options.preference.hotkey.label")}
        ariaLabel={t("options.preference.hotkey.label")}
        value={value.kind}
        options={modeOptions}
        onChange={pickMode}
      />

      {value.kind === "doubleTap" && (
        <>
          <SegmentedRow
            label={t("options.preference.hotkey.modifier.label")}
            ariaLabel={t("options.preference.hotkey.modifier.label")}
            value={value.modifier}
            options={modifierOptions}
            onChange={(modifier) => onChange({ kind: "doubleTap", modifier })}
          />
          {isMac && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("options.preference.hotkey.macHint")}
            </p>
          )}
        </>
      )}

      {value.kind === "accelerator" && (
        <div className="space-y-1.5">
          <Label
            htmlFor="prefs-summon-accelerator"
            className="text-sm font-normal"
          >
            {t("options.preference.hotkey.accelerator.label")}
          </Label>
          <Input
            id="prefs-summon-accelerator"
            value={value.accelerator}
            onChange={(e) =>
              onChange({ kind: "accelerator", accelerator: e.target.value })
            }
            placeholder={t("options.preference.hotkey.accelerator.placeholder")}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("options.preference.hotkey.accelerator.hint")}
          </p>
        </div>
      )}
    </div>
  );
}
