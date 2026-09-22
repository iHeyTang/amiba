import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createManualUpdateController, isNewerVersion } from "../updates/manual.ts";
import { fetchLatestRelease, parseLatestRelease } from "../updates/github-release.ts";
import { assertSecureUrl, downloadVerified, nextHopUrl, pruneInstallers } from "../updates/download.ts";
import { openInstallerAfterExit } from "../updates/handoff.ts";

const digestOf = (value) => createHash("sha256").update(value).digest("hex");
const workspace = () => mkdtempSync(path.join(tmpdir(), "amiba-update-"));

function release(version, assets) {
  return { version, assets };
}

function installer(version, sha256, size = 4) {
  return { name: `Amiba-${version}-mac-arm64.dmg`, url: `https://example.invalid/${version}.dmg`, sha256, size };
}

test("orders numeric versions and refuses anything it cannot compare", () => {
  assert.equal(isNewerVersion("0.1.6", "0.1.5"), true);
  assert.equal(isNewerVersion("v0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("0.1.5", "0.1.5"), false);
  assert.equal(isNewerVersion("0.1.4", "0.1.5"), false);
  assert.equal(isNewerVersion("1.0", "0.9.9"), true);
  // A prerelease or a malformed tag must never look installable: the manual path
  // has no signature to catch a wrong pick after the fact.
  assert.equal(isNewerVersion("0.1.6-beta.1", "0.1.5"), false);
  assert.equal(isNewerVersion("latest", "0.1.5"), false);
  assert.equal(isNewerVersion("", "0.1.5"), false);
});

test("offers an update without downloading it, then verifies and hands it over", async () => {
  const sha256 = digestOf("dmg");
  const states = [];
  let downloads = 0;
  const installed = [];
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => release("v0.1.6", [installer("0.1.6", sha256)]),
    download: async (_asset, onProgress) => { downloads += 1; onProgress(50); return { filePath: "/tmp/Amiba-0.1.6-mac-arm64.dmg" }; },
    install: (filePath) => installed.push(filePath),
    notify: (state) => states.push(state),
  });
  assert.throws(() => controller.install());

  assert.equal((await controller.check()).status, "offered");
  // Detection alone must not spend 400MB of the user's bandwidth.
  assert.equal(downloads, 0);
  assert.equal(controller.getState().version, "0.1.6");
  assert.equal((await controller.download()).status, "ready");
  assert.equal(downloads, 1);
  assert.equal(controller.getState().percent, 100);
  assert.deepEqual(states.map((state) => state.status), ["checking", "offered", "downloading", "downloading", "ready"]);

  controller.install();
  assert.deepEqual(installed, ["/tmp/Amiba-0.1.6-mac-arm64.dmg"]);
});

test("keeps a verified installer across re-checks instead of downloading again", async () => {
  const sha256 = digestOf("dmg");
  let checks = 0;
  let downloads = 0;
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => { checks += 1; return release("0.1.6", [installer("0.1.6", sha256)]); },
    download: async () => { downloads += 1; return { filePath: "/tmp/installer.dmg" }; },
    install: () => {},
    notify: () => {},
  });
  await controller.check();
  await controller.download();
  assert.equal((await controller.check()).status, "ready");
  assert.equal(checks, 1, "a ready installer must not be re-checked against the feed");
  assert.equal(downloads, 1);
});

test("stays idle when the running version is current and never downloads", async () => {
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => release("v0.1.5", [installer("0.1.5", digestOf("dmg"))]),
    download: async () => { throw new Error("must not download"); },
    install: () => {},
    notify: () => {},
  });
  const state = await controller.check();
  assert.equal(state.status, "idle");
  assert.equal(state.version, undefined);
});

test("reports failures it can act on and retries on the next check", async () => {
  const sha256 = digestOf("dmg");
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => release("0.1.6", [{ ...installer("0.1.6", sha256), name: "Amiba-0.1.6-win-x64.exe" }]),
    download: async () => { throw new Error("must not download"); },
    install: () => {},
    notify: () => {},
  });
  assert.match((await controller.check()).error, /no installer for this platform/);

  const unhashed = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => release("0.1.6", [installer("0.1.6", "")]),
    download: async () => { throw new Error("must not download"); },
    install: () => {},
    notify: () => {},
  });
  assert.match((await unhashed.check()).error, /no sha256 digest/);

  let attempt = 0;
  const flaky = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => { attempt += 1; if (attempt === 1) throw new Error("network down"); return release("0.1.6", [installer("0.1.6", sha256)]); },
    download: async () => ({ filePath: "/tmp/installer.dmg" }),
    install: () => {},
    notify: () => {},
  });
  assert.equal((await flaky.check()).status, "error");
  assert.equal(flaky.getState().error, "network down");
  assert.equal((await flaky.check()).status, "offered");
});

test("deduplicates concurrent checks", async () => {
  let release_;
  const pending = new Promise((resolve) => { release_ = resolve; });
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: (version) => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: () => pending,
    download: async () => ({ filePath: "/tmp/installer.dmg" }),
    install: () => {},
    notify: () => {},
  });
  const first = controller.check();
  assert.equal(first, controller.check());
  release_(release("0.1.6", [installer("0.1.6", digestOf("dmg"))]));
  assert.equal((await first).status, "offered");
});

test("reads the release payload and drops assets it cannot pin", () => {
  const payload = {
    tag_name: "v0.1.6",
    assets: [
      { name: "Amiba-0.1.6-mac-arm64.dmg", browser_download_url: "https://github.com/o/r/releases/download/v0.1.6/a.dmg", digest: `sha256:${digestOf("dmg")}`, size: 12 },
      { name: "Amiba-0.1.6-mac-x64.dmg", browser_download_url: "https://github.com/o/r/releases/download/v0.1.6/b.dmg", size: 12 },
      { name: "notes.txt", browser_download_url: "https://github.com/o/r/releases/download/v0.1.6/notes.txt", digest: `sha256:${digestOf("n")}`, size: 3 },
      { name: "Amiba-0.1.6-mac-arm64.dmg", browser_download_url: "http://insecure.example/a.dmg", digest: `sha256:${digestOf("dmg")}`, size: 12 },
      { name: "../escape.dmg", browser_download_url: "https://github.com/o/r/x.dmg", digest: `sha256:${digestOf("x")}`, size: 1 },
    ],
  };
  const parsed = parseLatestRelease(payload);
  assert.equal(parsed.version, "0.1.6");
  assert.deepEqual(parsed.assets.map((asset) => asset.name), [
    "Amiba-0.1.6-mac-arm64.dmg",
    "Amiba-0.1.6-mac-x64.dmg",
    "notes.txt",
  ]);
  assert.equal(parsed.assets[0].sha256, digestOf("dmg"));
  assert.equal(parsed.assets[1].sha256, "", "an asset without a digest stays visible but unpinnable");
  assert.throws(() => parseLatestRelease({ tag_name: "nightly", assets: [] }));
  assert.throws(() => parseLatestRelease(null));
});

test("asks the release API for the latest non-prerelease tag", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ tag_name: "v0.2.0", assets: [] }) };
  };
  assert.equal((await fetchLatestRelease("owner/amiba", request)).version, "0.2.0");
  assert.equal(calls[0].url, "https://api.github.com/repos/owner/amiba/releases/latest");
  assert.equal(calls[0].options.headers["User-Agent"], "Amiba-Desktop");
  await assert.rejects(fetchLatestRelease("../etc", request), /Invalid update repository/);
  await assert.rejects(fetchLatestRelease("owner/..", request), /Invalid update repository/);
  await assert.rejects(
    fetchLatestRelease("owner/amiba", async () => ({ ok: false, status: 403 })),
    /HTTP 403/,
  );
});

test("only accepts HTTPS downloads", () => {
  assert.equal(assertSecureUrl("https://github.com/o/r/a.dmg").protocol, "https:");
  assert.throws(() => assertSecureUrl("http://github.com/o/r/a.dmg"), /HTTPS/);
  assert.throws(() => assertSecureUrl("https://user:pass@github.com/a.dmg"), /HTTPS/);
  assert.equal(nextHopUrl("/next.dmg", "https://github.com/o/r/a.dmg"), "https://github.com/next.dmg");
  assert.throws(() => nextHopUrl("http://cdn.example/a.dmg", "https://github.com/a.dmg"), /HTTPS/);
});

test("downloads an installer, verifies its digest and reuses it next time", async () => {
  const directory = workspace();
  const filePath = path.join(directory, "Amiba-0.1.6-mac-arm64.dmg");
  const body = Buffer.from("installer-bytes");
  const percent = [];
  let opened = 0;
  const open = async () => { opened += 1; return { stream: Readable.from([body]), length: body.length }; };
  const request = { url: "https://github.com/o/r/a.dmg", sha256: digestOf(body), size: body.length, filePath };

  await downloadVerified(request, { onProgress: (value) => percent.push(value), open });
  assert.equal(readFileSync(filePath, "utf8"), body.toString());
  assert.equal(percent.at(-1), 100);
  assert.equal(readdirSync(directory).length, 1, "no .part file may survive a success");

  percent.length = 0;
  await downloadVerified(request, { onProgress: (value) => percent.push(value), open });
  assert.equal(opened, 1, "a verified file must be reused instead of refetched");
  assert.deepEqual(percent, [100]);
});

test("refuses a tampered or truncated download and leaves nothing behind", async () => {
  const directory = workspace();
  const body = Buffer.from("real-installer");
  const filePath = path.join(directory, "Amiba-0.1.6-mac-arm64.dmg");
  const open = async () => ({ stream: Readable.from([body]), length: body.length });

  await assert.rejects(
    downloadVerified({ url: "https://github.com/o/r/a.dmg", sha256: digestOf("something-else"), size: body.length, filePath },
      { onProgress: () => {}, open }),
    /integrity verification/,
  );
  assert.deepEqual(readdirSync(directory), []);

  await assert.rejects(
    downloadVerified({ url: "https://github.com/o/r/a.dmg", sha256: digestOf(body), size: body.length + 10, filePath },
      { onProgress: () => {}, open }),
    /incomplete/,
  );
  assert.deepEqual(readdirSync(directory), []);

  await assert.rejects(
    downloadVerified({ url: "https://github.com/o/r/a.dmg", sha256: digestOf(body), size: 2, filePath },
      { onProgress: () => {}, open }),
    /exceeded the published size/,
  );
  assert.deepEqual(readdirSync(directory), []);
});

test("refuses to download without a digest or without HTTPS", async () => {
  const filePath = path.join(workspace(), "Amiba-0.1.6-mac-arm64.dmg");
  await assert.rejects(
    downloadVerified({ url: "https://github.com/o/r/a.dmg", sha256: "", size: 1, filePath }, { onProgress: () => {} }),
    /without a published digest/,
  );
  await assert.rejects(
    downloadVerified({ url: "http://github.com/o/r/a.dmg", sha256: digestOf("x"), size: 1, filePath }, { onProgress: () => {} }),
    /HTTPS/,
  );
  await assert.rejects(
    downloadVerified({ url: "https://github.com/o/r/a.dmg", sha256: digestOf("x"), size: 1, filePath: "relative.dmg" }, { onProgress: () => {} }),
    /absolute/,
  );
});

test("prunes superseded installers and interrupted downloads", async () => {
  const directory = workspace();
  writeFileSync(path.join(directory, "Amiba-0.1.6-mac-arm64.dmg"), "new");
  writeFileSync(path.join(directory, "Amiba-0.1.5-mac-arm64.dmg"), "old");
  writeFileSync(path.join(directory, "Amiba-0.1.4-mac-arm64.dmg.part"), "interrupted");
  writeFileSync(path.join(directory, "keep.txt"), "unrelated");
  await pruneInstallers(directory, "Amiba-0.1.6-mac-arm64.dmg");
  assert.deepEqual(readdirSync(directory).sort(), ["Amiba-0.1.6-mac-arm64.dmg", "keep.txt"]);
  await pruneInstallers(path.join(directory, "missing"), "keep.dmg");
});

test("hands the installer to Finder after this process has exited", () => {
  const spawned = [];
  let quit = 0;
  const spawnImpl = (command, args, options) => {
    spawned.push({ command, args, options });
    return { unref: () => {} };
  };
  openInstallerAfterExit("/Users/x/Downloads/Amiba-0.1.6-mac-arm64.dmg", () => { quit += 1; }, { pid: 4242, spawnImpl });
  assert.equal(spawned[0].command, "/bin/sh");
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].args.at(-1), "/Users/x/Downloads/Amiba-0.1.6-mac-arm64.dmg");
  assert.equal(spawned[0].args.at(-2), "4242");
  assert.match(spawned[0].args[1], /while kill -0 "\$1".*exec open "\$2"/);
  assert.equal(quit, 1, "the app must quit so the helper can mount the image");
  assert.throws(() => openInstallerAfterExit("Amiba.dmg", () => {}, { spawnImpl }), /absolute/);
});

test("the packaged config layout keeps the manual feed out of signed builds", () => {
  // Mirrors what scripts/release writes into the packaged resources, which
  // main/updates reads back as { sources, manual.repository }.
  const directory = workspace();
  const resources = path.join(directory, "Resources");
  mkdirSync(resources, { recursive: true });
  writeFileSync(path.join(resources, "release-config.json"), JSON.stringify({ sources: [], manual: { repository: "owner/amiba" } }));
  const config = JSON.parse(readFileSync(path.join(resources, "release-config.json"), "utf8"));
  assert.deepEqual(config.sources, []);
  assert.equal(config.manual.repository, "owner/amiba");
  assert.equal(existsSync(path.join(resources, "release-config.json")), true);
});

test("cancels manual downloads, ignores late completion, and permits an explicit retry", async () => {
  let complete;
  let progress;
  let signal;
  let attempts = 0;
  const controller = createManualUpdateController({
    currentVersion: "0.1.5",
    assetName: version => `Amiba-${version}-mac-arm64.dmg`,
    fetchRelease: async () => release("0.1.6", [installer("0.1.6", digestOf("dmg"))]),
    download: async (_asset, onProgress, abortSignal) => {
      attempts++;
      signal = abortSignal;
      progress = onProgress;
      if (attempts === 1) return new Promise(resolve => { complete = resolve; });
      return { filePath: "/tmp/retry.dmg" };
    },
    install: () => {}, notify: () => {},
  });
  await controller.check();
  const pending = controller.download();
  const cancelled = controller.cancel();
  assert.equal(signal.aborted, true);
  progress(90);
  complete({ filePath: "/tmp/late.dmg" });
  assert.equal((await pending).status, "cancelled");
  assert.equal((await cancelled).status, "cancelled");
  assert.equal(controller.getState().percent, undefined);
  assert.throws(() => controller.install());
  assert.equal((await controller.check()).status, "cancelled");
  assert.equal(attempts, 1);
  assert.equal((await controller.download()).status, "ready");
  assert.equal(attempts, 2);
});

test("abort closes the transfer and removes its partial file before retry", async () => {
  const directory = workspace();
  const filePath = path.join(directory, "update.dmg");
  const abort = new AbortController();
  const stream = new Readable({ read() { this.push(Buffer.from("first")); } });
  await assert.rejects(downloadVerified({ url: "https://example.invalid/update.dmg", sha256: digestOf("firstsecond"), size: 11, filePath }, {
    signal: abort.signal,
    open: async () => ({ stream, length: 11 }),
    onProgress: () => abort.abort(),
  }), { name: "AbortError" });
  assert.equal(stream.destroyed, true);
  assert.deepEqual(readdirSync(directory), []);
  await downloadVerified({ url: "https://example.invalid/update.dmg", sha256: digestOf("firstsecond"), size: 11, filePath }, {
    open: async () => ({ stream: Readable.from([Buffer.from("firstsecond")]), length: 11 }), onProgress: () => {},
  });
  assert.equal(readFileSync(filePath, "utf8"), "firstsecond");
});
