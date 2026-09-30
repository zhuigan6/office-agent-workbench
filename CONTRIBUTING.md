# Development and acceptance

Use Windows desktop Office for native connector acceptance and Node24 for the
host. The Office add-in experiment is retired; do not reintroduce it as an
installation prerequisite. Keep AionCore and OfficeCLI original and pinned.

## Focused changes

Read the affected module and its tests before editing. Preserve `.local`, user
documents, task history and credentials. Never run live writes against arbitrary
open documents. Native fixtures must be explicitly identified by the operator;
restore their original content and record read-back evidence.

Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run build` and
`npm audit`. Do not use automatic forced dependency upgrades. UI changes require
actual browser acceptance at desktop and narrow sizes, including failure states.
Model-dependent checks report exact agent/provider provenance and limitations.

## Upstream changes

Upgrade one pinned component at a time. Record binary hashes, version and license
changes in upstreams.lock.json/THIRD-PARTY-NOTICES.md. Run protocol, real scoped
MCP, file-copy and native Office checks. Preserve a working offline rollback.
Do not alter global agent configuration to hide an upstream compatibility issue.

## Local package

Build the UI before running `node --import tsx scripts/Build-Package.ts DEST`.
DEST must not exist. The builder uses verified local engines and original
managed resources; it is not a downloader. Verify the pristine output using
Manage-Package.ts before initialization. Never zip an initialized installation.
Install/upgrade/rollback steps and current evidence are in docs/INSTALLATION.md
and docs/CAPABILITIES.md. `docs/PROGRESS.md` is a private development handoff,
not a release artifact.

## Publication boundary

`node --import tsx scripts/Build-Source.ts NEW_DIRECTORY` exports an independent
source tree without private state, dependencies, retired add-ins or progress logs.
Use a fresh directory outside source folders or under .local. No Git operation is
performed. Install dependencies and verify that export before publishing it.
Native fixture preparation and second-machine steps are in docs/ACCEPTANCE.md.

Keep changes small and reviewable. A source commit, a version tag and a Release
are separate actions. This local preparation does not authorize publication.
Before public release, review secrets, third-party notices and supported
capabilities, test the downloadable package, and publish matching checksums.
Do not claim universal model support or a speed/cost advantage without evidence.
