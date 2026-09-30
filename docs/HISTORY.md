# Read-only history archives

The History Archives view imports public text records without adding them to a
live agent session, executing old tools, or modifying existing conversations.
Only UI pairing credentials can access archive APIs. Scoped MCP credentials
cannot read archives. Files remain private in the local documents database.

Supported inputs:
- Canonical JSON: `{"format":"office-workbench-history/v1","title":"Example","messages":[{"role":"user","text":"Hello"}]}`.
- Claude Code JSONL user/assistant message records: text and tool-use/result blocks.
- Codex JSONL `response_item` public message, function_call and function_call_output
  records. Mirrored event messages are skipped to avoid duplication.

System/developer messages, hidden reasoning, images and unsupported record types
are omitted. The UI reports skipped records. These are bounded compatibility
parsers, not universal importers or a lossless native agent backup. Branch graphs,
tool execution state and native resume credentials are not reconstructed.

Limits: 8 MB input, 20,000 JSONL records, 10,000 public messages, 200,000 characters
per message, 50 messages per page, 200 newest archives in the list. Malformed
JSONL is rejected as a whole before persistence. Exact duplicate bytes reuse the
same SHA-256 archive identity; renamed files do not create duplicate archives.

Exports use the canonical format and preserve the imported public messages.
They are NOT automatically sanitized. Review sensitive text/tool arguments before
sharing; never publish the local archive database. Imported content is displayed
as text, with no HTML execution or automatic remote image loading.

Authenticated routes: GET/POST `/api/archives`, GET `/api/archives/:sha256`
with optional `offset`, GET `/api/archives/:sha256/export`. POST accepts raw UTF-8
JSON/JSONL, optional `name` query parameter. These routes never invoke AionCore.

The local CLI uses the same archives: `archives`, `archive SHA256 --offset 50`,
and `import-history PATH`. It does not create agent conversations. CLI output
retains the existing best-effort credential redaction; archive exports from the
UI intentionally preserve imported public text and require manual review.

Verification: parser/store tests plus real UI import, duplicate rejection,
malformed input, 53-message pagination and export round trip on synthetic data.
Actual user native transcript exports may contain additional unsupported shapes.
