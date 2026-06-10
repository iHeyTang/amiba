@import "@amiba/tailwind-preset/styles/tokens.css";
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Webview-specific resets */
html,
body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
body {
  margin: 0;
}
