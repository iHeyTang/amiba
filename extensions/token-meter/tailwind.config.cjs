const path = require("path")
const preset = require("@hermes-x/tailwind-preset")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    "./src/ui/**/*.{ts,tsx,html}",
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
  ],
}
