# Standalone repository CI

`.github/workflows/ci.yml` runs at the root of the public office-agent-workbench
repository, not the parent legacy gateway repository. Alpha.2 main/tag CI passed;
each new release requires its own observed CI result. Source tests now use bounded
concurrency4, retaining every assertion while avoiding the previously observed
cold package child-process timeouts; their resource cause is not claimed proved.

The Windows job installs the lockfile without lifecycle scripts, checks types,
runs isolated tests, builds the UI and audits production dependencies. It then
downloads the locked OfficeCLI release, verifies its binary SHA-256 and runs
the synthetic complex-document matrix against the original engine. No AionCore
account, API key, local certificate or installed Microsoft Office is required.
Only explicit synthetic result files/reports are uploaded, never all of .local.

Actions are commit-pinned, checkout credentials are not retained and token
permissions are read-only. The workflow has no pull_request_target, publication
or secret-bearing deployment job. Each publication's remote execution must still
be observed; local syntax checks cannot prove the new revision passed.

Desktop Office rendering, native COM multi-window behavior and actual model
tasks remain separate real-machine acceptance cases. An engine HTML preview
is not evidence of pixel-identical Microsoft Office rendering.
