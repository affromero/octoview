# Security Policy

octoview is a browser extension that runs on `github.com` with your session
cookies and renders untrusted files from any repository you open. That makes its
security posture the whole point, so it is documented here.

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/affromero/octoview/security/advisories/new)
or email **me@afromero.co**. Please do not open a public issue for a security
bug. Expect an acknowledgement within a few days.

## Threat model

The extension fetches a file with your GitHub session and renders it inline. The
file, and any repository README that links to it, are **untrusted**. The design
holds these invariants:

- **Untrusted HTML/scripts never run with privilege.** HTML reports and notebook
  HTML outputs execute only inside a `sandbox="allow-scripts"` iframe in an
  **opaque origin** — no `allow-same-origin`. Such a frame cannot read
  `github.com` cookies or DOM, call extension APIs, or make requests as you. A
  `connect-src 'none'` CSP additionally denies it network egress.
- **Least privilege.** Host permissions are exactly `github.com` and
  `raw.githubusercontent.com`; no `tabs`, `storage`, `cookies`, `scripting`, or
  `<all_urls>`. The file is fetched `same-origin`, so cookies are never sent to
  a third party.
- **No exfiltration.** There is no telemetry, analytics, or any network request
  to a non-GitHub host anywhere in the extension.
- **Untrusted binary is parsed defensively.** Every decoder validates
  header-declared sizes against the actual buffer before allocating, caps
  decompression output (gzip/zstd/zip bombs), and bounds every file-driven loop,
  so a crafted file fails fast instead of hanging or OOM-ing the tab.

## Code and dependency standards

- **No secrets in the repo.** Gitleaks scans every push and PR.
- **Dependencies are pinned and audited.** Every vendored library is bundled
  from a lockfile-pinned npm dependency (never a floating CDN URL). `npm audit`
  runs on every push/PR and weekly; Dependabot proposes updates weekly with a
  7-day cooldown so a freshly-compromised release is not adopted immediately.
- **Rendered markdown is sanitized.** `marked` output is stripped of active
  content (script-ish elements, `on*` handlers, and `javascript:`/`data:`/
  `vbscript:` URLs including control-character-obfuscated variants) before it
  reaches the DOM, independent of GitHub's CSP.
- **CI is the gate.** Lint, format, unit tests, and a WebKit + Chromium render
  suite must pass; the Chrome and Firefox builds are load-tested and
  addons-linter-clean.

## Supported versions

The latest `main` is the only supported version; fixes ship there and to the
store builds.
