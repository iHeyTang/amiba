import { Button, usePluginT } from "@amiba/ui/plugin";
import { HandHelping } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import type { AdoptResult } from "../types.js";
import { stewardI18n } from "./i18n.js";
import type { StewardClientState } from "./state.js";

export interface AdoptActionProps {
  sessionId: string;
  state: StewardClientState;
  adopt(sessionId: string): Promise<AdoptResult>;
}

export function AdoptAction({ sessionId, state, adopt }: AdoptActionProps): ReactNode {
  const { t } = usePluginT(stewardI18n);
  const stewardId = useSyncExternalStore(state.subscribe, state.stewardSessionId);
  const adopted = useSyncExternalStore(state.subscribe, state.adoptedSessionIds);
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "failed">("idle");
  // Only the "idle" phase defers to the shared adopted set. Once this
  // instance has started (or finished) its own adopt, `adopt()`'s success
  // path adds this very sessionId to that set — re-checking it here would
  // unmount the button (and its "done" label) the instant the adopt that
  // just ran made it true.
  if (!sessionId || sessionId === stewardId || (phase === "idle" && adopted.has(sessionId))) return null;
  const label = phase === "done" ? t("steward.adopt.done") : phase === "failed" ? t("steward.adopt.failed") : t("steward.adopt");
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={phase === "busy"}
      aria-label={label}
      title={label}
      data-testid="steward-adopt"
      onClick={() => {
        setPhase("busy");
        void adopt(sessionId)
          .then((result) => {
            if (result.kind === "adopted") {
              state.setAdopted([...state.adoptedSessionIds(), result.task.sessionId]);
              setPhase("done");
            } else {
              setPhase("failed");
            }
          })
          .catch(() => setPhase("failed"));
      }}
    >
      <HandHelping className="size-4" />
      <span className="ml-1 text-xs">{label}</span>
    </Button>
  );
}
