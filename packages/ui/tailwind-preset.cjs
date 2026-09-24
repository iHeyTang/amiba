const animate = require("tailwindcss-animate");

/** Shared Amiba visual tokens; each surface owns only its content globs. */
module.exports = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        // Conversation surfaces share one neutral material, including tool cards.
        "chat-surface": {
          DEFAULT: "var(--amiba-content-fill, hsl(var(--muted) / 0.16))",
          hover: "var(--amiba-content-hover, hsl(var(--muted) / 0.3))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background) / var(--amiba-surface-opacity, 1))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / var(--amiba-control-opacity, 1))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / var(--amiba-control-opacity, 1))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / var(--amiba-control-hover-opacity, 1))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card) / var(--amiba-card-opacity, 1))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / var(--amiba-overlay-opacity, 1))",
          foreground: "hsl(var(--popover-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        sidebar: "hsl(var(--sidebar))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
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
          "Segoe UI Emoji",
        ],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        popover:
          "var(--amiba-floating-shadow)",
        overlay:
          "var(--amiba-floating-shadow)",
      },
    },
  },
  plugins: [animate],
};
