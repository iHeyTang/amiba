const path = require("path")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@amiba/ui/tailwind-preset")],
  content: [
    "./src/renderer/**/*.{ts,tsx,html}",
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../plugins/dsh-plugin-*/src/client/**/*.{ts,tsx}"),
  ],
}
