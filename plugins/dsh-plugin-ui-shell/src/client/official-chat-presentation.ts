import { createContext, createElement, useContext, type ComponentType, type ReactNode } from "react";
import type { Context } from '@deepseek-ai/cordis';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';

type Dispatch = (name: string, owner: never, options?: never) => ReactNode;
export const RootSlotDispatch = createContext<{ renderSlot: Dispatch; renderSlotChain: Dispatch } | null>(null);

export const OFFICIAL_CHAT_VIEW = 'amiba-official-chat-nodes';
export const OFFICIAL_CHAT_REGISTRANT = 'amiba:rc2-chat-defaults';
/** Mount published rc.2 renderers against the already mounted headless Chat model. */
export function mountOfficialChatPresentation(ctx: Context, apply: (ctx: Context) => void) {
  const slots = new Proxy(ctx.slots, { get(target, key) {
    if (key === 'register') return (options: Record<string, unknown>, component: unknown) => {
      if (options.name !== 'conversation.chat.node' && options.name !== 'conversation.view') return () => {};
      const children = options.children as Record<string, unknown> | undefined;
      const borrowed = new Set(Object.keys(children ?? {}).filter(name => name !== 'conversation.chat.node'));
      const owned = { ...options, ...(children ? { children: Object.fromEntries(Object.entries(children).filter(([name]) => !borrowed.has(name))) } : {}), registrant: OFFICIAL_CHAT_REGISTRANT,
        ...(options.name === 'conversation.view' ? { id: OFFICIAL_CHAT_VIEW } : { priority: 1 }) };
      function OfficialPresentation(props: Record<string, unknown>) {
        const root = useContext(RootSlotDispatch);
        const dispatch = (method: 'renderSlot' | 'renderSlotChain'): Dispatch => (name, owner, options) => {
          if (borrowed.has(name)) {
            if (!root) throw new Error('Official Chat presentation requires the Amiba root slot owner');
            return root[method](name, owner, options);
          }
          return (props[method] as Dispatch)(name, owner, options);
        };
        return createElement(component as ComponentType<Record<string, unknown>>, { ...props, renderSlot: dispatch('renderSlot'), renderSlotChain: dispatch('renderSlotChain') });
      }
      return target.register(owned as never, OfficialPresentation as never);
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const alreadyMounted = (target: object) => new Proxy(target, { get(object, key) {
    if (key === 'register' || key === 'registerFallback') return () => () => {};
    const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
  } });
  const conversation = new Proxy(ctx.uiConversation, { get(target, key) {
    if (key === 'events' || key === 'views') return alreadyMounted(target[key]);
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const session = new Proxy(ctx.uiSession, { get(target, key) {
    if (key === 'provide') return () => () => {};
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const presentation = new Proxy(ctx, { get(target, key) {
    if (key === 'slots') return slots;
    if (key === 'uiConversation') return conversation;
    if (key === 'uiSession') return session;
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  apply(presentation);
}

/** A registration switches just the transcript to the complete official projection. */
export function officialChatRequested(slots: Context['slots']): ObservableSnapshot<boolean> {
  return {
    getSnapshot: () => slots.entriesOfSlot('conversation.chat.node').some(entry => entry.registrant !== OFFICIAL_CHAT_REGISTRANT),
    subscribe: listener => slots.subscribe('conversation.chat.node', listener),
  };
}
