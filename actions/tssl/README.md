# Compile TSSL action

Compiles TSSL sources to Fallout INT bytecode with
[`@bgforge/tssl`](https://www.npmjs.com/package/@bgforge/tssl) (the `tssl` CLI) and commits the generated files
back to the branch that triggered the workflow. Use this to keep the committed bytecode in sync with its source
without each contributor running the compiler locally.

TSSL is a compiler, not a transpiler: the TypeScript source becomes bytecode directly, with no SSL text produced
or read on the way. `tssl` writes each source to a sibling file, so the committed change is the generated output,
not the source:

| Source  | Output | When                     |
| ------- | ------ | ------------------------ |
| `.tssl` | `.int` | always                   |
| `.tssl` | `.ssl` | with `transpile: "true"` |

The `.ssl` is the readable equivalent of what was compiled, for a mod that still ships generated SSL. It is
checked to compile to the same bytes the compiler wrote directly, so the two files in a commit cannot disagree.

## Usage

### Save mode (default): compile and commit

```yaml
name: Compile TSSL
on:
  push:
    branches: [main]
    paths:
      - "**/*.tssl"

permissions:
  contents: write

jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
        with:
          opt: "2"
          short-circuit: "true"
```

### Also committing the readable SSL

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
  with:
    transpile: "true"
```

### Check mode: validate output is current without committing

Set `check: true` to verify each source's committed output exists and matches a fresh compile. The action exits
non-zero (failing the job) on the first stale or missing output, and never commits or pushes.

```yaml
name: Validate compiled output
on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
        with:
          check: "true"
```

The switches must match the ones the committed output was built with, or every file reports as stale - pass the
same `opt` / `short-circuit` / `transpile` values in both workflows.

## Versioning

Pin the moving major alias to receive fixes automatically:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
```

or an immutable exact tag for a fully reproducible action revision:

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1.0.0
```

`actions/tssl/v1` is re-pointed to the latest `actions/tssl/v1.x` release; a breaking change bumps the major.
Pinning the tag fixes the _action code_ only - the `@bgforge/tssl` it installs is governed by the `version` input
(default `latest`), so set `version` too if you need the compiler pinned as well. A compiler that emits different
bytes is a change to what lands in your repo, so pinning `version` is worth considering for this action in
particular.

## Inputs

| Name                  | Default                                                 | Description                                                                                    |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `paths`               | `.`                                                     | Path passed to the tssl CLI (single path; recursive scan).                                     |
| `version`             | `latest`                                                | npm version specifier for `@bgforge/tssl`.                                                     |
| `transpile`           | `false`                                                 | If `true`, also write the readable `.ssl` beside each `.int` and commit it.                    |
| `opt`                 | `""`                                                    | Optimisation level (`0`, `1` or `2`). Empty uses the compiler's default.                       |
| `short-circuit`       | `false`                                                 | If `true`, compile `and`/`or` to skip the right operand once the left decides the result.      |
| `commit-message`      | `chore: update compiled output`                         | Commit subject when compiled output changes.                                                   |
| `commit-author-name`  | `github-actions[bot]`                                   | git author name.                                                                               |
| `commit-author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | git author email - the numeric prefix links the commit to the bot account.                     |
| `check`               | `false`                                                 | If `true`, verify each output is up to date (exit 1 on stale or missing output) and skip push. |

## Outputs

| Name            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `changed`       | `true` if any compiled output changed and was committed. |
| `changed-files` | Newline-separated list of committed output files.        |

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
- A hand-written `.ssl` and the `.int` compiled from it are how most Fallout mods are still written, and this
  action does not touch them: an output only maps back to a source when a `.tssl` of that name exists.

## Limitations

- **Deleted sources leave orphaned outputs.** Removing a `.tssl` source does not remove its generated `.int`
  (or `.ssl`). Delete the output manually in the same commit.
