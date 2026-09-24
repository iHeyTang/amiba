import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Workflow } from "lucide-react";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-client-ui-workflow-run/client";

// rc.2 does not re-export the workflow payload declaration from /client.
// This narrow structural contract mirrors the published durable projection.
type Status = "running" | "completed" | "failed" | "cancelled" | "interrupted";
interface WorkflowData {
  name: string;
  status: Status;
  phases: readonly {
    key: string;
    phase: string | null;
    members: readonly {
      seq: number;
      label: string;
      childId: SessionId;
      status: Status;
    }[];
  }[];
}
declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "workflow-run": WorkflowData;
  }
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "amiba.conversation.workflow": {
      kind: "single";
      scope: "session";
      owner: {
        node: import("@deepseek-ai/dsh-client-ui-chat/client").ChatConversationViewNode;
      };
    };
  }
}
type Props = PropsRuntime<"conversation.chat.node", "workflow-run"> &
  PropsLocale<"workflowRun"> & { openSession(id: SessionId): void };
// Official projections determine state, including interrupted history. Local
// disclosure never infers completion from text or mutates the runtime.
function Disclosure({
  label,
  status,
  revision,
  children,
}: {
  label: ReactNode;
  status: string;
  revision: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(status !== "completed");
  const root = useRef<HTMLDivElement>(null);
  const pendingClose = useRef(false);
  useEffect(() => {
    if (status === "completed") {
      if (root.current?.contains(document.activeElement))
        pendingClose.current = true;
      else setOpen(false);
    } else {
      pendingClose.current = false;
      setOpen(true);
    }
  }, [status, revision]);
  return (
    <div
      ref={root}
      onBlur={(event) => {
        if (
          pendingClose.current &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          pendingClose.current = false;
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        onClick={() => {
          pendingClose.current = false;
          setOpen(!open);
        }}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {label}
      </button>
      <div hidden={!open} className="ml-3 border-l border-border/50 pl-3">
        {children}
      </div>
    </div>
  );
}
export function WorkflowRun({
  node,
  sessionId,
  useSessions,
  openSession,
  t,
}: Props) {
  const sessions = useSessions((state) => state);
  const data = node.data;
  const revision = data.phases
    .flatMap((phase) => phase.members.map((member) => member.seq))
    .join(",");
  const statusText = (status: typeof data.status) => (
    <span
      className={`ml-auto shrink-0 text-xs ${status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {t(`status.${status}`)}
    </span>
  );
  return (
    <div
      data-workflow-run
      className="my-2 min-w-0 rounded-xl bg-muted/20 px-2 py-1"
    >
      <Disclosure
        key={node.key}
        status={data.status}
        revision={revision}
        label={
          <>
            <Workflow className="h-3.5 w-3.5 shrink-0" />
            <span
              className="min-w-0 flex-1 truncate font-medium text-foreground/80"
              title={data.name}
            >
              {data.name}
            </span>
            {statusText(data.status)}
          </>
        }
      >
        {!data.phases.length && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t("run.empty")}
          </p>
        )}
        {data.phases.map((phase) => {
          const status =
            (
              [
                "failed",
                "interrupted",
                "cancelled",
                "running",
                "completed",
              ] as const
            ).find((status) =>
              phase.members.some((member) => member.status === status),
            ) ?? "completed";
          return (
            <Disclosure
              key={phase.key}
              status={status}
              revision={phase.members.map((member) => member.seq).join(",")}
              label={
                <>
                  <span className="min-w-0 flex-1 truncate">
                    {phase.phase === null
                      ? t("phase.unassigned")
                      : phase.phase || t("phase.empty")}
                  </span>
                  <span className="tabular-nums">{phase.members.length}</span>
                  {statusText(status)}
                </>
              }
            >
              {phase.members.map((member) => {
                const row = sessions.byId[member.childId];
                const canOpen =
                  member.status === "running" &&
                  sessions.ids.includes(member.childId) &&
                  row?.origin === "subagent" &&
                  row.parentId === sessionId &&
                  row.running;
                const label = member.label || t("member.empty");
                return (
                  <div
                    key={member.seq}
                    className="flex min-h-8 items-center gap-2 px-2 py-1 text-xs"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${member.status === "running" ? "bg-primary" : member.status === "failed" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                    />
                    {canOpen ? (
                      <button
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        title={label}
                        aria-label={t("member.open", { name: label })}
                        onClick={() => openSession(member.childId)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-muted-foreground"
                        title={label}
                      >
                        {label}
                      </span>
                    )}
                    {statusText(member.status)}
                  </div>
                );
              })}
            </Disclosure>
          );
        })}
      </Disclosure>
    </div>
  );
}
