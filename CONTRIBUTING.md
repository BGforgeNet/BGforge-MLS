# Contributing

## Quick Start

```bash
pnpm install
pnpm build            # Build client, server, test bundles, webviews (includes TS plugins + CLIs)
pnpm test             # Dev-loop suite: typecheck + lint + unit + samples + CLI + knip + grammars + integration + corpus canary
pnpm test:all         # Close-out gate: same categories at full depth - coverage, the external-corpus sweep, the full sweeps
pnpm watch:client     # Dev mode: rebuild on change
pnpm watch:server
```

**Note:** This project uses `pnpm` exclusively. Use `pnpm exec <command>` instead of `npx <command>`.

**Note:** `pnpm install` runs the `prepare` script, which installs the [lefthook](https://lefthook.dev) pre-commit
git hooks automatically. Run the hooks manually with `pnpm exec lefthook run pre-commit`.

## Documentation

| Document                                                       | Contents                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                   | System overview, build pipeline, client/server/CLI structure, data pipeline, design decisions |
| [docs/lsp-api.md](docs/lsp-api.md)                             | Public LSP/client-server contract for third-party clients                                     |
| [server/INTERNALS.md](server/INTERNALS.md)                     | Server internals: provider registry, symbol system, data flow, tree-sitter integration        |
| [binary/INTERNALS.md](binary/INTERNALS.md)                     | Binary library internals: spec system, primitives, derivation, format adapters                |
| [image/README.md](image/README.md)                             | Animation library: FRM/BAM codecs, FRM <-> BAM conversion, PNG/APNG import/export             |
| [scripts/README.md](scripts/README.md)                         | Build and test scripts reference                                                              |
| [grammars/README.md](grammars/README.md)                       | Tree-sitter grammars: building, WASM, CJS patching                                            |
| [server/data/README.md](server/data/README.md)                 | YAML data format for completion/hover                                                         |
| [plugins/tssl-plugin/README.md](plugins/tssl-plugin/README.md) | TSSL tsserver plugin: TS6133 suppression, engine proc hover                                   |
| [plugins/td-plugin/README.md](plugins/td-plugin/README.md)     | TD tsserver plugin: runtime injection, completion filtering                                   |
| [docs/ignore-files.md](docs/ignore-files.md)                   | Ignore file reference (.gitignore, .vscodeignore, editorconfig, oxfmt, oxlint)                |

## Project Structure

See [docs/architecture.md](docs/architecture.md) for full repository layout.

## API Documentation Rule

If a change affects what a client must send, can receive, or may rely on over LSP or the shared client/server protocol, update [docs/lsp-api.md](docs/lsp-api.md) in the same change.

This includes:

- new custom requests, notifications, commands, or payload fields
- changes to the meaning or encoding of existing request parameters
- behavior differences that third-party clients may need to opt into

Architecture-only docs are not enough for those cases. Document the wire-level contract and compatibility expectations explicitly.

## Describing external tools

This project reimplements or interoperates with several third-party tools - the reference `sslc` compiler,
WeiDU, the game engines. Naming them is fine and often necessary; citing their internals is not.

Describe what such a tool _does_ - its observable behaviour, switches, file formats, and the values it
produces. Do not cite its source files or internal symbols in committed code, comments, or docs, and do not
vendor its lookup tables (a handful of values in a test is fine). Behaviour is what this project depends on
and what stays true across their versions; a file or symbol name is neither.

## Public-surface contracts

The three published library packages each have a snapshot test that pins
their public surface. Adding a new public export means extending the
corresponding list; removing one fails the test before downstream consumers
see the break.

| Package              | Pinned by                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `@bgforge/binary`    | `binary/test/public-api.test.ts`                                                              |
| `@bgforge/format`    | `format/test/public-api.test.ts`                                                              |
| `@bgforge/transpile` | `transpilers/test/public-api.test.ts` (presence) + `transpilers/test/api.test.ts` (behaviour) |

The bundled CLIs (`fgbin`, `fgfmt`, `fgtp`) ship from the same package as
their library and therefore share its version; their flag and exit-code
contracts are covered by `pnpm test:cli` integration tests.

The on-disk shape of `*.{pro,map,itm,spl,eff,cre,dlg}.json` snapshots is its own
consumer-facing contract (committed snapshots, [`actions/binary`](actions/binary/README.md) CI checks)
and moves with `@bgforge/binary`. A versioned consumer-facing specification
is queued in [docs/todo.md](docs/todo.md); until that lands, treat any
change to `createBinaryJsonSnapshot` output as breaking.

## Testing against real external files

The `external/` mod trees are gitignored but reproducible: `pnpm test:external` (via `scripts/reset-external.sh`
and `scripts/external-repos-lib.sh`) checks them out at pinned refs. Real-corpus coverage therefore belongs in a
committed test, never a throwaway script.

- Home: `server/test/integration/**`, run by `pnpm test:integration` (config `server/vitest.integration.config.mts`).
- Helpers: `test/integration/test-helpers.ts` - `FALLOUT_FIXTURES`, `IE_FIXTURES`, `loadFixture`/`loadFixtures`.
- Gate a corpus sweep with `describe.skipIf(files.length === 0)` so it skips cleanly when the corpus is absent.
- Read a sibling first (`integration/weidu-d.test.ts`, `integration/fallout-ssl.test.ts`) for the fixture and
  init conventions.
- Never commit copies of gitignored `external/` files as fixtures.

## Verification tiers

Cheapest first:

1. `scripts/test-scoped.sh [paths...]` while iterating - maps changed paths (default: uncommitted git changes)
   to the affected suites. `--dry-run` prints the plan.
2. `pnpm test` when a change outgrows the scoped suites.
3. `pnpm build:all` + `pnpm test:all` at close-out, and for anything spanning subsystems or touching
   shared build infra, grammars, transpilers, or the server.

`pnpm test` is not a close-out gate however green: it runs every category but not every gate, because the
coverage thresholds live only in `test:all` and CI - which is why its unit phase prints `no coverage` in its own
name. A change can pass `pnpm test` and still commit a threshold breach.

All vitest configs and suites run from any cwd; includes and fixture paths are anchored to their own file. Keep
it that way.

## Debugging

Press F5 in VSCode to launch the Extension Development Host. Server attaches on port 6009.

Server logs: Output panel, "BGforge MLS" channel.

TS plugin logs: set `"typescript.tsserver.log": "verbose"` in settings, check Output panel under "TypeScript".

## Temporary Files

Keep transient test/build artifacts under the repo-level `tmp/` directory unless a tool specifically requires system temp storage.

Do not create temporary directories inside source or fixture trees such as `server/test/`, `binary/test/`, or `scripts/**`.

## Submitting Changes

1. Fork the repository on GitHub and clone your fork.
2. Create a topic branch off `master` (`git checkout -b fix/short-description`). Avoid committing directly to `master` on your fork.
3. Make your changes on the topic branch. Match the commit-message style visible in `git log` - one short imperative subject (no period), an optional body explaining the _why_. Don't reference the PR number, the development workflow, or AI tooling.
4. Run `pnpm test:all` before pushing; that runs the canonical full-verification target (build, typecheck, lint, unit/integration/grammar/external suites). PR review starts from a green run.
5. Push your branch to your fork and open a pull request against `BGforgeNet/BGforge-MLS:master`. Describe what changed and why; link any issues the PR closes.
6. Update `docs/changelog.md` for any user-facing change (new feature, bug fix, behavior change). Internal refactors and test additions do not earn changelog entries.

For changes that affect the LSP wire contract, also update `docs/lsp-api.md` per the rule above.
