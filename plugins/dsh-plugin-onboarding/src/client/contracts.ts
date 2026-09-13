import type {} from "@deepseek-ai/dsh-client-ui-slots";
export type GuideMood = "idle" | "waiting" | "loading" | "completed" | "failed";
export interface GuideStepOwner {
  /** Persist this step before advancing. Rejects if persistence fails. */
  complete(): Promise<void>;
  /** Pet dialogue; never include secrets or raw API responses. */
  say(message: string, mood?: GuideMood): void;
  openSection(id: string): void;
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
      owner: { mood: GuideMood };
    };
  }
}
