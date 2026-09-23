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

Run `pnpm release:version patch` (or minor/major) in a feature worktree and submit both package.json version changes in a PR. After it merges, run Desktop Release on main. It always builds all three platforms and publishes the merged version without creating a version commit. An already published version is rejected.

## CI and test installers

The `jsdom>nwsapi` override pins the selector engine to 2.2.23. Version 2.2.27 recursively delegates `:modal` / `:fullscreen` matching back to jsdom, making Floating UI menu tests time out. Re-run `ProfileMenu.test.tsx` and `Sidebar.test.tsx` before changing this pin; keep their normal timeout and interaction assertions.

`ci.yml` runs lightweight validation on PRs and main pushes, retaining the required `PR checks` job name. `runtime-dependencies.yml` runs the existing three-platform runtime integration checks on PRs and main pushes. Neither workflow creates installers or publishes releases.

For test installers, manually run Desktop Build (`desktop-build.yml`) on main with `mode=test` and the desired target. Use `mode=verify` with an existing `run_id` to recheck installers without rebuilding. Test artifacts expire after 7 days; no scheduled packaging is enabled.

Desktop Release (`desktop-release.yml`) is manual-only and runs CI before packaging. Choose the macOS signing mode; all three platforms must pass packaging and smoke tests before publication. Builds use the run's pinned commit. No main push triggers packaging or publication.

## DSH slot compatibility maintenance

The repository-root `DSH-SLOT-COMPATIBILITY.md` is the permanent cross-package maintenance ledger; `docs/` contains historical reports and is not the home for current slot status.

Changes to the DSH version, slot declarations, dispatch, compatibility bridges, or slot retirement must update the existing [DSH slot compatibility ledger](DSH-SLOT-COMPATIBILITY.md) in the same PR. Record the exact upstream version, Amiba implementation status, adoption/retirement decision, source and validation evidence, and known limits. Keep removed names as historical rows. Do not create a separate date- or version-specific document for the current compatibility state, and do not equate entry coverage with behavioral compatibility.
