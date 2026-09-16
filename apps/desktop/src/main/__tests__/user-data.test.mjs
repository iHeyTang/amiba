import assert from "node:assert/strict";
import test from "node:test";

const {
  resolveUserDataOverride,
  resolveDesktopUserData,
  desktopOsIntegrationEnabled,
} = await import("../user-data.ts");

test("accepts only an explicit absolute Amiba user-data directory", () => {
  assert.equal(resolveUserDataOverride(undefined), null);
  assert.equal(resolveUserDataOverride("  "), null);
  assert.equal(
    resolveUserDataOverride(" /tmp/amiba-dsh-fresh/user-data/../user-data "),
    "/tmp/amiba-dsh-fresh/user-data",
  );
  assert.throws(
    () => resolveUserDataOverride("relative/user-data"),
    /absolute/,
  );
});

test("preview and release use distinct persistent directories", () => {
  for (const directory of [
    "/Users/test/Library/Application Support/@amiba/desktop",
    "C:\\Users\\test\\AppData\\Roaming\\@amiba\\desktop",
    "/home/test/.config/@amiba/desktop",
  ]) {
    assert.equal(resolveDesktopUserData(undefined, directory, true), directory);
    assert.equal(
      resolveDesktopUserData(undefined, directory, false),
      `${directory}-dev`,
    );
    assert.equal(
      resolveDesktopUserData("  ", directory, false),
      `${directory}-dev`,
    );
  }
});

test("explicit preview and fresh-profile directories retain precedence", () => {
  const directory = process.cwd();
  for (const packaged of [true, false]) {
    assert.equal(
      resolveDesktopUserData(directory, "/default", packaged),
      directory,
    );
    assert.throws(
      () => resolveDesktopUserData("relative", "/default", packaged),
      /absolute/,
    );
  }
});

test("OS shortcuts and protocol registration belong to release by default", () => {
  assert.equal(desktopOsIntegrationEnabled(true, undefined), true);
  assert.equal(desktopOsIntegrationEnabled(false, undefined), false);
  assert.equal(desktopOsIntegrationEnabled(false, "0"), false);
  assert.equal(desktopOsIntegrationEnabled(false, "1"), true);
});
