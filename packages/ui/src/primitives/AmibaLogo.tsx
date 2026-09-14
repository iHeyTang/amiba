import { useDocumentTheme } from "../theme"
import { cn } from "./cn"
import { logoDarkBg, logoLightBg } from "./amiba-logo-assets"

/**
 * Default-pet brand mark for Amiba surfaces. Two SVG variants are inlined
 * as data URIs in `amiba-logo-assets.ts`, generated alongside the app icon:
 *
 *   - `light-bg` — render the dark-glyph artwork on a light surface
 *   - `dark-bg`  — render the light-glyph artwork on a dark surface
 *
 * By default the component follows the document palette via
 * `useDocumentTheme()` so the logo flips automatically alongside every
 * other shadcn token. Pass `variant` explicitly for surfaces that don't
 * track the document theme (e.g. a logo placed on top of a fixed-colour
 * gradient).
 */
export interface AmibaLogoProps {
  /** CSS size override; ignored when `width`/`height` are set via className. */
  size?: number
  /** Force a specific variant regardless of the resolved theme. */
  variant?: "auto" | "light-bg" | "dark-bg"
  className?: string
  alt?: string
}

export function AmibaLogo({
  size = 24,
  variant = "auto",
  className,
  alt = "Amiba"
}: AmibaLogoProps) {
  const theme = useDocumentTheme()
  // `light-bg` means "render so it looks good on a light surface" — i.e.
  // pick the dark-glyph artwork. We expose the prop in the surface-oriented
  // direction because that's how callers tend to think about it.
  const useDarkGlyph = variant === "light-bg" || (variant !== "dark-bg" && theme === "light")
  const src = useDarkGlyph ? logoLightBg : logoDarkBg
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={cn("select-none pointer-events-none object-contain", className)}
      draggable={false}
    />
  )
}
