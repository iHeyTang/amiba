/**
 * Pet-page shim for `@amiba/dsh-plugin-ui-shell/client`.
 *
 * The pets plugin build rule requires client code to reach the platform
 * singleton through this specifier (never by bundling app-runtime's
 * singleton directly). The standalone pet page cannot load the ui-shell
 * plugin, but the re-export it needs is exactly `getPlatform` — mirror it
 * here and alias the specifier to this file in the pet bundle.
 */
export { getPlatform } from "@amiba/app-runtime/platform";