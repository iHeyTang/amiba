// Short-lived compiler: exiting releases Vite/Rollup/PostCSS caches to the OS.
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";

const [directory, outDir, reportPath] = process.argv.slice(2);
try {
  const result = await build({
    root: directory,
    configFile: path.join(directory, "vite.config.ts"),
    mode: "development",
    clearScreen: false,
    logLevel: "error",
    ...(fs.existsSync(path.join(directory, "postcss.config.cjs"))
      ? {
          css: {
            postcss: {
              plugins: [
                tailwindcss({
                  config: path.join(directory, "tailwind.config.cjs"),
                }),
                autoprefixer(),
              ],
            },
          },
        }
      : {}),
    build: {
      outDir,
      emptyOutDir: false,
      // These are still the plugin's own CJS factory, externals and assets.
      // Skip production minification on the interactive development path.
      minify: false,
      watch: null,
      rollupOptions: {
        output: {
          // The bundle moves from a staging directory into the managed runtime.
          // Keep debugger source locations valid after that move.
          sourcemapPathTransform(source, mapPath) {
            return path.resolve(path.dirname(mapPath), source).split(path.sep).join("/");
          },
        },
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  });
  if (reportPath) {
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (result) => result.output,
    );
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        outputs
          .filter((item) => item.type === "chunk")
          .map((item) => ({
            fileName: item.fileName,
            exports: item.exports,
            imports: item.imports,
            importedBindings: item.importedBindings,
            modules: Object.keys(item.modules),
          })),
      ),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
