Release tooling is documented in ../../docs/desktop-distribution.md.

Local commands:
- pnpm release:build <darwin-arm64|darwin-x64|win32-x64> [--upload]
- pnpm release:upload <target>
- pnpm release:cdn <target>

Required configuration:
- AMIBA_GITHUB_REPOSITORY: optional owner/repository override; defaults to Git origin
- AMIBA_UPDATE_URLS: optional comma-separated HTTPS CDN directories
- AMIBA_CDN_UPLOAD_URL: future HTTPS POST API for release:cdn
- AMIBA_CDN_UPLOAD_TOKEN: optional Bearer token, publisher only

A build on the wrong OS/Node architecture fails before preparing runtime assets.
