import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@amiba/ui/primitives";
import type {
  SubagentHeaderLineageProps,
  SubagentReadOnlyComposerProps,
} from "@deepseek-ai/dsh-client-ui-subagent/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

export function SubagentReadOnly({
  matched,
  t,
}: SubagentReadOnlyComposerProps) {
  const oneShot = matched.reason === "one-shot";
  return (
    <div
      role="status"
      className="mx-4 mb-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm"
    >
      <p className="font-medium">
        {t(oneShot ? "readonly.oneShot.title" : "readonly.title")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(oneShot ? "readonly.oneShot.body" : "readonly.body")}
      </p>
    </div>
  );
}

type CatalogProps = Pick<
  SubagentHeaderLineageProps,
  "useSessions" | "openChild" | "refresh" | "setCatalogOpen" | "t"
> & {
  parentId: SessionId;
  currentId: SessionId;
  close: () => void;
  ancestors: readonly SessionId[];
};
/** Each mounted branch owns one official catalog subscription; closing the
 * popover or collapsing a branch releases it, including after navigation. */
function CatalogBranch({
  parentId,
  currentId,
  close,
  ancestors,
  ...props
}: CatalogProps) {
  const { useSessions, setCatalogOpen, refresh, openChild, t } = props;
  const catalog = useSessions((state) => state.subagentsByParent[parentId]);
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(new Set());
  useEffect(() => {
    setCatalogOpen(parentId, true);
    return () => setCatalogOpen(parentId, false);
  }, [parentId, setCatalogOpen]);
  return (
    <div className="space-y-1">
      {(!catalog ||
        (catalog.state === "loading" && !catalog.entries.length)) && (
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          {t("loading.label")}
        </p>
      )}
      {catalog?.state === "error" && (
        <div role="alert" className="px-2 py-1 text-xs text-destructive">
          {t("load.error")}{" "}
          <Button size="sm" variant="ghost" onClick={() => refresh(parentId)}>
            {t("retry")}
          </Button>
        </div>
      )}
      {catalog?.entries.map((entry) => {
        if (entry.kind === "diagnostic")
          return (
            <div
              key={entry.id}
              aria-disabled="true"
              className="px-2 py-1 text-xs text-muted-foreground"
            >
              {entry.id} · {t("diagnostic.unavailable")}
            </div>
          );
        const label = entry.label ?? entry.id;
        const canExpand =
          entry.hasChildren &&
          !ancestors.includes(entry.id) &&
          entry.id !== parentId;
        const isExpanded = expanded.has(entry.id);
        return (
          <div key={entry.id}>
            <div className="flex items-center gap-1">
              {canExpand ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t(
                    isExpanded ? "branch.collapse" : "branch.expand",
                    { label },
                  )}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(entry.id)) next.add(entry.id);
                      return next;
                    })
                  }
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </Button>
              ) : (
                <span className="w-7 shrink-0" />
              )}
              <button
                type="button"
                aria-current={entry.id === currentId || undefined}
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-accent"
                onClick={() => {
                  openChild({
                    parentSessionId: parentId,
                    childSessionId: entry.id,
                    mode: entry.mode,
                  });
                  close();
                }}
              >
                <span className="block truncate text-sm">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(
                    entry.mode === "one-shot"
                      ? "mode.oneShot"
                      : "mode.continuable",
                  )}{" "}
                  ·{" "}
                  {t(
                    entry.activity === "running"
                      ? "activity.running"
                      : "activity.inactive",
                  )}
                </span>
              </button>
            </div>
            {canExpand && isExpanded && (
              <div className="ml-4 border-l border-border pl-2">
                <CatalogBranch
                  {...props}
                  parentId={entry.id}
                  currentId={currentId}
                  close={close}
                  ancestors={[...ancestors, parentId]}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function SubagentLineage({
  lineageSessionId,
  displayTitle,
  openTitle,
  ...props
}: SubagentHeaderLineageProps) {
  const { useSessions, t } = props;
  const parentId = useSessions((state) =>
    state.byId[lineageSessionId]?.origin === "subagent"
      ? state.byId[lineageSessionId]?.parentId
      : undefined,
  );
  const rootId = parentId ?? lineageSessionId;
  const count = useSessions((state) =>
    Math.max(
      state.subagentsByParent[rootId]?.entries.filter(
        (entry) => entry.kind === "child",
      ).length ?? 0,
      Object.values(state.byId).filter(
        (row) => row.parentId === rootId && row.origin === "subagent",
      ).length,
    ),
  );
  const failed = useSessions(
    (state) => state.subagentsByParent[rootId]?.state === "error",
  );
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [lineageSessionId]);
  if (!parentId && count === 0 && !failed) return null;
  const title = displayTitle ?? String(lineageSessionId);
  const label = parentId
    ? t("switcher.aria", { title })
    : t(count === 1 ? "count.total.one" : "count.total.other", { count });
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {openTitle && (
        <button
          type="button"
          className="truncate hover:underline"
          onClick={openTitle}
        >
          {title}
        </button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            aria-label={label}
            title={label}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            {parentId && !openTitle ? (
              <span className="truncate">{title}</span>
            ) : (
              <span>{count}</span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" size="md">
          <div aria-label={t("tree.aria")}>
            <CatalogBranch
              {...props}
              parentId={rootId}
              currentId={lineageSessionId}
              close={() => setOpen(false)}
              ancestors={[]}
            />
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
