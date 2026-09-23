/** Package declared in the active DSH profile. */
export interface AmibaDshProfilePlugin {
  packageName: string;
  requestedSpec: string;
  version?: string;
  bundle: boolean;
  source?: "internal" | "external";
  development?: boolean;
  mutable?: boolean;
}

export interface AmibaDshPluginMutationResult {
  action: "install" | "remove" | "update";
  packageName: string;
  packages: readonly AmibaDshProfilePlugin[];
}

/**
 * Electron-only native boundary used by the DSH plugin-management Client.
 *
 * The bridge does not register or activate plugins itself. Every mutation is
 * delegated to DSH's official `dsh plugin --profile web ...` command and the
 * renderer is reloaded only after the rebuilt Host and Client graph is ready.
 */
export interface AmibaDshPluginManagerBridge {
  list(): Promise<{
    packages: readonly AmibaDshProfilePlugin[];
    readOnly?: boolean;
  }>;
  installRegistry(spec: string): Promise<AmibaDshPluginMutationResult>;
  installArchive(): Promise<AmibaDshPluginMutationResult | null>;
  remove(packageName: string): Promise<AmibaDshPluginMutationResult>;
  update(packageName: string): Promise<AmibaDshPluginMutationResult>;
}
