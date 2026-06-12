// Re-export from @amiba/ui so the desktop app and the extension render the
// same brand mark. The actual implementation (and inlined base64 assets) lives
// in `packages/ui/src/AmibaLogo.tsx`.
export { AmibaLogo, type AmibaLogoProps } from "@amiba/ui";
