import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const runtimeRequire = createRequire(realpathSync(new URL("../../../../../packages/extension-sdk/node_modules/@deepseek-ai/dsh-client-runtime/package.json", import.meta.url)));
const source = readFileSync(join(dirname(runtimeRequire.resolve("@deepseek-ai/dsh-client-connection/package.json")), "lib/client.js"), "utf8");

for (const [page, transport, expected] of [
  ["file:///app/index.html", "http://127.0.0.1:8080", true],
  ["file:///app/index.html", "http://[::1]:8080", true],
  ["file:///app/index.html", "https://remote.example", false],
  ["file:///app/index.html", undefined, false],
  ["https://remote.example", "http://127.0.0.1:8080", false],
  ["http://localhost:8080", undefined, true],
]) test(`official connection authority ${page} via ${transport}`, () => {
  let plugin;
  let connection;
  runInNewContext(source, {
    URL, URLSearchParams, console,
    location: new URL(page),
    __AMIBA_DSH_TRANSPORT_URL__: transport,
    window: { __ModuleLoader__: { load: ({factory}) => { plugin = factory(); } } },
  });
  plugin.apply({ provide: (key, value) => { if (key === "connection") connection = value; } });
  assert.equal(connection.isLoopback, expected);
});
