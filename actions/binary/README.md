# Binary JSON snapshots action

Refreshes JSON snapshot files alongside binary game data using
[`@bgforge/binary`](https://www.npmjs.com/package/@bgforge/binary), and commits them back to the branch that triggered
the workflow. Use this so changes to binaries land in git history alongside their human-readable JSON form.

The set of binary formats handled is discovered at runtime from the installed `@bgforge/binary` (`fgbin --extensions`),
so any format newly registered there is picked up by the action without a matching action release. At the time of
writing that is `.pro` / `.map` (Fallout) and `.itm` / `.spl` / `.eff` (Infinity Engine).

## Usage

### Save mode (default): refresh snapshots and commit them

```yaml
name: Binary snapshots
on:
    push:
        branches: [main]
        # Trim this list to the formats your repo actually contains.
        paths:
            - "**/*.pro"
            - "**/*.map"
            - "**/*.itm"
            - "**/*.spl"
            - "**/*.eff"

permissions:
    contents: write

jobs:
    snapshot:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v6
            - uses: BGforgeNet/BGforge-MLS/actions/binary@v1
```

### Check mode: validate snapshots without committing

Set `check: true` to verify each binary has a matching, up-to-date snapshot. The action exits non-zero (failing the job)
on any diff or missing snapshot, and never commits or pushes.

```yaml
name: Validate binary snapshots
on:
    push:
    pull_request:

jobs:
    check:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v6
            - uses: BGforgeNet/BGforge-MLS/actions/binary@v1
              with:
                  check: "true"
```

## Inputs

| Name                  | Default                                                 | Description                                                                                               |
| --------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `paths`               | `.`                                                     | Path passed to the binary CLI (single path; recursive scan).                                              |
| `version`             | `latest`                                                | npm version specifier for `@bgforge/binary`.                                                              |
| `commit-message`      | `chore: update binary JSON snapshots`                   | Commit subject when snapshots change.                                                                     |
| `commit-author-name`  | `github-actions[bot]`                                   | git author name.                                                                                          |
| `commit-author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | git author email — the numeric prefix links the commit to the bot account.                                |
| `check`               | `false`                                                 | If `true`, verify snapshots match the binaries (exit 1 on diff or missing snapshot) and skip commit/push. |

## Outputs

| Name            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `changed`       | `true` if snapshot files changed and were committed. |
| `changed-files` | Newline-separated list of committed snapshot files.  |

## Notes

- In **save mode** the consumer workflow MUST grant `permissions: contents: write` (job-level or workflow-level) so the
  default `GITHUB_TOKEN` can push. **Check mode** does not push and needs no extra permissions; in that mode the
  `changed` / `changed-files` outputs are empty.
- Pushes made with the default `GITHUB_TOKEN` do not retrigger workflows, so there is no infinite-loop risk.
- The action exits with an error on `pull_request` events from forks: the token is read-only and the push would fail.
  Run the action on `push` events to your own branches.
- For `pull_request` triggers within your own repo, your `actions/checkout` step must specify
  `ref: ${{ github.head_ref }}` so the snapshot commit lands on the PR head, not on a detached merge ref.
- Concurrent pushes to the same branch may cause the rebase-and-push step to fail; wrap the consumer job in a
  `concurrency:` block if your workflow can fire on rapid successive pushes.
- Only binary files (any extension `@bgforge/binary` recognizes) added or modified in the current event's diff are
  processed. The action best-effort fetches the base and head SHAs into the local clone, but on events where no usable
  base SHA is available (new-branch push, manual `workflow_dispatch`, scheduled runs) it falls back to a full recursive
  scan of `paths`.

## Limitations

- **Deleted binaries leave orphaned snapshots.** Removing a binary does not remove its corresponding `.json` snapshot.
  Delete the snapshot manually in the same commit.
