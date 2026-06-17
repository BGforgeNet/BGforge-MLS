# BGforge MLS reusable Actions

This directory publishes three composite GitHub Actions that run a `@bgforge` CLI over the files changed in an
event and either commit the result back to the branch (**save** mode, default) or verify it without committing
(**check** mode):

| Action              | CLI                                                      | What it does                                                 | README                                     |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `actions/binary`    | [fgbin](https://www.npmjs.com/package/@bgforge/binary)   | Refresh JSON snapshots alongside binary game data            | [binary/README.md](binary/README.md)       |
| `actions/format`    | [fgfmt](https://www.npmjs.com/package/@bgforge/format)   | Format Fallout/WeiDU source files in place                   | [format/README.md](format/README.md)       |
| `actions/transpile` | [fgtp](https://www.npmjs.com/package/@bgforge/transpile) | Regenerate transpiled output (`.tssl`/`.tbaf`/`.td` sources) | [transpile/README.md](transpile/README.md) |
