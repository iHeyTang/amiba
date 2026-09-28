/** Release the one-time startup styles on both successful boot and failure. */
export function removeStartupScreen(): void {
  document.getElementById("amiba-startup")?.remove();
  document.documentElement.removeAttribute("data-amiba-starting");
}
