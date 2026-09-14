# @amiba/dsh-plugin-steward

One plugin provides user-defined, independent stewards. A steward has a durable
ID, name, responsibilities, initial background, working context, task table and
conversation history. No role templates or supervisory hierarchy are installed.

On first use, the plugin creates one ordinary entry named **大管家**. It can be
renamed, edited or deleted just like any other entry. Deleting the last entry
persists an empty registry; boot, settings reads and client polling never
recreate it. Users can create an entry in Settings → Stewards or ask in any
ordinary conversation, even when there are no stewards. `steward_create`
extracts the requested name, responsibilities and background; its result has an
Open steward action. `steward_update`, `steward_delete` and settings provide
editing/removal. A steward cannot edit/delete another steward through these tools.

## Ownership and conversations

- Each instance owns a `StewardService` engine and a scoped view of one atomic
  registry document at `config.root/state.json`. A task session has exactly one
  manager, including under concurrent adoption. Cross-instance task IDs fail
  scoped lookup before reading or dispatching work.
- The five task tools are installed only in steward agent scopes. They resolve
  the actual executing agent to an instance; the model cannot choose an
  arbitrary manager ID. Forked sessions do not inherit the role.
- Conversation lifecycle origins use `{plugin: "amiba-steward", entry: id,
  scope: "owner"}`. Daily/weekly/manual policies and history are per instance.
  A new conversation changes the current session, not the instance identity.
- Every prompt restores that instance's responsibilities, background, working
  context and active task summaries. `steward_remember` updates durable working
  context; `conversation_search_history` retrieves only the same entry's past
  conversations. Task reports go to the manager's current conversation, including
  after rollover and restart.
- No internal preset is generated. `config.basePreset` or the DSH default is
  pinned on creation; resume retains the recorded base. The persona overrides
  only its slot, preserving Code Mode SDK instructions and compaction behavior.
- Managed tasks ask for clarification in text; their manager relays it. Closing
  a task retains its binding/history; deleting its manager removes all bindings,
  guards and reporting, but does not cancel/delete the ordinary task sessions.
  Another steward can adopt those task sessions afterward.
- Removed steward conversations remain in history for reading. They no longer
  run as stewards and cannot themselves be adopted as ordinary tasks.

## Migration and recovery

Version 1 data migrates atomically into version 2 with an instance ID of `main`,
preserving its session, preset, extension version, tasks and report cursors. Its
existing `main/owner` lifecycle history remains attached. Other IDs are UUIDs.
Version 2 with `instances: []` is distinct from a missing file. Invalid/future
registry documents fail without overwriting the source or manufacturing defaults.
Session features reinstall scoped tools/persona when a historical session is
resumed; removed IDs remain rejected. Startup attempts every instance even if
another instance cannot resume.

## Memory boundary

MemOS currently uses an owner-wide profile. Steward conversations and currently
managed tasks therefore skip its automatic capture/recall and cannot invoke its
global memory tools. The integration filters the upstream hook boundary without
changing ordinary conversations' memory settings. Steward background and working
context live in the instance registry instead. Historical steward feature markers
also prevent copied history from entering the global memory profile.

This is isolation of plugin context and management permissions, not an OS sandbox
for base-preset file/shell tools. Previously captured ordinary-chat memory is not
erased when that chat is later adopted. Working context is maintained through
`steward_remember` or settings; there is no automatic semantic summary of every turn.

## Client

The sidebar contributes one named navigation entry and task group per instance.
An ordinary unowned task's menu offers a named adoption target for each steward.
Settings expose profile editing, conversation cadence and dated history. Entry
sessions are hidden only while their instance exists; removal releases visibility.
The client refreshes every five seconds and after local mutations. Creation in
another conversation/window may therefore take up to five seconds to appear.

## Validation

Run dependency builds first, then this plugin's `typecheck`, `test`, and `build`.
The registry tests cover legacy migration, zero-state restart, concurrent
ownership, cold report recovery, deletion races and profile/task update isolation.
Extension tests exercise actual scoped prompt assembly, caller-bound tools and
conversational creation. Client tests cover creation, exact-target editing,
deleting the final entry and failed writes. MemOS scoped-hook tests live in the
memory plugin; conversation isolation/history tests remain in session-features.
