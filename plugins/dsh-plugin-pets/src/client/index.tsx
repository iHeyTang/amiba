import type {} from "@amiba/dsh-plugin-onboarding/client";
import { GuideCompanion } from "./GuideCompanion.js";
import type {} from "@amiba/dsh-plugin-notification-hub/client";
import { DesktopPet } from "./desktop.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import { getPlatform } from "@amiba/dsh-plugin-ui-shell/client";
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
      // The desktop pet window is a standalone page that never boots the DSH
      // shell. This plugin instance (the main window) already holds the live
      // pet library + notification feed, so it forwards snapshots over IPC;
      // pet activation and bubble dismissal come back the same way.
      const bridge = getPlatform().desktopPet;
      const forwarders: (() => void)[] = [];
      if (bridge) {
        const push = () => {
          const snapshot = library.getSnapshot().library;
          void bridge.forwardData({
            pets: snapshot.pets.map(({ id, name, config, updatedAt }) => ({
              id,
              name,
              config,
              updatedAt,
            })),
            activeId: snapshot.activeId,
            notifications: c.amibaNotificationFeed.getSnapshot(),
            connection: c.amibaNotificationFeed.getConnectionSnapshot(),
          });
        };
        forwarders.push(library.subscribe(push));
        forwarders.push(c.amibaNotificationFeed.subscribe(push));
        forwarders.push(
          bridge.onActivateRequest((id) => void library.activate(id)),
        );
        forwarders.push(bridge.onDataRequest(() => push()));
        forwarders.push(
          bridge.onDismissRequest(
            (id) => void c.amibaNotificationFeed.dismiss(id),
          ),
        );
        push();
      }
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
        forwarders.forEach((f) => f());
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
