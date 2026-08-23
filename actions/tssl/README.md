# Compile TSSL action

Compiles every TSSL source to Fallout INT bytecode with
[`@bgforge/tssl`](https://www.npmjs.com/package/@bgforge/tssl) (the `tssl` CLI). Bytecode is a build artifact, not
a committed one, so by default the action commits nothing: a clean compile IS the check, and a compile error fails
the job.

TSSL is a compiler, not a transpiler: the TypeScript source becomes bytecode directly, with no SSL text produced
or read on the way.

| Source  | Output | When                     | Committed                |
| ------- | ------ | ------------------------ | ------------------------ |
| `.tssl` | `.int` | always                   | never - a build artifact |
| `.tssl` | `.ssl` | with `transpile: "true"` | yes                      |

The `.ssl` is the readable equivalent of what was compiled, for a mod that still ships generated SSL. That is the
one output worth committing, so `transpile: "true"` is what turns this action into a committing one. The emitted
text is checked to compile to the same bytes the compiler wrote directly.

Every run compiles the whole `paths` tree rather than just the files an event touched: TSSL has imports, so a
change to one module can invalidate dependents that the event's diff does not name.

## Usage

### Default: compile as a CI check

```yaml
name: Compile TSSL
on:
  push:
    branches: [main]
    paths:
      - "**/*.tssl"

jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
        with:
          opt: "2"
          short-circuit: "true"
```

### Committing the readable SSL

Needs `permissions: contents: write`, since this is the mode that pushes.

```yaml
- uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
  with:
    transpile: "true"
```

### Check mode: verify the committed SSL is current

Set `check: true` alongside `transpile: "true"` to verify the committed `.ssl` matches a fresh compile. The action
exits non-zero (failing the job) if any is stale, and never commits or pushes. With `transpile` off there is
nothing committed to compare, so check mode adds nothing over the default compile.

```yaml
name: Validate compiled output
on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: BGforgeNet/BGforge-MLS/actions/tssl@actions/tssl/v1
        with:
          check: "true"
          transpile: "true"
```

The switches must match the ones the committed `.ssl` was built with, or every file reports as stale - pass the
same `opt` / `short-circuit` values in both workflows.

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

| Name                  | Default                                                 | Description                                                                                                             |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `paths`               | `.`                                                     | Path passed to the tssl CLI (single path; recursive scan).                                                              |
| `version`             | `latest`                                                | npm version specifier for `@bgforge/tssl`.                                                                              |
| `transpile`           | `false`                                                 | If `true`, also write the readable `.ssl` beside each `.int` and commit it. The `.int` is never committed.              |
| `opt`                 | `""`                                                    | Optimisation level (`0`, `1` or `2`). Empty uses the compiler's default.                                                |
| `short-circuit`       | `false`                                                 | If `true`, compile `and`/`or` to skip the right operand once the left decides the result.                               |
| `commit-message`      | `chore: update compiled output`                         | Commit subject when compiled output changes.                                                                            |
| `commit-author-name`  | `github-actions[bot]`                                   | git author name.                                                                                                        |
| `commit-author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | git author email - the numeric prefix links the commit to the bot account.                                              |
| `check`               | `false`                                                 | If `true`, verify the committed `.ssl` is up to date (exit 1 if stale) and skip push. Only meaningful with `transpile`. |

## Outputs

| Name            | Description                                               |
| --------------- | --------------------------------------------------------- |
| `changed`       | `true` if any generated `.ssl` changed and was committed. |
| `changed-files` | Newline-separated list of committed `.ssl` files.         |

## Notes

- Only a run with `transpile: "true"` and `check` off pushes, and that one MUST be granted
  `permissions: contents: write` (job-level or workflow-level) so the default `GITHUB_TOKEN` can push. The default
  compile-only mode and check mode need no extra permissions; in those the `changed` / `changed-files` outputs are
  empty.
- Pushes made with the default `GITHUB_TOKEN` do not retrigger workflows, so there is no infinite-loop risk.
- The action exits with an error on `pull_request` and `pull_request_target` events from forks: the token is
  read-only (or, for `pull_request_target`, base-scoped) and cannot push to the fork's head branch, and running
  the CLI over fork-controlled files under `pull_request_target` is itself a risk. Run the action on `push`
  events to your own branches. The guard applies only to a run that can push, so compile-only and check runs from
  fork PRs proceed normally.
- For `pull_request` triggers within your own repo, your `actions/checkout` step must specify
  `ref: ${{ github.head_ref }}` so the output commit lands on the PR head, not on a detached merge ref.
- Concurrent pushes to the same branch may cause the rebase-and-push step to fail; wrap the consumer job in a
  `concurrency:` block if your workflow can fire on rapid successive pushes.
- Every source under `paths` is compiled on every run, not just the ones the event changed - a module's
  dependents are invisible to a changed-file diff, so an incremental run could miss a break the change caused.
- A hand-written `.ssl` and the `.int` compiled from it are how most Fallout mods are still written, and this
  action does not commit them: the files it stages are derived from the `.tssl` sources it found, so a `.ssl`
  with no `.tssl` beside it is never claimed as generated output.

## Limitations

- **Deleted sources leave orphaned outputs.** Removing a `.tssl` source does not remove a previously committed
  `.ssl`. Delete it manually in the same commit.
