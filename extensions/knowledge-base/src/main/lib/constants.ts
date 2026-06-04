/**
 * Storage keys are scoped under the extension id. The values shown here
 * are the SUFFIXES; MainHost.settings.get/set transparently prepend
 * `ext.io.hermes.knowledge-base.`.
 *
 * Default behaviour is the one-click install path: we spawn
 * `gbrain serve --http` ourselves with no `--auth-token`, so the
 * connection runs unauthenticated and no token is stored. The token
 * field only surfaces in the Advanced collapse for users who run
 * their own gbrain with `--auth-token` set (custom build, remote
 * instance, security-sensitive setup).
 */
export const BRAIN_URL_KEY = "brain.url"
export const BRAIN_TOKEN_KEY = "brain.token"
export const BRAIN_DEFAULT_URL = "http://127.0.0.1:3131"
