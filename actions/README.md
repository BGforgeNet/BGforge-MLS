# BGforge MLS reusable Actions

This directory publishes four composite GitHub Actions that run a `@bgforge` CLI over the files changed in an
event and either commit the result back to the branch (**save** mode, default) or verify it without committing
(**check** mode):

| Action              | CLI                                                      | What it does                                         | README                                     |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `actions/binary`    | [fgbin](https://www.npmjs.com/package/@bgforge/binary)   | Refresh JSON snapshots alongside binary game data    | [binary/README.md](binary/README.md)       |
| `actions/format`    | [fgfmt](https://www.npmjs.com/package/@bgforge/format)   | Format Fallout/WeiDU source files in place           | [format/README.md](format/README.md)       |
| `actions/transpile` | [fgtp](https://www.npmjs.com/package/@bgforge/transpile) | Regenerate transpiled output (`.tbaf`/`.td` sources) | [transpile/README.md](transpile/README.md) |
| `actions/tssl`      | [tssl](https://www.npmjs.com/package/@bgforge/tssl)      | Compile `.tssl` sources to Fallout INT bytecode      | [tssl/README.md](tssl/README.md)           |

## Notes

All four actions share the same fork-PR guard (`actions/_shared/guard-fork-pr.sh`): it blocks a run whose event
is `pull_request` or `pull_request_target` and whose head is a fork, since a base-scoped or read-only token
cannot push to a fork's head branch, and running the CLI over fork-controlled files under `pull_request_target`
is itself a risk. The guard runs only in **save mode** - it is skipped when `check: true`, since check mode never
pushes and fork-PR check runs are each action's documented use case. See each action's own README for details.
