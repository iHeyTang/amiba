import { LayoutNavigation } from './layout-navigation.js';

/** The official reserved main key maps to Amiba's existing conversation owner. */
export const CONVERSATION_PANEL = 'conversation';

export interface MainPanelInfo {
  /** null denotes the existing conversation surface. */
  readonly activePanelId: string | null;
}

/** Shared source for public panel hooks and the product's actual central view. */
export class MainPanelNavigation {
  private snapshot: MainPanelInfo = { activePanelId: null };
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly navigation: LayoutNavigation,
    private readonly registry: {
      hasPanel(id: string): boolean;
      subscribe(listener: () => void): () => void;
    },
    private readonly showConversation: () => void,
  ) {
    this.unsubscribe = registry.subscribe(() => {
      const id = this.snapshot.activePanelId;
      if (id !== null && !registry.hasPanel(id)) this.selectPanel(null);
    });
  }

  getSnapshot = (): MainPanelInfo => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  selectPanel(id: string | null): void {
    if (this.disposed) throw new Error('layout.selectPanel: layout is disposed');
    if (id === CONVERSATION_PANEL) id = null;
    if (id !== null && !this.registry.hasPanel(id)) {
      throw new Error(`layout.selectPanel: main panel "${id}" is not registered`);
    }
    // Null is an explicit navigation even when an Amiba workspace is shown.
    if (id === null) this.showConversation();
    this.navigation.commit();
    this.publish(id);
  }

  /** Native navigation owns its destination; only clear the global panel. */
  leavePanel(): void {
    if (this.disposed) return;
    this.navigation.commit();
    this.publish(null);
  }

  private publish(id: string | null): void {
    if (this.snapshot.activePanelId === id) return;
    this.snapshot = { activePanelId: id };
    for (const listener of [...this.listeners]) {
      try { listener(); }
      catch (error) { console.error('main panel subscriber failed:', error); }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.navigation.dispose();
  }
}
