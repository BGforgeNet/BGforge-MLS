# BGforge MLS reusable Actions

This directory publishes three composite GitHub Actions that run a `@bgforge` CLI over the files changed in an
event and either commit the result back to the branch (**save** mode, default) or verify it without committing
(**check** mode). Each action's README is self-contained - full usage, inputs, outputs, versioning, and notes:

| Action              | CLI     | What it does                                                 | README                                     |
| ------------------- | ------- | ------------------------------------------------------------ | ------------------------------------------ |
| `actions/binary`    | `fgbin` | Refresh JSON snapshots alongside binary game data            | [binary/README.md](binary/README.md)       |
| `actions/format`    | `fgfmt` | Format Fallout/WeiDU source files in place                   | [format/README.md](format/README.md)       |
| `actions/transpile` | `fgtp`  | Regenerate transpiled output (`.tssl`/`.tbaf`/`.td` sources) | [transpile/README.md](transpile/README.md) |

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
