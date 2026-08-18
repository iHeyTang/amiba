# DSH migration UI fidelity audit

Date: 2026-08-15

## Authoritative baseline

The pre-DSH UI is not reconstructed from memory or screenshots. The source of
truth is Git commit `61e95c8baf32ce6195eebab6cfeb75c40a9b895a` (`HEAD` before the
uncommitted DSH migration). That revision still uses the Hermes runtime,
`prepare-hermes-runtime.mjs`, Hermes adapters, and the original UI components.

## Migration rule

Replacing Hermes with DSH changes runtime contracts and data adapters. It does
not authorize a visual redesign. Existing navigation, information hierarchy,
interaction placement, density, empty/loading/error states, and editing
surfaces remain the default. A control is removed only when its capability no
longer exists; backend mechanics such as DSH session IDs must stay inside the
adapter unless the user is making a genuine product-level choice.

## Source comparison and disposition

| Surface                                          | Baseline source                                                       | DSH disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings shell                                   | `SettingsView.tsx`                                                    | Sidebar width, grouping, navigation-row primitives, header, and content shell retained. Entries for removed Hermes-only capabilities are removed; Skills is added using the same navigation primitive.                                                                                                                                                                                                                                                                                      |
| Models and services                              | `settings/HermesModelConfigTab.tsx`, `settings/ModelDisplayPanel.tsx` | Restores the model-first hierarchy: model assignment surface, searchable expandable provider list, connection badges, provider/model visibility switches, rich model rows, details dialogs, and the legacy provider-dialog geometry. Provider/model/credential state and the product default are owned by Amiba Model Plane; DSH receives only an execution projection. Reasoning effort remains a capability-specific choice beneath the selected model rather than separate catalog rows. |
| Skills                                           | `skills/SkillsPage.tsx`                                               | Restored the 56-width category rail, right-aligned actions, category heading, single search row, 76px skill rows, right-side origin badges, always-present edit/delete actions, and full editor. The page-level session selector and visible filesystem path were removed; the adapter silently selects the active/latest compatible DSH session.                                                                                                                                           |
| Tool inventory                                   | `usage/AgentCapabilitiesPage.tsx`                                     | Restored the original section headers, 32px icon rows, text sizing, status treatment, chevron, and back-only subpage header. The page-level session selector was removed; exact inventory resolution stays in the adapter-facing loader.                                                                                                                                                                                                                                                    |
| Automation                                       | `chat/ScheduledTasksPage.tsx`                                         | Restored the original toolbar, single search field, filter row, two-column list, 40px task tiles, metadata density, and right-side actions. The page now aggregates reminders across normal conversations instead of forcing a session selection. Conversation ownership is chosen only in the create dialog and defaults automatically. Unsupported pause/edit/run-now/script/model/delivery controls are not faked.                                                                       |
| Messaging                                        | `settings/SettingsMessaging.tsx`                                      | Retains the original summary, search, configured/available grouping, rich provider cards, rich channel rows, and management dialogs. The header-level Add button and empty dead-end were removed; installed providers appear as the original “available channel” cards and open the create flow. Pairing and legacy gateway webhook tabs are removed because DSH has no equivalent contract.                                                                                                |
| Memory                                           | `settings/SettingsMemory.tsx`                                         | Header, action placement, configuration card, usage bars, paths, and entry cards retained. Hermes provider/toggle controls are replaced in place by the always-composed DSH memory plugin state and preset scope.                                                                                                                                                                                                                                                                           |
| MCP tools                                        | `settings/McpToolsTab.tsx`                                            | Section header, add/edit surface, empty state, 32px rows, status label, action placement, and switch retained. Hermes-only connection-test is removed because the DSH adapter has no test contract.                                                                                                                                                                                                                                                                                         |
| Runtime status                                   | `settings/SettingsStatus.tsx`                                         | Health-first hierarchy, compact status rows, last-check state, runtime details, path disclosure, copy controls, loading, and service-unavailable states retained. Hermes update/gateway/maintenance sections are removed; DSH restart is the supported lifecycle action.                                                                                                                                                                                                                    |
| Runtime logs                                     | `settings/SettingsLogs.tsx`                                           | Header actions, filter row, bounded log surface, live refresh, log status, and density retained. Hermes file/component sources are replaced by DSH runtime stream filters in the same layout.                                                                                                                                                                                                                                                                                               |
| Agents, appearance, shortcuts, usage, extensions | Corresponding `HEAD` components                                       | No migration-driven layout redesign found. Hermes-only behavior/model/plugin controls are removed where their contracts no longer exist.                                                                                                                                                                                                                                                                                                                                                    |
| Home, chat, composer, sidebar, workspace         | Corresponding `HEAD` components                                       | Desktop composition and primary interaction placement retained. Browser-extension-only surfaces, voice, Learn mode, Kanban, rewind/import, and other removed capabilities are not kept as inert decoration.                                                                                                                                                                                                                                                                                 |

## Explicit capability removals

- Voice/STT and Learn mode
- Kanban and the Hermes Task Center
- Hermes virtual multi-model collaboration
- Hermes-specific auxiliary task-model routing
- Browser-extension-only product surfaces and userscripts
- Hermes Python service, gateway, updater, maintenance, pairing, and legacy
  webhook controls
- Legacy session import, rewind, and dual-write controls
- Hermes gateway plugin manager and toolset configuration

Reintroducing one of these requires a real DSH-native plugin or product
contract first. The old screen must not be preserved as non-functional chrome.

## Regression gates

- UI and workspace typecheck
- focused tests asserting that Skills, Tools, and Automation do not expose a
  page-level session selector
- Automation aggregation test across multiple DSH conversations
- focused visual-contract tests for Skills, Models and services, Messaging,
  Memory, MCP, Status, Logs, and Tool inventory
- full UI test suite
- desktop production build and bundle verification
- live desktop review at the same viewport for the baseline layout and the DSH
  implementation
