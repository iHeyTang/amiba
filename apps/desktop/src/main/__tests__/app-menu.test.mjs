import assert from "node:assert/strict";
import test from "node:test";

const { SETTINGS_ACCELERATOR, buildAppMenuTemplate } = await import(
  "../app-menu.ts"
);

function findByLabel(template, label) {
  for (const menu of template) {
    for (const item of menu.submenu ?? []) {
      if (item.label === label) return item;
    }
  }
  return undefined;
}

test("settings accelerator is the platform-standard ⌘, / Ctrl+,", () => {
  assert.equal(SETTINGS_ACCELERATOR, "CommandOrControl+,");
});

test("macOS puts Settings… in the app menu with the ⌘, accelerator", () => {
  const template = buildAppMenuTemplate({
    platform: "darwin",
    appName: "Amiba",
    onOpenSettings: () => {},
  });
  assert.equal(template[0].label, "Amiba");
  const item = findByLabel(template, "Settings…");
  assert.ok(item, "Settings… item present");
  assert.equal(item.accelerator, SETTINGS_ACCELERATOR);
  assert.ok(
    template[0].submenu.includes(item),
    "Settings… lives in the app menu on macOS",
  );
});

test("Windows/Linux put Settings… in the File menu", () => {
  const template = buildAppMenuTemplate({
    platform: "win32",
    appName: "Amiba",
    onOpenSettings: () => {},
  });
  assert.equal(template[0].label, "File");
  const item = findByLabel(template, "Settings…");
  assert.ok(item, "Settings… item present");
  assert.equal(item.accelerator, SETTINGS_ACCELERATOR);
  assert.ok(template[0].submenu.includes(item));
  assert.ok(
    template[0].submenu.some((entry) => entry.role === "quit"),
    "File menu keeps the quit entry",
  );
});

test("clicking Settings… invokes the handler", () => {
  let calls = 0;
  const template = buildAppMenuTemplate({
    platform: "darwin",
    appName: "Amiba",
    onOpenSettings: () => {
      calls += 1;
    },
  });
  findByLabel(template, "Settings…").click();
  assert.equal(calls, 1);
});

test("the standard Edit roles survive so copy/paste keep working", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const template = buildAppMenuTemplate({
      platform,
      appName: "Amiba",
      onOpenSettings: () => {},
    });
    const edit = template.find((menu) => menu.label === "Edit");
    assert.ok(edit, `${platform}: Edit menu present`);
    const roles = new Set(edit.submenu.map((entry) => entry.role));
    for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
      assert.ok(roles.has(role), `${platform}: Edit has ${role}`);
    }
  }
});
