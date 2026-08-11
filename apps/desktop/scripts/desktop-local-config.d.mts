export type HermesLocalConfig =
  | {
      mode?: "built-in";
      /** Optional path retained while direct-source mode is disabled. */
      source?: string;
    }
  | {
      /** Directly execute a source checkout instead of the prepared copy. */
      mode: "direct-source";
      /** Absolute path, or a path relative to the Amiba repository root. */
      source: string;
    };

export interface AmibaLocalConfig {
  hermes?: HermesLocalConfig;
}

export declare function defineAmibaConfig(
  config: AmibaLocalConfig,
): AmibaLocalConfig;
