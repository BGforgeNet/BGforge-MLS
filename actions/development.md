# Dev doc

See [`docs/releasing.md`](../docs/releasing.md) for the per-action tag scheme (`actions/<name>/vX.Y.Z` plus a
moving `actions/<name>/v1` alias).

## Implementation

The three actions share their scripts. `_shared/guard-fork-pr.sh` and `_shared/run-cli.sh` are invoked directly
from each `action.yml` (the CLI to run is passed via the `CLI` env var); `_shared/lib.sh` holds the changed-file
scan (`lc_emit_list`) and the commit/push tail (`finalize_commit_and_push`), sourced by each action's own
`scripts/list-changed.sh` and `scripts/commit-and-push.sh` - which supply only the per-CLI bits (the diff-to-worklist
mapping and what to stage). The scripts reach `_shared/` via `${{ github.action_path }}/../_shared`, which resolves
because a remote action reference downloads the whole repository; the release tag must therefore include `_shared/`
(see [`docs/releasing.md`](../docs/releasing.md)).
