/**
 * MemOS 2.0.18's >=0.1.0-rc.5 <0.2.0 peer range excludes 0.1.1 prereleases
 * under npm semver. Keep its DSH peers on the host's tested exact version;
 * never bypass peer validation globally or install a second DSH runtime.
 */
export function memoryPeerOverrides(dshVersion) {
  return {
    "@memtensor/memos-local-plugin@2.0.18": Object.fromEntries(
      ["agent", "llm", "session", "system-prompt", "timeout", "tools"].map(
        (name) => [`@deepseek-ai/dsh-${name}`, dshVersion],
      ),
    ),
  };
}
