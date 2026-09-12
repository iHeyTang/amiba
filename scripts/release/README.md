Release tooling is documented in ../../docs/desktop-distribution.md.

Local commands:
- pnpm release:build <darwin-arm64|darwin-x64|win32-x64> [--upload]
- pnpm release:upload <target>
- pnpm release:cdn <target>

Required configuration:
- AMIBA_GITHUB_REPOSITORY: owner/repository
- AMIBA_UPDATE_URLS: optional comma-separated HTTPS CDN directories
- AMIBA_CDN_REMOTE: configured rclone destination for release:cdn

A build on the wrong OS/Node architecture fails before preparing runtime assets.
