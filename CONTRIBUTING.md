# Contributing

All code, configuration, generated assets, and documentation changes use a separate worktree and a pull request. Direct edits/commits on main and direct pushes to main are prohibited, including for administrators and release automation.

```sh
git fetch origin
# Replace topic with a short description of your change.
git worktree add ../amiba-topic -b feat/topic origin/main
cd ../amiba-topic
node scripts/install-git-hooks.mjs
pnpm install --frozen-lockfile
# Edit, test, and run pnpm dev:desktop here.
git add <changed-files>
git commit -m "Describe the change"
git push -u origin feat/topic
gh pr create --base main
```

Wait for required PR checks and merge through GitHub when authorized. Update a clean main checkout with `git pull --ff-only`. Never overwrite existing main-worktree changes or copy feature files into main.

Local hooks reject commits outside linked feature worktrees and pushes to remote main. GitHub main protection enforces PRs and required checks without admin bypass; local hooks are not a substitute for that protection.

## Release versions

Run `pnpm release:version patch` (or minor/major) in a feature worktree and submit both package.json version changes in a PR. After it merges, run Amiba Desktop on main with mode=release and target=all. The workflow publishes the merged version without creating a version commit. An already published version is rejected. Desktop packaging remains main-only; the separate PR checks workflow performs lightweight validation before merging.
