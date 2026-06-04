const path = require("path")
const preset = require("@hermes-x/tailwind-preset")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    "./src/ui/**/*.{ts,tsx,html}",
    // Scan workspace source directly — @hermes-x/ui is source-only (no dist build).
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
  ],
}
