const path = require("path")
const preset = require("@hermes-x/tailwind-preset")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    "./src/ui/**/*.{ts,tsx,html}",
    // Scan @hermes-x/ui workspace source for Tailwind class names.
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
  ],
}
