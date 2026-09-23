import { describe, expect, it } from "vitest"
import { resolveAmibaDshDevelopmentHomes, resolveAmibaDshHomes } from "./index.js"

describe("preview discovery", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    it(`includes preview and preserves installed discovery on ${platform}`, () => {
      const homes = resolveAmibaDshHomes(undefined, {}, platform, "/users/test")
      const preview = resolveAmibaDshDevelopmentHomes(undefined, {}, platform, "/users/test")
      expect(preview).toEqual([...homes.map(home => home.replace(/([/\\])dsh([/\\])home$/, "-dev$1dsh$2home")), ...homes])
    })
  }
  it("honors explicit homes and fresh-profile directories", () => {
    for (const env of [{ AMIBA_DSH_HOME: "/custom" }, { DSH_HOME: "/custom" }, { AMIBA_USER_DATA_DIR: "/custom" }]) {
      expect(resolveAmibaDshDevelopmentHomes(undefined, env)).toEqual(resolveAmibaDshHomes(undefined, env))
    }
    expect(resolveAmibaDshDevelopmentHomes("/explicit", {})).toEqual(resolveAmibaDshHomes("/explicit", {}))
  })
})

describe("targeted plugin discovery", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    it(`never mixes release and dev candidates on ${platform}`, () => {
      const env = { APPDATA: "/roaming", XDG_CONFIG_HOME: "/config", DSH_HOME: "/wrong-session", AMIBA_DSH_HOME: "/wrong-amiba", AMIBA_USER_DATA_DIR: "/wrong-data" }
      const defaults = resolveAmibaDshHomes(undefined, { APPDATA: env.APPDATA, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME }, platform, "/users/test")
      expect(resolveAmibaDshDevelopmentHomes(undefined, env, platform, "/users/test", "release")).toEqual(defaults)
      expect(resolveAmibaDshDevelopmentHomes(undefined, env, platform, "/users/test", "dev")).toEqual(defaults.map(home => home.replace(/([/\\])dsh([/\\])home$/, "-dev$1dsh$2home")))
    })
  }
  it("keeps channel overrides separate and explicit home wins", () => {
    const env = { AMIBA_PLUGIN_DEV_HOME: "/custom-dev", AMIBA_PLUGIN_RELEASE_HOME: "/custom-release" }
    for (const target of ["dev", "release"] as const) {
      expect(resolveAmibaDshDevelopmentHomes(undefined, env, "darwin", "/users/test", target)).toEqual([`/custom-${target}`])
      expect(resolveAmibaDshDevelopmentHomes("/explicit", env, "darwin", "/users/test", target)).toEqual(["/explicit"])
    }
  })
})
