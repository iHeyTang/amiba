import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as ts from "typescript";

export const HERMES_LOCAL_MODE = Object.freeze({
  BUILT_IN: "built-in",
  DIRECT_SOURCE: "direct-source",
});

export function defineAmibaConfig(config) {
  return config;
}

export function parseDesktopLocalConfig(value, repositoryRoot) {
  if (value == null) {
    return { hermesMode: HERMES_LOCAL_MODE.BUILT_IN };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the root value must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "hermes") {
      throw new Error(`unknown root property: ${key}`);
    }
  }

  const hermes = value.hermes;
  if (hermes == null) {
    return { hermesMode: HERMES_LOCAL_MODE.BUILT_IN };
  }
  if (typeof hermes !== "object" || Array.isArray(hermes)) {
    throw new Error("hermes must be an object");
  }
  for (const key of Object.keys(hermes)) {
    if (!["mode", "source"].includes(key)) {
      throw new Error(`unknown hermes property: ${key}`);
    }
  }

  const mode = hermes.mode ?? HERMES_LOCAL_MODE.BUILT_IN;
  if (mode === HERMES_LOCAL_MODE.BUILT_IN) {
    return { hermesMode: HERMES_LOCAL_MODE.BUILT_IN };
  }
  if (mode !== HERMES_LOCAL_MODE.DIRECT_SOURCE) {
    throw new Error('hermes.mode must be "built-in" or "direct-source"');
  }
  if (typeof hermes.source !== "string" || hermes.source.trim().length === 0) {
    throw new Error(
      'hermes.source must be a path when hermes.mode is "direct-source"',
    );
  }

  return {
    hermesMode: HERMES_LOCAL_MODE.DIRECT_SOURCE,
    hermesSource: path.resolve(repositoryRoot, hermes.source),
  };
}

export async function loadDesktopLocalConfig(configPath, repositoryRoot) {
  let source;
  try {
    source = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return parseDesktopLocalConfig(undefined, repositoryRoot);
    }
    throw new Error(`could not read ${configPath}: ${error.message}`);
  }

  const transpiled = ts.transpileModule(source, {
    fileName: configPath,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    const message = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("; ");
    throw new Error(`invalid TypeScript in ${configPath}: ${message}`);
  }

  const compiledPath = path.join(
    path.dirname(configPath),
    `.amiba.local.generated-${process.pid}-${Date.now()}.mjs`,
  );
  try {
    fs.writeFileSync(compiledPath, transpiled.outputText, "utf8");
    const loaded = await import(pathToFileURL(compiledPath).href);
    if (!("default" in loaded)) {
      throw new Error(
        `${configPath} must export a default configuration object`,
      );
    }
    return parseDesktopLocalConfig(loaded.default, repositoryRoot);
  } catch (error) {
    throw new Error(`could not evaluate ${configPath}: ${error.message}`);
  } finally {
    fs.rmSync(compiledPath, { force: true });
  }
}
