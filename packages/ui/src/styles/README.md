# Amiba surface materials

`tokens.css` loads `glass.css` for every UI consumer, including desktop, plugin bundles and portalled overlays. The shared Tailwind preset maps neutral background/card/popover/secondary/muted/accent colors to these material opacities; foreground and semantic action colors remain solid.

Use the existing Button, Input, Textarea, Select, Card, Popover, Tooltip and Dialog primitives. Do not add per-feature glass backgrounds or shadows. Transparent media dialogs use the existing `appearance="bare"` opt-out. Settings framing shares the dialog material; inner settings layout scaffolds remain transparent.

- Controls and cards tint their parent without another blur filter.
- Popovers blur 18px behind a readable tint; dialogs use 24px and a denser tint.
- Floating shadows use one subtle edge shadow token, shared by the Tailwind preset.
- Wallpaper composers use the reading surface contract in `surfaces.css`, with a lighter 40% backing and 18px blur.
- Reduced-transparency and unsupported-filter environments use opaque backing.

Explicit opacity utilities remain available for deliberate nested hierarchy. Avoid hardcoded white or opaque neutral surfaces in new product UI. Preserve semantic colors, focus rings, selected states and disabled states.

Visual fixture: `plugins/dsh-plugin-ui-shell/src/dev/official-features.html` includes high-contrast backgrounds, menu/dialog controls, and light/dark switching. Verify actual desktop surfaces as well when changing layout or content structure.
