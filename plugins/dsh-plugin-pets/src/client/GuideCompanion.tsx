import { useMemo, useSyncExternalStore } from "react";
import type { GuideMood } from "@amiba/dsh-plugin-onboarding/client";
import { grovePack, makeConfig } from "../model.js";
import type { PetLibraryClient } from "./library.js";
import { PetView } from "./PetView.js";

export function GuideCompanion({
  library,
  mood,
  reactionId,
}: {
  library: PetLibraryClient;
  mood: GuideMood;
  reactionId?: number;
}) {
  const { library: state } = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
  );
  const active = state.pets.find((p) => p.id === state.activeId);
  // First-run libraries are empty. Preview a built-in companion without
  // adopting it or overwriting any of the user's existing pet preferences.
  const config = useMemo(
    () =>
      active?.config ??
      (grovePack.skins[0]
        ? makeConfig({ name: "Mofli", skinId: grovePack.skins[0].id })
        : undefined),
    [active?.config],
  );
  return config ? (
    <PetView
      key={reactionId}
      config={config}
      name={active?.name ?? "Mofli"}
      previewScene={mood}
      className="h-28 w-28"
    />
  ) : null;
}
