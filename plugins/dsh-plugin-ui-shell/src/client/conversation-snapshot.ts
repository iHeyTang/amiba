import type { SessionFace, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ChatSnapshot, LegacyConversationSlice } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';

/** Amiba's existing views consume the official Chat projection beside Session lifecycle data. */
export type ConversationSnapshot = SessionSnapshot & LegacyConversationSlice & { readonly chat: ChatSnapshot };

export type ConversationSource = ObservableSnapshot<ConversationSnapshot | undefined> & Pick<SessionFace, "readAttachment">;

/** Preserve snapshot identity between actual Session or Chat publications. */
export function conversationSnapshotSource(session: SessionFace, chat: ObservableSnapshot<ChatSnapshot | undefined>): ConversationSource {
  let lastSession: SessionSnapshot | undefined;
  let lastChat: ChatSnapshot | undefined;
  let value: ConversationSnapshot | undefined;
  return {
    readAttachment: session.readAttachment.bind(session),
    getSnapshot() {
      const nextSession = session.getSnapshot();
      const nextChat = chat.getSnapshot();
      if (nextSession !== lastSession || nextChat !== lastChat) {
        lastSession = nextSession;
        lastChat = nextChat;
        value = nextChat ? { ...nextSession, ...nextChat.legacy, chat: nextChat } : undefined;
      }
      return value;
    },
    subscribe(listener) {
      const offSession = session.subscribe(listener);
      const offChat = chat.subscribe(listener);
      return () => { offChat(); offSession(); };
    },
  };
}
