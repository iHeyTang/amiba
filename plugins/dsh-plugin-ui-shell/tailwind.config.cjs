const path = require("path");

module.exports = {
  presets: [require("@amiba/ui/tailwind-preset")],
  // This build is injected as a <style> tag AFTER any host app's own Tailwind
  // stylesheet, so it must cover every source whose classes can appear in a
  // document it is injected into (desktop renderer included). A class missing
  // here but present in the host build gets overridden by whatever competing
  // utility this sheet does contain — same specificity, later sheet wins.
  content: [
    "./src/client/**/*.{ts,tsx}",
    path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
    path.join(__dirname, "../dsh-plugin-*/src/client/**/*.{ts,tsx}"),
    path.join(__dirname, "../../apps/desktop/src/renderer/**/*.{ts,tsx,html}"),
  ],
};
