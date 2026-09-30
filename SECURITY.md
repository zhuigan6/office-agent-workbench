# Security policy

The current public preview is supported on Windows x64. It is not a sandbox
against programs running as the same Windows user. Use disposable documents and
review edits before saving. Keep .local, certificates, keys and conversations
private; never attach them to a public issue.

For a vulnerability, use GitHub private vulnerability reporting when enabled,
or contact the maintainer privately before disclosing an exploit. Public issues
are suitable for redacted installation errors, not credentials or sensitive files.

Known boundaries: native agents inherit their existing configuration; document
grants authorize a specific task; native-terminal grants access the owned Codex
server, not only document methods. Certificates require manual renewal. Read
docs/RELEASE-SCOPE.md and docs/INSTALLATION.md before deployment.
