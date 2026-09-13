import path from "node:path";
import { realpathSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const defaultWorkspaceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Build-only metadata. DSH still consumes the unchanged client.js factory.
 * Include parsed, tree-shaken modules as well as emitted ones so adding a
 * side effect to a previously unused shared export still invalidates clients.
 */
export function clientInputs({ workspaceDir = defaultWorkspaceDir } = {}) {
  workspaceDir = realpathSync(workspaceDir);
  let manifest;
  return {
    name: "amiba-client-inputs",
    configResolved(config) {
      manifest = JSON.parse(readFileSync(path.join(config.root, "package.json"), "utf8"));
    },
    generateBundle(_options, bundle) {
      if (manifest.name !== '@amiba/dsh-plugin-ui-shell' && [...this.getModuleIds()].some(file => file.replaceAll('\\', '/').endsWith('/packages/app-runtime/src/platform/index.ts'))) {
        this.error(`${manifest.name}: import the platform interface from @amiba/dsh-plugin-ui-shell/client; do not bundle the host singleton`);
      }
      const normalize = value => value.replace(/\/client$/, "");
      const declared = new Set((manifest.dsh?.client?.external ?? []).map(normalize));
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const request of chunk.imports) {
          if (!declared.has(normalize(request))) {
            this.error(`${manifest.name}: emitted require(${JSON.stringify(request)}) is missing from dsh.client.external; inject does not declare module arrival dependencies`);
          }
        }
      }
      const files = [
        ...new Set(
          [...this.getWatchFiles(), ...this.getModuleIds()]
            .filter((file) => !file.startsWith("\0"))
            .map((file) => file.split("?")[0])
            .filter(
              (file) =>
                path.isAbsolute(file) &&
                file.startsWith(workspaceDir + path.sep) &&
                !file.includes(`${path.sep}node_modules${path.sep}`),
            ),
        ),
      ].sort();
      this.emitFile({
        type: "asset",
        fileName: ".client-inputs.json",
        source: JSON.stringify({ version: 1, workspaceDir, files }),
      });
    },
  };
}
