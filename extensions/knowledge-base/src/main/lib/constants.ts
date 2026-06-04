/**
 * Storage keys are scoped under the extension id. The values shown here
 * are the SUFFIXES; MainHost.settings.get/set transparently prepend
 * `ext.io.hermes.knowledge-base.`.
 *
 * Local-only deployment: `gbrain serve --http` runs unauthenticated, so
 * no token is stored or sent. The URL is configurable but defaults to
 * the loopback default and most users never touch it.
 */
export const BRAIN_URL_KEY = "brain.url"
export const BRAIN_DEFAULT_URL = "http://127.0.0.1:3131"
