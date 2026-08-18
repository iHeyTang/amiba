import assert from "node:assert/strict";
import test from "node:test";

const { inboxSocketPathFor } = await import("../external-inbox-path.ts");

test("uses a profile-local Unix socket on macOS and Linux", () => {
  assert.equal(
    inboxSocketPathFor("darwin", "/tmp/amiba-profile"),
    "/tmp/amiba-profile/inbox.sock",
  );
  assert.equal(
    inboxSocketPathFor("linux", "/tmp/amiba-profile"),
    "/tmp/amiba-profile/inbox.sock",
  );
});

test("uses a stable profile-specific Windows named pipe", () => {
  const first = inboxSocketPathFor("win32", "C:\\Users\\A\\Amiba");
  const again = inboxSocketPathFor("win32", "C:\\Users\\A\\Amiba");
  const other = inboxSocketPathFor("win32", "C:\\Users\\B\\Amiba");

  assert.equal(first.startsWith("\\\\.\\pipe\\amiba-inbox-"), true);
  assert.match(first.slice("\\\\.\\pipe\\amiba-inbox-".length), /^[0-9a-f]{16}$/);
  assert.equal(first, again);
  assert.notEqual(first, other);
});
