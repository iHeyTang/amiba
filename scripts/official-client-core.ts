import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { Plugin } from "vite";

/** Consume published core exports without mounting the official product UI.
 * DSH publishes these exports inside registration factories, not ESM files.
 * Extract the factory at build time and retain its singleton imports as ESM
 * externals. Its apply function is never called and no global factory is added.
 */
export function officialClientCore(ownerUrl: string, exportsByModule: Record<string, string[]>): Plugin {
  const require = createRequire(ownerUrl);
  const prefix = "\0amiba-official-core:";
  return {
    name: "amiba-official-client-core",
    enforce: "pre",
    resolveId(id) { if (exportsByModule[id]) return prefix + id; },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const specifier = id.slice(prefix.length);
      const file = require.resolve(specifier);
      this.addWatchFile(file);
      let registration: { id: string; factory: Function } | undefined;
      runInNewContext(readFileSync(file, "utf8"), { window: { __ModuleLoader__: { load(value: typeof registration) { registration = value; } } } }, { filename: file, timeout: 1000 });
      if (registration?.id !== specifier.replace(/\/client$/, "") || typeof registration.factory !== "function") throw new Error(`Invalid official client factory: ${specifier}`);
      const factory = registration.factory.toString();
      const imports = [...new Set([...factory.matchAll(/require\("([^"\n]+)"\)/g)].map(match => match[1]!))];
      for (const name of exportsByModule[specifier]!) if (!factory.includes(`exports.${name} =`)) throw new Error(`Official client export missing: ${specifier}.${name}`);
      return [
        ...imports.map((name, index) => `import * as dependency${index} from ${JSON.stringify(name)};`),
        `const official = (${factory})(name => { switch (name) { ${imports.map((name, index) => `case ${JSON.stringify(name)}: return dependency${index};`).join(" ")} default: throw new Error("Unexpected official core dependency: " + name); } });`,
        ...exportsByModule[specifier]!.map(name => `export const ${name} = official.${name};`),
      ].join("\n");
    },
  };
}
