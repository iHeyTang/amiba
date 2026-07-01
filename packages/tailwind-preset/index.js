/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        sidebar: "hsl(var(--sidebar))"
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        // Native UI stack — SF on macOS, Segoe on Windows, CJK fallbacks.
        // Mirrors the body font-family in tokens.css so `font-sans` utilities
        // resolve to the same face. No web font is shipped on purpose.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans CJK SC",
          "Source Han Sans SC",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji"
        ],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"]
      },
      // Soft, multi-layer elevation for floating surfaces. Replaces the harsh
      // single-layer Tailwind defaults on overlays so they read as "lifted"
      // rather than "outlined". `popover` = dropdowns/selects/tooltips;
      // `overlay` = dialogs/command palette (more lift).
      boxShadow: {
        popover:
          "0 1px 2px -1px rgb(0 0 0 / 0.04), 0 4px 12px -2px rgb(0 0 0 / 0.10)",
        overlay:
          "0 4px 8px -2px rgb(0 0 0 / 0.06), 0 16px 36px -8px rgb(0 0 0 / 0.16)"
      }
    }
  },
  // tailwindcss-animate provides the `animate-in` / `fade-*` / `zoom-*`
  // enter/exit utilities the Radix dialog/overlay components rely on. Without
  // it those classes are no-ops and every dialog (incl. the command palette)
  // pops in/out with no transition.
  plugins: [require("tailwindcss-animate")]
}
