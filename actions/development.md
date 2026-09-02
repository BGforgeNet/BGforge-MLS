# Dev doc

See [`docs/releasing.md`](../docs/releasing.md) for the per-action tag scheme (`actions/<name>/vX.Y.Z` plus a
moving `actions/<name>/v1` alias).

## Implementation

Every action in this directory invokes `_shared/guard-fork-pr.sh` directly from its `action.yml`. `binary`,
`format` and `transpile` also invoke `_shared/run-cli.sh` there (the CLI to run is passed via the `CLI` env var)
and source `_shared/lib.sh` - which holds the changed-file scan (`lc_emit_list`) and the commit/push tail
(`finalize_commit_and_push`) - from their own `scripts/list-changed.sh` and `scripts/commit-and-push.sh`, which
supply only the per-CLI bits (the diff-to-worklist mapping and what to stage). `tssl` runs its own
`scripts/switches.sh`, `scripts/run.sh` and `scripts/finish.sh` instead, sourcing `_shared/lib.sh` only from
`finish.sh`. The scripts reach `_shared/` via `${{ github.action_path }}/../_shared`, which resolves
because a remote action reference downloads the whole repository; the release tag must therefore include `_shared/`
(see [`docs/releasing.md`](../docs/releasing.md)).
