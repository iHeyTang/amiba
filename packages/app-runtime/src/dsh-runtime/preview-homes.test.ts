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
