import { app, session, BrowserWindow } from "electron";
import { CookieImporter } from "../../../../plugins/dsh-plugin-browser-provider-electron/src/native/cookie-import.js";
import {
  cookieFixture,
  fixtureKey,
} from "../../../../plugins/dsh-plugin-browser-provider-electron/src/test/cookie-fixture.js";
import { rm, writeFile } from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
app.setPath("userData", process.env.AMIBA_COOKIE_TEST_ROOT!);
const timer = setTimeout(() => app.exit(1), 30_000);
app.whenReady().then(async () => {
  const fixture = await cookieFixture();
  const target = session.fromPartition("persist:cookie-import-test");
  const importer = new CookieImporter(target.cookies, {
    home: fixture.home,
    platform: "darwin",
    key: async () => fixtureKey(),
  });
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      request.headers.cookie?.includes("session=fixture-login")
        ? "<title>Signed in</title><h1>Signed in</h1>"
        : "<title>Signed out</title><h1>Signed out</h1>",
    );
  });
  let win: BrowserWindow | undefined;
  try {
    fixture.add("session", {
      domain: "127.0.0.1",
      value: "fixture-login",
      secure: false,
    });
    fixture.add("unselected", { domain: "unselected.test" });
    const { sources } = await importer.sources();
    assert.equal(sources.length, 1);
    const result = await importer.run(sources[0]!.id, ["127.0.0.1"], false);
    assert.equal(result.imported, 1);
    const actual = await target.cookies.get({ name: "session" });
    assert.equal(actual[0]?.httpOnly, true);
    assert.equal(actual[0]?.hostOnly, true);
    assert.equal((await target.cookies.get({ name: "unselected" })).length, 0);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    win = new BrowserWindow({
      show: false,
      webPreferences: { session: target, sandbox: true },
    });
    await win.loadURL(`http://127.0.0.1:${address.port}`);
    assert.equal(win.webContents.getTitle(), "Signed in");
    assert.equal(
      await win.webContents.executeJavaScript("document.cookie"),
      "",
    );
    await target.cookies.set({
      url: `http://127.0.0.1:${address.port}`,
      name: "session",
      value: "newer-login",
      path: "/",
      httpOnly: true,
    });
    assert.equal(
      (await importer.run(sources[0]!.id, ["127.0.0.1"], false)).preserved,
      1,
    );
    assert.equal(
      (await importer.run(sources[0]!.id, ["127.0.0.1"], true)).imported,
      1,
    );
    assert.equal((await importer.run(sources[0]!.id, null, false)).imported, 1);
    assert.equal((await target.cookies.get({ name: "unselected" })).length, 1);
    // Visual QA uses the real panel and desktop CSS with synthetic metadata.
    win.setSize(560, 780);
    await win.loadFile(
      path.join(process.env.AMIBA_COOKIE_TEST_ROOT!, "ui.html"),
    );
    const evaluate = (code: string) => win!.webContents.executeJavaScript(code);
    const waitText = async (text: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await evaluate(
            `document.body.innerText.includes(${JSON.stringify(text)})`,
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Missing UI text: ${text}`);
    };
    const output = path.dirname(process.env.AMIBA_COOKIE_TEST_OUTPUT!);
    const capture = async (name: string) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert(
        await evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
      );
      await writeFile(
        path.join(output, name),
        (await win!.webContents.capturePage()).toPNG(),
      );
    };
    await waitText("一键导入");
    assert(
      await evaluate(
        "!document.querySelector('select') && !document.querySelector('input[type=checkbox]')",
      ),
    );
    await capture("cookie-import.png");
    win.setSize(390, 700);
    await capture("cookie-import-narrow.png");
    await evaluate("document.documentElement.classList.add('dark')");
    await capture("cookie-import-dark.png");
    await evaluate("document.documentElement.classList.remove('dark')");
    win.setSize(560, 900);
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('高级设置')).click()",
    );
    await evaluate("document.querySelector('input[value=custom]').click()");
    await waitText("example.test");
    await evaluate(
      "document.querySelector('#cookie-advanced').scrollIntoView({block:'start'})",
    );
    await capture("cookie-import-advanced.png");
    await evaluate("document.querySelector('input[value=all]').click()");
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('高级设置')).click()",
    );
    await evaluate(
      "document.querySelector('[data-cookie-import]').scrollTop = 0",
    );
    win.setSize(560, 780);
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('一键导入')).click()",
    );
    await waitText("准备好了，继续浏览吧");
    await capture("cookie-import-result.png");
    await writeFile(
      process.env.AMIBA_COOKIE_TEST_OUTPUT!,
      JSON.stringify(
        {
          passed: true,
          checks: [
            "synthetic Chromium database discovery",
            "v24 cookie decryption",
            "real Electron session import",
            "hostOnly and HttpOnly preserved",
            "only selected websites",
            "HTTP request authenticated",
            "page JS cannot read HttpOnly cookie",
            "existing cookie preserved",
            "explicit overwrite",
            "one-click full-profile import",
            "rendered import panel without horizontal overflow",
            "one-click UI submission and result",
            "advanced options hidden by default",
            "narrow, dark and advanced layouts",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "Cookie import Electron smoke passed (14 checks, synthetic credentials only)",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    importer.dispose();
    win?.destroy();
    server.close();
    await rm(fixture.home, { recursive: true, force: true });
    clearTimeout(timer);
    app.exit(process.exitCode || 0);
  }
});
