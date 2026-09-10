import type { EmbeddedPageRequest } from "../shared/embedded-page";

export function installEmbeddedPageHost(): void {
  window.addEventListener("amiba:embedded-page", (event) => {
    const detail = (event as CustomEvent<{
      request: EmbeddedPageRequest;
      respond: (error?: string) => void;
      accepted: boolean;
    }>).detail;
    if (!detail || typeof detail.respond !== "function") return;
    detail.accepted = true;
    void window.amiba.embeddedPage.request(detail.request).then(
      () => detail.respond(),
      (error: unknown) => detail.respond(error instanceof Error ? error.message : String(error)),
    );
  });
}
