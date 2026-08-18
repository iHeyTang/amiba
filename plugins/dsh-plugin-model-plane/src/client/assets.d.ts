// Asset-module shims for `@amiba/ui` sources this plugin's Client bundle
// compiles in (ModelIcon imports provider SVGs; Vite resolves them to URLs).
declare module "*.svg" {
  const url: string;
  export default url;
}
