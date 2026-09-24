# Repository workflow — mandatory

These rules apply to all contributors, coding agents, scripts, and automation in this repository.

- Never edit, generate, format, or commit project files while checked out on `main`.
- Before any change, create a dedicated branch in a separate linked Git worktree, based on current `origin/main`. Use that worktree for all implementation, focused tests, and documentation changes. Generated build artifacts and integration tests may also run in local `dev` after the feature merge.
- Never copy changes back into the main worktree to preview them. Implement and run focused checks in the feature worktree; use the local `dev` integration checkout for the required local validation below.
- Preserve pre-existing uncommitted changes. Do not commit, move, reset, or overwrite them without explicit authorization.
- Push only the feature branch. Open a GitHub pull request targeting `main`; all changes must enter `main` through a PR and pass its required checks.
- Never directly push to remote `main`, including `HEAD:main`, force pushes, GitHub ref/content APIs, automated version commits, and admin bypasses. Do not disable hooks or branch protection to bypass this rule.
- Release version changes follow the same PR workflow. Releases build the version already merged into `main`; release automation must not modify `main`.
- Every new feature and bug fix has two required delivery steps: push the feature branch and open/update its PR targeting `main`, then merge that feature branch into the existing local `dev` branch and perform local validation there. Report PR checks and local `dev` validation separately.
- Before merging into local `dev`, inspect its current branch and working tree, preserve existing work, and resolve conflicts without dropping unrelated changes. Do not reset `dev` to `main`. Keep implementation commits in the feature worktree; local `dev` is the integration and validation checkout. Do not push `dev` unless explicitly requested.
- A request to implement a change authorizes the feature branch, PR, and local `dev` integration above, not an automatic GitHub PR merge. Merge the PR only when the user explicitly requests it.
- Enable the local guards with `node scripts/install-git-hooks.mjs` when setting up a clone. Hooks help prevent commits/pushes; they cannot prevent an editor from modifying files. Check branch and worktree before editing.

See CONTRIBUTING.md for commands. Existing main-worktree changes that predate this policy must be preserved and handled separately.
