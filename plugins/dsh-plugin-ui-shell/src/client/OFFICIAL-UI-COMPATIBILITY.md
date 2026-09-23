# Official UI compatibility

Amiba owns the palette, theme preference, density and layout. Keep `ui-theme`
disabled. `official-theme.css` supplies the shared DSH variables to the root so
portaled controls inherit them as well. Semantic colors follow Amiba's HSL
palette; static file-artwork colors retain their meaning, including white marks
on colored SVGs in both themes.

`useResolvedTheme` mirrors Amiba's resolved theme to `body[data-ds-dark-theme]`
for official plugin selectors. It does not mount the official theme service.

The menu fallback is sourced from DSH 0.1.5-rc.1 (MIT, see LICENSE.deepseek).
Its positioning rules are preserved; presentation overrides use Amiba spacing
and radii. Controls and deliverables overrides are also pinned CSS-module
selectors. Check these selectors against the shipped frontend on every upgrade.
Do not replace `Menu` positioning with hand-authored coordinates.

## Attachment seats

Amiba renders attachments — the user bubble, the composer and the empty-state
composer — through the shared `AttachmentGallery` component (fixed-size two-line file cards with cropped image thumbnails in the icon slot,
independent of image aspect ratio and attachment count). The official seats stay part of the vocabulary and
keep their takeover semantics:

- `conversation.message.images`: the user bubble dispatches this seat once per
  message (a whole-group call). Amiba's default occupant is
  `MessageImagesGallery`, registered at `SHADOW_PRIORITY` (-1) — below the
  official ui-attachment occupant's implicit 0 — so a plugin registering below
  the shadow priority (≤ -2) replaces the image side of the row, while the
  default stays the shared gallery tiles. The owner shape
  (`images`/`loadImage`/`align`/`compact`) is unchanged from the official
  contract.
- `conversation.input.attachments`: dispatched by both home and session composers
  with actual drafts, file uploads and add/remove/retry actions. The native
  gallery is the priority-1 fallback; an ordinary priority-0 plugin can replace it.

The rc.2 behavior ledger and tested boundaries are in
[`DSH-SLOT-COMPATIBILITY.md`](../../../../DSH-SLOT-COMPATIBILITY.md).

Run `node plugins/dsh-plugin-ui-shell/scripts/audit-official-theme.mjs` from the
workspace after installing dependencies. This checks DSH token references in
installed official UI bundles and primitive styles. It includes potentially
inactive plugins and does not prove every UI surface is mounted or visually
correct. Perform browser checks separately for light/dark contrast, portal
positioning, keyboard dismissal, scrolling and narrow viewports.

Current verification: 63 installed assets / 116 DSH variable references covered;
theme switch regression tests; UI Shell build; light/dark file/menu fixtures;
published Menu implementation verified for right-edge alignment, 4px anchor
gap, scroll repositioning, narrow viewport containment, and Escape dismissal.
These checks do not replace an end-to-end check in a running Amiba installation.
