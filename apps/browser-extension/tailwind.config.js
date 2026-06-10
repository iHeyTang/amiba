const path = require("path")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@amiba/tailwind-preset")],
  content: [
    "./src/**/*.{ts,tsx,html}",
    "./node_modules/streamdown/dist/**/*.js",
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/chat-ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/settings-ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../../packages/home-ui/src/**/*.{ts,tsx}")
  ]
}
