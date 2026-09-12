# @amiba/dsh-plugin-conversation-notifications

Publishes real conversation events to `ctx.amibaNotifications`, independently of the selected conversation or any desktop window.

- Live `turn/end` events produce completed, failed or interrupted notices.
- Approval audit events create and resolve attention notices.
- The `ask_user_question` tool lifetime creates an attention notice and settles it after an answer, cancellation or failure.
- Session titles become notice headlines and renames update existing notices.
- Loaded session history is not replayed. Source keys deduplicate repeated turn/approval events.

The plugin owns business notification policy. It renders no UI and does not depend on Electron or Mofli.
