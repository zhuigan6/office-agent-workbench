# Security and data boundaries

- The HTTP host listens on loopback and checks Host, browser Origin and bearer
  credentials. TLS verification stays enabled. Pairing uses a URL fragment,
  never an HTTP query parameter. Do not expose this service to a LAN or tunnel.
- `.local` contains credentials, document copies, conversation databases,
  backups and diagnostic logs. Protect-Data.ps1 saves the old ACL and grants
  access only to the current user, SYSTEM and Administrators. Never publish it.
- UI credentials authorize local administration. Exported MCP credentials are
  separate and scoped to one conversation's files and bound document. MCP is
  not a sandbox for a native agent's independent shell or filesystem tools.
- Native agents retain their own permissions, login, global hooks and skills.
  The UI supports recognized one-time decisions and does not silently select
  always-allow. Review agent tool requests; uploaded documents are data, not
  authority to change permissions or run unrelated commands.
- Native Office attaches to explicitly selected, already-open documents in the
  user's session. It does not start Office, save originals or execute macros.
  Read-only/protected targets and unsupported structured text are rejected.
- File edits produce new copies. Live edits compare revisions and verify
  read-back. Before-states are checkpointed before dispatch and retained on
  uncertain results/restarts. Do not retry uncertain writes as new operations.
- Restore uses the exact post-edit revision and a stable operation ID. It must
  not overwrite intervening changes. Plain-text recovery is not rich-format
  restoration; Office COM does not supply a general atomic document transaction.
- Local HTML previews use a restrictive CSP in a sandboxed iframe. They are not
  proof of exact Word/PPT rendering. Remote Markdown images are not auto-loaded.
- Engines are private pinned copies with source release checksums. Packaging
  retains licenses, excludes private roots, rejects links and inventories files.
  A checksum detects changes; it is not a publisher signature. Use trusted
  packages and do not run source trees writable by untrusted local users.

Report reproducible issues with versions, sanitized errors and minimal synthetic
documents. Do not include tokens, provider keys, user databases or confidential
documents. Public issue reporting and repository publication are not enabled by
this local development workflow.

History archives are UI-only private data, not executable context or restored
agent sessions. Public tool arguments/text may still contain secrets. Exports
are not automatically sanitized. See HISTORY.md before sharing an archive.

CSV/TSV import is literal-data-only. The pinned engine was observed converting
=1+1 into a cell formula with result2. A bounded encoding/field preflight rejects
formula fields before engine execution; it does not escape them silently or claim
an upstream literal mode exists. Explicit formula editing remains a separate
reviewed operation. Source data and original workbooks are always retained.
# PDF parsing and dependency maintenance

PDF text inspection uses pinned PDF.js in a short-lived Node child, not the
agent's shell or an implicit system package installation. It accepts only a
verified uploaded file, reads at most five pages/24,000 characters, sets a
384 MB JavaScript heap limit and a20-second wall deadline. This is resource
containment, not an OS sandbox. PDF JavaScript evaluation and remote font/CMap
fetching are not enabled; bundled resources are used. OCR and visual fidelity
are not implied by successful text extraction.

The2026-09-27 dependency audit identified affected fflate, MCP SDK, ws, tsx and
Vite versions. Same-major pinned updates were applied; rerun `npm audit` at
release time because a clean report is a dated database result, not a security
guarantee. No `audit fix --force`, global tools, security exclusions or
execution-policy changes were used.
