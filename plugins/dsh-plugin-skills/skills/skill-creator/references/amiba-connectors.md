# Authoring connection-backed skills

Read this when creating, improving, or repairing a skill for a connection. Ordinary use of an already configured connector does not require skill creation.

## Separate instructions from account binding

Maintain reusable, provider-specific workflows separately from connection-instance data. The connector supplies the active account identity, wrapper/tool entrypoint, and current capability evidence. The skill supplies verified task guidance. Connecting an account must not require an LLM generation call to succeed.

Before writing a workflow, inspect the provider's declared capabilities, the installed CLI version and relevant help, or official documentation matching that version. Record the evidence behind command examples. Generic `--help` guidance is a bootstrap, not a verified document-search or spreadsheet workflow. Never manufacture subcommands to make a capability list look complete.

Use the available native resource or connector tools when they satisfy the task. Use the connection-bound CLI only for supported work that actually needs it. Do not route routine reads through skill creation, a connect wizard, or an installation flow.

## Describe usable tasks precisely

For each substantial workflow include:

- The user's intent and applicable resource type.
- The verified tool or CLI command and necessary inputs. Make placeholders explicit; quote shell arguments correctly.
- Which account supplies authority, which permissions are known versus unverified, and what audience may receive results.
- The observable success result, how to handle pagination or a scoped empty result when relevant, and the failure conditions that change the next action.

Do not claim that adding an IM bot authorizes reading all private documents, searching all chat history, or sending arbitrary replies. Availability depends on the live account, provider capability, resource sharing, and authorization. A user's permission to connect an account is not permission for unrelated writes.

## Diagnose the result before changing authorization

| Evidence | Next action |
| --- | --- |
| Successful search with no matches | Report the searched scope; refine query or location if useful. Do not infer an authorization failure. |
| CLI rejects the command or flag | Check version and matching help; use a supported alternative or report that capability as unavailable. |
| A specific resource is denied | Explain the narrow access limitation and the relevant sharing or permission step. |
| Explicit missing or expired credentials | Use the connection's existing authorization/repair flow for that account. |
| Timeout, 404 transport endpoint, or service failure | Diagnose availability/routing. Do not present reauthorization as a universal remedy. |

For shared IM requests, preserve conversation audience boundaries. Do not use a private owner credential as a fallback for a resource the group cannot access. Reuse the connector's sharing and approval mechanisms.

## Generation and lifecycle

Amiba currently produces a small CLI carrier `SKILL.md` for each connection instance. It contains the wrapper path and non-secret identity. It is overwritten on provisioning and removed with its instance; curated user copies have a different lifecycle. Do not repair the generated file alone and claim a durable fix. Fix its generator or maintained provider instructions and regenerate through the connection lifecycle.

Load `skill-creator` when the user requests creation or improvement. Use these rules to author and review reusable workflows; do not merely add a sentence telling another agent to write the missing instructions later. If the environment cannot verify a provider-specific workflow, retain honest discovery guidance and report the limitation instead of inventing a successful workflow.

Never put credential values in skills, examples, test output, or diagnostics. The skill references the connection's bound entrypoint, not a copied token. Display-name changes, two accounts of the same provider, disabling/re-enabling, and package upgrades must not cross-wire accounts or discard user-authored content.

## Acceptance checks

1. Parse the generated YAML; test colon-space, quotes, hashes, non-ASCII names, and newlines. Confirm `name` and `description` are strings and invocation flags are booleans.
2. Run `scripts/validate_dsh.mjs` from the loaded skill-creator resource base. Verify actual discovery and body loading, not just a regex for a `description:` line.
3. Check each referenced resource and executable helper. On a supported read-only request, verify the intended account and an observable result.
4. Check a relevant empty-result or failure case. Ensure the agent does not invent permissions, commands, or a need to reconnect.
5. Regenerate the connection skill and verify the repair survives. State separately what passed structural checks and what was exercised against a live service.
