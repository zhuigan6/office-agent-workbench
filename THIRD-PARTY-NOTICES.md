# Third-party components

Workbench code follows the parent project's MIT license (2026 zhuigan6).
No Anthropic proprietary frontend is copied or redistributed. The retired add-in
is not part of the standalone distribution.

| Component | Pinned version | Use | License |
| --- | --- | --- | --- |
| AionCore | 0.2.2 / 47e66d0 | Original local backend executable | Apache-2.0 |
| OfficeCLI | 1.0.152 / ffa8a0a | Original document engine executable | Apache-2.0 |
| AionUi | 2.2.2 / 6744099 | Design and integration reference, not bundled | Apache-2.0 |
| Node.js | Build runtime version recorded in manifest | JavaScript runtime | MIT and bundled dependency notices |
| AionCore managed Node.js | 24.11.0 | Original upstream managed runtime | MIT and bundled dependency notices |
| npm dependencies | package-lock.json | UI, transport, validation, build and tests | Individual package license files |
| PDF.js | 6.3.289 | Bounded PDF text extraction in a child process | Apache-2.0; original package LICENSE retained |

Bundled npm packages retain their original files and notices in node_modules.
Upstream license texts are included in licenses; the managed Node distribution
retains its LICENSE. Each distributed byte is recorded in package-manifest.json.
No upstream source is patched. Neither inclusion nor interface compatibility
implies endorsement by Anthropic, Microsoft, or iOfficeAI.

Sources: https://github.com/iOfficeAI/AionCore,
https://github.com/iOfficeAI/OfficeCLI, https://github.com/iOfficeAI/AionUi,
https://github.com/nodejs/node. Upstream version changes require refreshing the
lock file, notices, binary provenance and compatibility acceptance together.
