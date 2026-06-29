import { Command } from "cmdk"
import { MessageSquare, Plus, Settings } from "lucide-react"
import type { ReactNode } from "react"

import type { SessionMeta } from "@amiba/core"
import { useT } from "@amiba/i18n"
import { Dialog, DialogContent, cn } from "../primitives"

/** Cap how many recent chats become searchable rows (cmdk filters within). */
const MAX_SESSION_ITEMS = 50

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: SessionMeta[]
  onOpenSession: (id: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  sessions,
  onOpenSession,
  onNewChat,
  onOpenSettings,
}: CommandPaletteProps) {
  const { t } = useT()

  // Close first, then perform — so the palette never lingers over the result.
  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const recent = sessions.slice(0, MAX_SESSION_ITEMS)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideDefaultClose
        className="max-w-xl gap-0 overflow-hidden p-0"
        aria-label={t("commandPalette.placeholder")}
      >
        <Command className="flex max-h-[60vh] flex-col">
          <Command.Input
            autoFocus
            data-testid="command-palette-input"
            placeholder={t("commandPalette.placeholder")}
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
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
                  const title = s.title?.trim() || t("chat.untitled")
                  return (
                    <PaletteRow
                      key={s.id}
                      // Unique value: keeps cmdk from deduping same-titled
                      // chats while the title substring still matches.
                      value={`${title} ${s.id}`}
                      icon={<MessageSquare className="h-4 w-4" />}
                      label={title}
                      onSelect={() => run(() => onOpenSession(s.id))}
                    />
                  )
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteRow({
  icon,
  label,
  shortcut,
  value,
  onSelect,
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  value?: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={value ?? label}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {shortcut}
        </span>
      )}
    </Command.Item>
  )
}
