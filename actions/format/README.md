# Format source files action

Formats Fallout and WeiDU source files with [`@bgforge/format`](https://www.npmjs.com/package/@bgforge/format)
(the `fgfmt` CLI) and commits the reformatted files back to the branch that triggered the workflow. Use this to
keep a repository's sources canonically formatted without each contributor running the formatter locally.

`fgfmt` formats **in place** - the source file itself is rewritten, so the committed change is the reformatted
source (there is no sidecar). The set of file types it handles is documented under
[Supported file types](../../format/README.md#supported-file-types) in the `@bgforge/format` README - at the time
of writing `.ssl`, `.baf`, `.d`, `.tp2` (`.tph`/`.tpa`/`.tpp`), `.tra`, `.msg`, `.2da`, and `scripts.lst`.

## Usage

### Save mode (default): reformat and commit

```yaml
name: Format sources
on:
  push:
    branches: [main]
    # Trim this list to the file types your repo actually contains.
    paths:
      - "**/*.ssl"
      - "**/*.baf"
      - "**/*.d"
      - "**/*.tp2"
      - "**/*.tph"
      - "**/*.tpa"
      - "**/*.tpp"
      - "**/*.tra"
      - "**/*.msg"
      - "**/*.2da"
      - "**/scripts.lst"

permissions:
  contents: write

jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/format@actions/format/v1
```

### Check mode: validate formatting without committing

Set `check: true` to verify every file is already formatted. The action exits non-zero (failing the job) on the
first unformatted file, and never commits or pushes.

```yaml
name: Validate formatting
on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/format@actions/format/v1
        with:
          check: "true"
```

## Versioning

Pin the moving major alias to receive fixes automatically:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/format@actions/format/v1
```

or an immutable exact tag for a fully reproducible action revision:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/format@actions/format/v1.0.0
```

`actions/format/v1` is re-pointed to the latest `actions/format/v1.x` release; a breaking change bumps the major.
Pinning the tag fixes the _action code_ only - the `@bgforge/format` it installs is governed by the `version`
input (default `latest`), so set `version` too if you need the formatter pinned as well.

## Inputs

| Name                  | Default                                                 | Description                                                                           |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `paths`               | `.`                                                     | Path passed to the format CLI (single path; recursive scan).                          |
| `version`             | `latest`                                                | npm version specifier for `@bgforge/format`.                                          |
| `commit-message`      | `style: format source files`                            | Commit subject when formatting changes files.                                         |
| `commit-author-name`  | `github-actions[bot]`                                   | git author name.                                                                      |
| `commit-author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | git author email - the numeric prefix links the commit to the bot account.            |
| `check`               | `false`                                                 | If `true`, verify files are formatted (exit 1 on any unformatted file) and skip push. |

## Outputs

| Name            | Description                                       |
| --------------- | ------------------------------------------------- |
| `changed`       | `true` if any file was reformatted and committed. |
| `changed-files` | Newline-separated list of committed files.        |

## Notes

- In **save mode** the consumer workflow MUST grant `permissions: contents: write` (job-level or workflow-level)
  so the default `GITHUB_TOKEN` can push. **Check mode** does not push and needs no extra permissions; in that mode
  the `changed` / `changed-files` outputs are empty.
- Pushes made with the default `GITHUB_TOKEN` do not retrigger workflows, so there is no infinite-loop risk.
- The action exits with an error on `pull_request` events from forks: the token is read-only and the push would
  fail. Run the action on `push` events to your own branches.
- For `pull_request` triggers within your own repo, your `actions/checkout` step must specify
  `ref: ${{ github.head_ref }}` so the format commit lands on the PR head, not on a detached merge ref.
- Concurrent pushes to the same branch may cause the rebase-and-push step to fail; wrap the consumer job in a
  `concurrency:` block if your workflow can fire on rapid successive pushes.
- Only files added or modified in the current event's diff are processed. The action best-effort fetches the base
  and head SHAs into the local clone, but on events where no usable base SHA is available (new-branch push, manual
  `workflow_dispatch`, scheduled runs) it falls back to a full recursive scan of `paths`.

---

One of the [BGforge MLS reusable actions](../README.md) (`binary`, `format`, `transpile`).
