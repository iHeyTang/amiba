import type {} from "@amiba/dsh-plugin-onboarding/client";
import { GuideCompanion } from "./GuideCompanion.js";
import type {} from "@amiba/dsh-plugin-notification-hub/client";
import { DesktopPet } from "./desktop.js";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { SurfaceVisualOwner } from "@amiba/extension-sdk";
import { PawPrint } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { PET_REMOTE } from "../remote.js";
import { createPetLibrary, type PetLibraryClient } from "./library.js";
import { PetView } from "./PetView.js";
import { PetPage } from "./PetPage.js";
export const name = "amiba-pets-ui";
export const inject = ["slots", "remote", "layout"];
const label = () =>
  document.documentElement.lang.startsWith("zh") ? "宠物" : "Pets";
function Companion({
  library,
  priority = 10,
  defaultVisual,
  ...owner
}: SurfaceVisualOwner & {
  library: PetLibraryClient;
  priority?: number;
  defaultVisual?: ReactNode;
}) {
  const { library: state, loading } = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
  );
  if (loading)
    return defaultVisual ? (
      <div className="h-28 w-28" aria-hidden="true" />
    ) : null;
  const pet = state.pets.find((p) => p.id === state.activeId);
  if (!pet) return defaultVisual ?? null;
  const view = (
    <PetView
      {...owner}
      priority={priority}
      className={priority === 30 ? "h-40 w-40 shrink-0" : "h-20 w-20"}
      config={pet.config}
      name={pet.name}
    />
  );
  // Keep the character's rendering scale while removing 24px of transparent
  // canvas margin on each edge from the home layout's reserved space.
  return priority === 30 ? (
    <div className="flex h-28 w-28 shrink-0 items-center justify-center">
      {view}
    </div>
  ) : view;
}
export async function apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(PET_REMOTE);
  const fiber = ctx.inject(
    ["slots", "remote.amibaPets", "layout", "amibaNotificationFeed"],
    (c) => {
      const library = createPetLibrary(c.remote.amibaPets);
      const off = [
        c.slots.inject("amiba.onboarding.companion", () => c.slots.register({
          name: "amiba.onboarding.companion", inject: () => ({library}),
        }, GuideCompanion)),
        c.slots.inject("amiba.workspace.view", () =>
          c.slots.register(
            {
              name: "amiba.workspace.view",
              id: "desktop-pet",
              inject: () => ({
                library,
                notifications: c.amibaNotificationFeed,
              }),
            },
            DesktopPet,
          ),
        ),
        c.slots.inject("settings.section", () =>
          c.slots.register({
            name: "settings.section",
            id: "pets",
            label,
            order: 295,
            inject: () => ({ navIcon: () => <PawPrint /> }),
          }, () => <PetPage library={library} inSettings startChat={() =>
            c.layout.openNewChat("Help me create a new Mofli pet. Use pets_catalog to discover available skins and accessories, discuss the design with me, then use pets_save to create it in my Amiba pet library.")
          } />),
        ),
        c.slots.inject("amiba.workspace.view", () =>
          c.slots.register(
            {
              name: "amiba.workspace.view",
              id: "pets",
              label,
              inject: () => ({
                library,
                startChat: () =>
                  c.layout.openNewChat(
                    "Help me create a new Mofli pet. Use pets_catalog to discover available skins and accessories, discuss the design with me, then use pets_save to create it in my Amiba pet library.",
                  ),
              }),
            },
            PetPage,
          ),
        ),
        c.slots.inject("amiba.emptyState.visual", () =>
          c.slots.register(
            {
              name: "amiba.emptyState.visual",
              id: "mofli",
              label,
              inject: () => ({ library }),
            },
            (props) => <Companion {...props} priority={30} />,
          ),
        ),
      ];
      return () => {
        off.reverse().forEach((f) => f());
        library.dispose();
      };
    },
  );
  await fiber;
  return async () => {
    await fiber.dispose();
    await unmount();
  };
}
