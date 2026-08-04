import { Plus, SquareTerminal } from "lucide-react"

import { useT } from "@amiba/i18n"

import { Button } from "../primitives"
import { useStartAgentTask } from "./agent-task"

export function CliToolsTab() {
  const { t } = useT()
  const startAgentTask = useStartAgentTask()

  function askToAdd() {
    if (!startAgentTask) return
    void startAgentTask(t("externalTools.cli.addPrompt"), {
      sourceApp: t("options.extensions.title"),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          {t("externalTools.cli.subtitle")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("externalTools.cli.privacy")}
        </p>
      </div>

      <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border/70 p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
          <SquareTerminal className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium">{t("externalTools.cli.title")}</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            {t("externalTools.cli.description")}
          </p>
        </div>
        {startAgentTask && (
          <Button type="button" variant="outline" size="sm" onClick={askToAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("externalTools.cli.add")}
          </Button>
        )}
      </div>
    </div>
  )
}
