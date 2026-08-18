# @amiba/dsh-plugin-usage

DSH-native usage projection. The plugin reads complete logical sessions from
the official `ctx.sessionQuery` service, applies DSH token-meter's
last-sample-wins rule per turn/step, and exposes the result through the
`amibaUsage/list` Typert Remote.

It does not keep a desktop database, billing price table, or Electron IPC
adapter. Provider/model attribution and token counts come only from canonical
DSH events.
