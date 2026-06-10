import { Button } from "../primitives"
import { useT } from "@amiba/i18n"
import { MessageSquarePlus } from "lucide-react"

interface Props {
  hasHistory?: boolean
  onNew?: () => void
  onOpenHistory?: () => void
}

export function EmptyState({ hasHistory, onNew, onOpenHistory }: Props) {
  const { t } = useT()
  return (
    <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
      <MessageSquarePlus className="h-10 w-10 opacity-60" />
      <div className="text-sm">{t("common.untitled")}</div>
      <div className="flex gap-2">
        {onNew ? (
          <Button size="sm" onClick={onNew}>
            New chat
          </Button>
        ) : null}
        {hasHistory && onOpenHistory ? (
          <Button size="sm" variant="outline" onClick={onOpenHistory}>
            History
          </Button>
        ) : null}
      </div>
    </div>
  )
}
