# @amiba/dsh-plugin-model-plane

DSH adapter for Amiba's canonical Provider / Model / Credential plane.

The domain service and provider metadata remain harness-independent in
`@amiba/app-runtime/model-plane`. This plugin supplies a durable DSH-home
store, uses the official `ctx.credentials` seam, projects enabled providers
into DSH `llm-deepseek` / `llm-pi-ai` settings, and exposes the complete plane
through the `amibaModelPlane/*` Typert Remote namespace.

CLI, Web, and Electron clients consume the same Remote. Electron contributes
no model catalog, credential vault, or model-selection business IPC.
