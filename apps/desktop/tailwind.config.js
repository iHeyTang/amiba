const path = require("path")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@hermes-x/tailwind-preset")],
  content: [
    "./src/renderer/**/*.{ts,tsx,html}",
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/chat-ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/settings-ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/home-ui/src/**/*.{ts,tsx}")
  ]
}
