# Standalone repository CI

`.github/workflows/ci.yml` is prepared for this directory becoming the root of
the new repository. GitHub does not discover nested workbench/.github workflows
inside the existing gateway repository. No workflow has been publicly executed
or published by this local preparation.

The Windows job installs the lockfile without lifecycle scripts, checks types,
runs isolated tests, builds the UI and audits production dependencies. It then
downloads the locked OfficeCLI release, verifies its binary SHA-256 and runs
the synthetic complex-document matrix against the original engine. No AionCore
account, API key, local certificate or installed Microsoft Office is required.
Only explicit synthetic result files/reports are uploaded, never all of .local.

Actions are commit-pinned, checkout credentials are not retained and token
permissions are read-only. The workflow has no pull_request_target, publication
or secret-bearing deployment job. First remote execution must still be observed
after the user authorizes publication; local syntax checks cannot prove it passed.

Desktop Office rendering, native COM multi-window behavior and actual model
tasks remain separate real-machine acceptance cases. An engine HTML preview
is not evidence of pixel-identical Microsoft Office rendering.
