# @amiba/dsh-plugin-browser-provider-cdp

CDP provider for `@amiba/dsh-plugin-browser-core`. This is the browser implementation available to the Amiba CLI, Web deployments and other non-Electron surfaces.

Set `AMIBA_BROWSER_CDP_URL` to a Chrome/Chromium remote-debugging HTTP origin such as `http://127.0.0.1:9222`, or directly to its browser WebSocket URL. For safety, only loopback endpoints are accepted by default. Set `AMIBA_BROWSER_CDP_ALLOW_REMOTE=1` only when the endpoint is protected by a trusted network boundary.

When no endpoint is configured, the plugin registers no provider, so browser tools do not appear in DSH's effective tool catalog.
