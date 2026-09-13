# Repository workflow — mandatory

These rules apply to all contributors, coding agents, scripts, and automation in this repository.

- Never edit, generate, format, or commit project files while checked out on `main`.
- Before any change, create a dedicated branch in a separate linked Git worktree, based on current `origin/main`. Use that worktree for all implementation, generated assets, tests, and documentation changes.
- Never copy changes back into the main worktree to preview them. Run development commands in the feature worktree instead.
- Preserve pre-existing uncommitted changes. Do not commit, move, reset, or overwrite them without explicit authorization.
- Push only the feature branch. Open a GitHub pull request targeting `main`; all changes must enter `main` through a PR and pass its required checks.
- Never directly push to remote `main`, including `HEAD:main`, force pushes, GitHub ref/content APIs, automated version commits, and admin bypasses. Do not disable hooks or branch protection to bypass this rule.
- Release version changes follow the same PR workflow. Releases build the version already merged into `main`; release automation must not modify `main`.
- A request to implement a change authorizes a feature branch and PR, not an automatic PR merge. Merge only when the user explicitly requests it.
- Enable the local guards with `node scripts/install-git-hooks.mjs` when setting up a clone. Hooks help prevent commits/pushes; they cannot prevent an editor from modifying files. Check branch and worktree before editing.

See CONTRIBUTING.md for commands. Existing main-worktree changes that predate this policy must be preserved and handled separately.
