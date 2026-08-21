# Transpile sources action

Transpiles TBAF / TD sources to WeiDU BAF / WeiDU D with
[`@bgforge/transpile`](https://www.npmjs.com/package/@bgforge/transpile) (the `fgtp` CLI) and commits the
generated files back to the branch that triggered the workflow. Use this to keep the committed transpiler output
in sync with its source without each contributor running the transpiler locally.

`fgtp` writes each source to a sibling file with a different extension, so the committed change is the generated
output, not the source. The input/output mapping is documented under
[`fgtp` CLI](../../transpilers/README.md#fgtp-cli) in the `@bgforge/transpile` README:

| Source  | Output |
| ------- | ------ |
| `.td`   | `.d`   |
| `.tbaf` | `.baf` |

## Usage

### Save mode (default): regenerate output and commit

```yaml
name: Transpile sources
on:
  push:
    branches: [main]
    # Trim this list to the source types your repo actually contains.
    paths:
      - "**/*.td"
      - "**/*.tbaf"

permissions:
  contents: write

jobs:
  transpile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/transpile@actions/transpile/v1
```

### Check mode: validate output is current without committing

Set `check: true` to verify each source's committed output exists and matches a fresh transpile. The action exits
non-zero (failing the job) on the first stale or missing output, and never commits or pushes.

```yaml
name: Validate transpiled output
on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/transpile@actions/transpile/v1
        with:
          check: "true"
```

## Versioning

Pin the moving major alias to receive fixes automatically:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/transpile@actions/transpile/v1
```

or an immutable exact tag for a fully reproducible action revision:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/transpile@actions/transpile/v1.0.0
```

`actions/transpile/v1` is re-pointed to the latest `actions/transpile/v1.x` release; a breaking change bumps the
major. Pinning the tag fixes the _action code_ only - the `@bgforge/transpile` it installs is governed by the
`version` input (default `latest`), so set `version` too if you need the transpiler pinned as well.

## Inputs

| Name                  | Default                                                 | Description                                                                                   |
| --------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `paths`               | `.`                                                     | Path passed to the transpile CLI (single path; recursive scan).                               |
| `version`             | `latest`                                                | npm version specifier for `@bgforge/transpile`.                                               |
| `commit-message`      | `chore: update transpiled output`                       | Commit subject when transpiled output changes.                                                |
| `commit-author-name`  | `github-actions[bot]`                                   | git author name.                                                                              |
| `commit-author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | git author email - the numeric prefix links the commit to the bot account.                    |
| `check`               | `false`                                                 | If `true`, verify each output is up to date (exit 1 on diff or missing output) and skip push. |

## Outputs

| Name            | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `changed`       | `true` if any transpiled output changed and was committed. |
| `changed-files` | Newline-separated list of committed output files.          |

## Notes

- In **save mode** the consumer workflow MUST grant `permissions: contents: write` (job-level or workflow-level)
  so the default `GITHUB_TOKEN` can push. **Check mode** does not push and needs no extra permissions; in that mode
  the `changed` / `changed-files` outputs are empty.
- Pushes made with the default `GITHUB_TOKEN` do not retrigger workflows, so there is no infinite-loop risk.
- The action exits with an error on `pull_request` and `pull_request_target` events from forks: the token is
  read-only (or, for `pull_request_target`, base-scoped) and cannot push to the fork's head branch, and running
  the CLI over fork-controlled files under `pull_request_target` is itself a risk. Run the action on `push`
  events to your own branches. The guard is skipped in **check mode**, since check mode never pushes -
  fork-PR check runs (this action's documented check-mode use case) proceed normally.
- For `pull_request` triggers within your own repo, your `actions/checkout` step must specify
  `ref: ${{ github.head_ref }}` so the output commit lands on the PR head, not on a detached merge ref.
- Concurrent pushes to the same branch may cause the rebase-and-push step to fail; wrap the consumer job in a
  `concurrency:` block if your workflow can fire on rapid successive pushes.
- Only sources added or modified in the current event's diff are processed (a changed output file maps back to its
  source so a hand-edited generated file is regenerated). The action best-effort fetches the base and head SHAs
  into the local clone, but on events where no usable base SHA is available (new-branch push, manual
  `workflow_dispatch`, scheduled runs) it falls back to a full recursive scan of `paths` for sources.

## Limitations

- **Deleted sources leave orphaned outputs.** Removing a `.td`/`.tbaf` source does not remove its
  generated `.d`/`.baf`/`.ssl` file. Delete the output manually in the same commit.
