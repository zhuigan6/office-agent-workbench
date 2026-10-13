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
permissions are read-only. The verification workflow has no pull_request_target, publication
or secret-bearing deployment job. Each publication's remote execution must still
be observed; local syntax checks cannot prove the new revision passed.

Desktop Office rendering, native COM multi-window behavior and actual model
tasks remain separate real-machine acceptance cases. An engine HTML preview
is not evidence of pixel-identical Microsoft Office rendering.

`checkpoint-assets.yml` is a separate manual recovery/build path for large-asset
upload failures. It checks an existing tag's exact commit and package version,
requires an existing draft, downloads original checksum-verified binaries, and
tests source and assembled package before upload. It never overwrites assets,
publishes a release, signs in to agents or reads local user data. Only this manual
job has repository contents-write permission. Its SHA256SUMS-ci.txt describes its
own assembled ZIP, not a byte-identical claim about the local ZIP. Maintainers
verify results/digests and release notes before publishing the draft.

`verify-release.yml` is manual and read-only. It downloads the public API record,
checksum and ZIP without an Authorization header or GH_TOKEN, compares the fixed
expected digest, extracts the archive and verifies every packaged file. This is
public-download acceptance, not desktop Office or model-account acceptance.
