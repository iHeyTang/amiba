# Composer toaster content and ownership

The chat footer owns one `ComposerToaster` stack. Home and Quick Ask use the same host. There are two overlapping toasters with identical material: the persistent layer holds context, queue and feedback, while the interaction layer covers it for approvals/questions/plans/wizards. They do not add their heights vertically. The rear layer stays mounted (preserving drafts and queue state), hides its content and becomes inert/aria-hidden while covered. Once the interaction is resolved, the same rear content reappears.

`ComposerDockSheet` contributes to a named region through a portal. Empty layers cost no space. Only the visible front layer determines the footprint and scrolls. Existing section-specific errors remain with their interaction.
| Region | Current occupants | Source |
| --- | --- | --- |
| Context | Goal status/objective, goal editing and actions | official-features/goal.tsx via conversation.input.dock |
| Context | Legacy extrasAbove content | Composer.tsx |
| Queue | Pending message preview/edit/send-now/delete; captured application source | ChatSurface.tsx contextRail, PendingQueueRail.tsx |
| Interaction | Tool/permission approvals and approval details | bubble/approval.tsx |
| Interaction | Questions, options, custom answers and plan review | bubble/clarify.tsx |
| Interaction | Connector setup/authorization question wizard | dsh-plugin-connector-core/ConnectQuestionScreen.tsx |
| Interaction | Media generation confirmation | dsh-plugin-media/GenerationConfirmation.tsx |
| Feedback | Attachment staging and workspace binding errors | ComposerDockError in ChatSurface.tsx |

Errors belonging to an approval, question, goal or wizard remain next to that interaction's controls. They do not create another shell. New input-dock plugins must render `ComposerDockSheet` and select their semantic region; default is Interaction. Content inside a section supplies its own header/body/actions, with shared horizontal inset and compact action sizing. The host alone owns outer radius, material, overlap and scroll bounds.

## Adjacent surfaces audited

- `conversation.input.overlay`: mention/slash TriggerMenu, command selection/confirmation popup, and feedback dialog. These are transient focus/selection surfaces with their own dismissal contract; they are not persistent dock sections. Their current composer-card anchor and keyboard/outside-pointer contract must remain intact.
- Agent/model/access-mode pickers and the plan control are toolbar controls/dialogs. They do not inject a dock card.
- `conversation.composer.dock`: token/session statistics below the input; not the upper toaster.
- Attachment gallery, queue-edit affordance and drag overlay belong inside the input card.
- Transcript error blocks, execution notices, background-job activity and tool details belong in the transcript or workbench, not this container.

## Checks

Goal + queue; multiple queue items; approvals + errors; plan review; ordinary questions; connector wizard; media confirmation; empty dock; home/Quick Ask; narrow widths; long text; light/dark/wallpaper; keyboard focus and draft preservation when neighboring sections appear/disappear. No model request is needed to inspect presentation fixtures.

## Action styling

Icon operations use `ComposerDockIconButton`: 24 px target, 14 px icon, 1.75 stroke, 6 px radius and one muted color. Adjacent operations have a 4 px gap; destructive hover is reserved for removal. Queue rows expose send, edit and remove in that order. Editing is disabled for the row already being edited. Goal operations, question navigation/collapse/dismiss and error dismissal use the same control. Wizard close adopts the same geometry only when docked.

Labeled decisions use 28 px height, 12 px text and 6 px radius across approvals, questions, plans, docked wizards and media confirmation. Primary and destructive meanings retain distinct colors; choices and tabs retain their selection semantics.

Toaster sheets and the input card share production surface rules for background, opacity, blur, saturation and border color, including wallpaper-free mode. A covered rear layer paints only its exposed 6 px edge so overlapping translucent fills do not whiten the front. The toaster fixture loads these production material rules.
