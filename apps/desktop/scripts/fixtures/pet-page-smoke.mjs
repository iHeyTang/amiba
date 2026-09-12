import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
app.setPath("userData", process.env.AMIBA_SURFACE_PROFILE);
app.whenReady().then(async () => {
const win = new BrowserWindow({
  width: 1120,
  height: 850,
  show: true,
  webPreferences: { contextIsolation: true, nodeIntegration: false },
});
const errors = [];
win.webContents.on("console-message", (_e, level, message) => {
  if (level >= 2) errors.push(message);
});
const js = (code) => win.webContents.executeJavaScript(code, true);
const wait = async (code) => {
  for (let i = 0; i < 200; i++) {
    if (await js(code)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timeout: " + code);
};
const button = async (label) => {
  await wait(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)})`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
};
const capture = async (name) => {
  await new Promise((r) => setTimeout(r, 300));
  await writeFile(
    "/tmp/" + name + ".png",
    (await win.webContents.capturePage()).toPNG(),
  );
};
try {
  await win.loadURL(process.env.AMIBA_SURFACE_URL);
  await wait('!!document.querySelector("[data-pet-preview] svg path")');
  await js(
    `document.body.style.padding='0';document.querySelector('[data-switch]').style.display='none';document.querySelector('[data-testid=pets-page]').parentElement.style.height='100vh';const s=document.createElement('style');s.textContent='header{margin-bottom:0}';document.head.append(s)`,
  );
  if (!await js('document.querySelector("[data-testid=pets-page] header").getBoundingClientRect().height === 40')) throw Error("Header must use shared 40px geometry");
  await button("Save pet");
  await wait('document.querySelectorAll("[data-pet-record]").length===1');
  await button("New pet");
  await js('document.querySelectorAll("[data-pet-skin]")[4].click()');
  await button("Save pet");
  await wait('document.querySelectorAll("[data-pet-record]").length===2');
  await button("Use as companion");
  await wait(
    'document.querySelectorAll("[data-pet-record]")[1].textContent.includes("Active")',
  );
  await capture("amiba-pets-redesign");
  await button("Accessories");
  await button("Twin Sprout");
  await button("Save pet");
  await wait('document.body.textContent.includes("All changes saved")');
  await capture("amiba-pets-redesign-accessories");
  await js('document.documentElement.lang="zh-CN"');
  await wait('document.body.textContent.includes("实时预览")');
  await capture("amiba-pets-redesign-zh");
  await js('document.documentElement.classList.add("dark")');
  await capture("amiba-pets-redesign-dark");
  await js('document.documentElement.classList.remove("dark")');
  win.setSize(600, 850);
  await new Promise((r) => setTimeout(r, 300));
  if (!(await js("document.documentElement.scrollWidth<=innerWidth")))
    throw Error("Horizontal overflow");
  await capture("amiba-pets-redesign-narrow");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Pet page passed: thumbnails, creation, skin changes, activation, accessory save, localization, dark and narrow layouts.",
  );
  app.exit(0);
} catch (e) {
  console.error(e);
  await capture("amiba-pets-redesign-failure");
  app.exit(1);
}

});
