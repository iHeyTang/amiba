# {{NAME}}

Independent DSH plugin for Amiba. Package: `@{{AUTHOR}}/{{NAME}}`.

This project has two optional halves:

- `src/index.ts`: Host plugin running inside DSH/Cordis.
- `src/client/index.tsx`: DSH Client plugin contributing to an Amiba child slot.

```bash
pnpm install
pnpm build
pnpm dev
pnpm pack
```

Load the package through a DSH bundle or Loader entry. Electron is only the
desktop shell and does not maintain a second plugin registry. Change the slot
in `src/client/index.tsx` to contribute elsewhere in the Amiba root.

The same Client entry can declare its own nested children on
`ctx.slots.register({ children: ... })` and render them with
`PropsRenderSlots`. Downstream plugins then inject those child slots directly;
no Electron registration or DOM bridge is required.
