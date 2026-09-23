# {{NAME}}

Independent DSH plugin for Amiba. Package: `@{{AUTHOR}}/{{NAME}}`.

This project has two optional halves:

- `src/index.ts`: Host plugin running inside DSH/Cordis.
- `src/client/index.tsx`: DSH Client plugin contributing to an Amiba child slot.

```bash
pnpm install
pnpm build
npm run connect:dev    # source/dev desktop
npm run connect:release # installed desktop
pnpm pack
```

Open the matching Amiba before connecting. Each command searches only its own
channel, so running both desktops does not select the wrong one. `npm run dev`
is an alias for `connect:dev`. Keep the terminal running; Ctrl+C disconnects the
local plugin and restores the installed profile. These commands temporarily load
the plugin; they do not permanently install or publish it. First connection
restarts the selected desktop's DSH and refreshes its UI.

For custom data directories, set `AMIBA_PLUGIN_DEV_HOME` or
`AMIBA_PLUGIN_RELEASE_HOME` to that desktop's `dsh/home` path. These targeted
commands ignore unscoped `DSH_HOME`, `AMIBA_DSH_HOME`, and `AMIBA_USER_DATA_DIR`.
An explicit `amiba --dsh-home /absolute/path plugin dev --target dev` overrides
the channel default. If multiple desktops in the same channel are found, use
that explicit path; no fallback to the other channel occurs.

The development connection uses DSH's bundle/Loader graph. Electron is only the
desktop shell and does not maintain a second plugin registry. Change the slot
in `src/client/index.tsx` to contribute elsewhere in the Amiba root.

The same Client entry can declare its own nested children on
`ctx.slots.register({ children: ... })` and render them with
`PropsRenderSlots`. Downstream plugins then inject those child slots directly;
no Electron registration or DOM bridge is required.
