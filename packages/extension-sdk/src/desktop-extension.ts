/** Optional package.json dsh.native entry, loaded only by the desktop host. */
export interface DesktopExtensionContext {
  hostContentsId(): number | null;
  emit(ownerId: number, event: string, payload: unknown): void;
}
export interface DesktopExtension {
  /** WebView partitions this active extension owns. */
  partitions?: readonly string[];
  call(
    method: string,
    args: Record<string, unknown>,
    context: { sessionId?: string },
  ): unknown | Promise<unknown>;
  rendererCall(
    ownerId: number,
    method: string,
    args: unknown,
  ): unknown | Promise<unknown>;
  /** Must revoke resources synchronously; pending operations should reject. */
  dispose(): void;
}
export interface DesktopExtensionModule {
  create(context: DesktopExtensionContext): DesktopExtension;
}
/** Mechanism-only renderer transport. Leases prevent stale UI calling a replacement. */
export interface DesktopExtensionBridge {
  connect(packageName: string): Promise<string>;
  call(lease: string, method: string, args?: unknown): Promise<unknown>;
  subscribe(
    lease: string,
    event: string,
    listener: (payload: unknown) => void,
  ): () => void;
}
