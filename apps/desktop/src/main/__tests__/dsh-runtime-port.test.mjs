import assert from "node:assert/strict";
import test from "node:test";

import { resolveDshListenPort } from "../../shared/dsh-dev-port.ts";

test("uses the requested fixed DSH port only in development", () => {
  assert.equal(
    resolveDshListenPort(false, { AMIBA_DSH_DEV_PORT: "15174" }),
    "15174",
  );
  assert.equal(
    resolveDshListenPort(true, { AMIBA_DSH_DEV_PORT: "15174" }),
    "0",
  );
  assert.equal(resolveDshListenPort(false, {}), "0");
});

test("rejects invalid fixed DSH development ports", () => {
  assert.throws(
    () => resolveDshListenPort(false, { AMIBA_DSH_DEV_PORT: "abc" }),
    /integer TCP port/u,
  );
  assert.throws(
    () => resolveDshListenPort(false, { AMIBA_DSH_DEV_PORT: "80" }),
    /between 1024 and 65535/u,
  );
});
