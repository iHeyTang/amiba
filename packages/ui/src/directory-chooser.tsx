import { createContext, useContext, useMemo } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";

export type DirectoryAdoption = (path: string) => Promise<unknown>;
export type DirectoryChooser = (
  defaultPath: string | undefined,
  adopt: DirectoryAdoption,
) => Promise<string | null>;
export const DirectoryChooserContext = createContext<{
  home?: DirectoryChooser;
  workspace?: DirectoryChooser;
}>({});

/** The caller retains its existing write authority; extensions only choose paths. */
export function useDirectoryChooser(surface: "home" | "workspace") {
  const contributed = useContext(DirectoryChooserContext)[surface];
  const native = getPlatform().workspaces?.chooseDirectory;
  return useMemo<DirectoryChooser | undefined>(() => {
    if (contributed) return contributed;
    if (!native) return undefined;
    return async (defaultPath, adopt) => {
      const path = await native(defaultPath);
      if (path) await adopt(path);
      return path;
    };
  }, [contributed, native]);
}
