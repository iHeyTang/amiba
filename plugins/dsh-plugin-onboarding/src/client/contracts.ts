import type { ReactNode } from "react";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
export type GuideMood =
  | "idle"
  | "waiting"
  | "loading"
  | "completed"
  | "failed"
  | "interrupted"
  | "welcome"
  | "cheering"
  | "impatient";
export interface GuideStepOwner {
  /** Persist this step before advancing. Rejects if persistence fails. */
  complete(): Promise<void>;
  /** Pet dialogue; never include secrets or raw API responses. */
  say(message: string, mood?: GuideMood): void;
  openSection(id: string): void;
  /** Return to the welcome screen without completing this step. */
  backToWelcome?(): void;
  react?(reaction: "next" | "back"): void;
  /** Render step navigation into the guide’s shared bottom-right action area. */
  renderActions(actions: ReactNode): ReactNode;
  /** Place step progress above the companion dialogue. */
  renderProgress?(progress: ReactNode): ReactNode;
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "amiba.onboarding.step": {
      kind: "list";
      scope: "root";
      owner: GuideStepOwner;
    };
    "amiba.onboarding.companion": {
      kind: "single";
      scope: "root";
      owner: { mood: GuideMood; reactionId?: number };
    };
  }
}
