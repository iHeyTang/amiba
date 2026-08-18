import { Command } from "cmdk";
import { MessageSquare, Plus, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { SessionMeta } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "../primitives";

/** Cap how many recent chats become searchable rows (cmdk filters within). */
const MAX_SESSION_ITEMS = 50;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionMeta[];
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onSearchSessions?: (query: string) => Promise<SessionMeta[]>;
}

export function CommandPalette({
  open,
  onOpenChange,
  sessions,
  onOpenSession,
  onNewChat,
  onOpenSettings,
  onSearchSessions,
}: CommandPaletteProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SessionMeta[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setMatches([]);
      return;
    }
    const needle = query.trim();
    if (!needle || !onSearchSessions) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onSearchSessions(needle).then((result) => {
        if (!cancelled) setMatches(result);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchSessions, open, query]);

  // Close first, then perform — so the palette never lingers over the result.
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const needle = query.trim().toLocaleLowerCase();
  const localMatches = needle
    ? sessions.filter((session) =>
        `${session.title ?? ""}\n${session.searchSnippet ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : sessions;
  const recent = (
    needle && onSearchSessions ? matches : localMatches
  ).slice(0, MAX_SESSION_ITEMS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideDefaultClose
        // Spacing for cmdk's internal nodes is declared here (shadcn
        // CommandDialog pattern) so groups/headings/items get consistent
        // horizontal insets regardless of cmdk's own DOM structure.
        className={cn(
          // `block` overrides DialogContent's default `display: grid`: a grid
          // auto-track sizes to its content's max-content, so a long no-wrap
          // chat title blows the width past max-w-xl and overflow-hidden clips
          // it. As a block the width is locked to max-w-xl and the inner
          // `truncate` ellipsizes correctly.
          "block gap-0 overflow-hidden p-0",
          "[&_[cmdk-group]]:py-1",
          "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground/70",
          "[&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:w-full [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2 [&_[cmdk-item]]:overflow-hidden [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:text-sm [&_[cmdk-item]]:text-foreground/80",
          "[&_[cmdk-item][data-selected=true]]:bg-secondary [&_[cmdk-item][data-selected=true]]:text-secondary-foreground",
        )}
        aria-label={t("commandPalette.placeholder")}
        size="wide"
      >
        <DialogTitle className="sr-only">
          {t("commandPalette.placeholder")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("commandPalette.description")}
        </DialogDescription>
        <Command shouldFilter={false} className="flex max-h-[60vh] w-full min-w-0 flex-col">
          <div className="flex items-center border-b border-border px-4">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              data-testid="command-palette-input"
              placeholder={t("commandPalette.placeholder")}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.empty")}
            </Command.Empty>

            <Command.Group heading={t("commandPalette.group.recommended")}>
              <PaletteRow
                icon={<Plus className="h-4 w-4" />}
                label={t("commandPalette.cmd.newChat")}
                shortcut="⌘N"
                onSelect={() => run(onNewChat)}
              />
              <PaletteRow
                icon={<Settings className="h-4 w-4" />}
                label={t("chat.settings")}
                shortcut="⌘,"
                onSelect={() => run(onOpenSettings)}
              />
            </Command.Group>

            {recent.length > 0 && (
              <Command.Group heading={t("commandPalette.group.conversations")}>
                {recent.map((s) => {
                  const title = s.title?.trim() || t("chat.untitled");
                  return (
                    <PaletteRow
                      key={s.id}
                      // Unique value: keeps cmdk from deduping same-titled
                      // chats while the title substring still matches.
                      value={`${title} ${s.id}`}
                      icon={<MessageSquare className="h-4 w-4" />}
                      label={title}
                      description={s.searchSnippet}
                      onSelect={() => run(() => onOpenSession(s.id))}
                    />
                  );
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One palette row. Layout (flex/padding/hover) lives on the cmdk-item
 * selectors in the parent's className; this just supplies the content so the
 * icon, truncating label, and right-aligned shortcut stay inside the row.
 */
function PaletteRow({
  icon,
  label,
  shortcut,
  value,
  description,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  value?: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item value={value ?? label} onSelect={onSelect}>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description ? (
          <span className="block truncate text-[10px] text-muted-foreground">
            {description.replace(/>>>|<<</g, "")}
          </span>
        ) : null}
      </span>
      {shortcut && (
        <span className="shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          {shortcut}
        </span>
      )}
    </Command.Item>
  );
}
