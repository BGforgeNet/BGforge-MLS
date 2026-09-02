# Contributing

## Quick start

```bash
pnpm install          # also installs the lefthook pre-commit hooks
pnpm build            # client, server, webviews, TS plugins, CLIs
pnpm test             # dev-loop suite
pnpm watch:client     # rebuild on change
pnpm watch:server
```

This project uses `pnpm` exclusively - `pnpm exec <command>`, never `npx`. Run the pre-commit hooks by hand with
`pnpm exec lefthook run pre-commit`.

## Documentation

[README.md](README.md) indexes every document in the repo, including the architecture and internals
guides. Start there.

## Verification tiers

Cheapest first:

1. `scripts/test-scoped.sh [paths...]` while iterating - maps changed paths (default: uncommitted changes) to the
   affected suites. `--dry-run` prints the plan.
2. `pnpm test` when a change outgrows the scoped suites.
3. `pnpm build:all` + `pnpm test:all` before submitting, and for anything spanning subsystems or touching shared
   build infra, grammars, transpilers, or the server.

`pnpm test` is not a close-out gate however green: the coverage thresholds live only in `test:all` and CI, which is
why its unit phase prints `no coverage` in its own name. A change can pass `pnpm test` and still commit a breach.

Every vitest config and suite runs from any working directory; includes and fixture paths are anchored to their own
file. Keep it that way.

## Testing against real external files

The `external/` mod trees are gitignored but reproducible - `pnpm test:external` checks them out at pinned refs. So
real-corpus coverage belongs in a committed test, never a throwaway script.

- Home: `server/test/integration/**`, run by `pnpm test:integration`.
- Helpers: `test/integration/test-helpers.ts` - `FALLOUT_FIXTURES`, `IE_FIXTURES`, `loadFixture`/`loadFixtures`.
- Gate a corpus sweep with `describe.skipIf(files.length === 0)` so it skips cleanly when the corpus is absent.
- Read a sibling first: `integration/weidu-d.test.ts`, `integration/fallout-ssl.test.ts`.
- Never commit copies of gitignored `external/` files as fixtures.

## Public surfaces

Four libraries publish to npm, plus the server package. What holds each contract:

| Surface                                                     | Held by                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@bgforge/binary` API                                       | `binary/test/public-api.test.ts`                                       |
| `@bgforge/format` API                                       | `format/test/public-api.test.ts`                                       |
| `@bgforge/transpile` API                                    | `transpilers/test/public-api.test.ts` + `transpilers/test/api.test.ts` |
| `@bgforge/tssl` API                                         | nothing - no test pins it                                              |
| `@bgforge/mls-server` protocol                              | [lsp-api.md](lsp-api.md), by convention                                |
| CLI flags and exit codes (`fgbin`, `fgfmt`, `fgtp`, `tssl`) | `pnpm test:cli`                                                        |
| `*.{pro,map,itm,spl,eff,cre,dlg}.json` shape                | committed snapshots                                                    |

Where a test pins the surface, adding a public export means extending its list, and removing one fails before
downstream consumers see the break. Each CLI ships from its library's package and shares its version. The JSON
snapshot shape moves with `@bgforge/binary`; until the versioned specification queued in
[todo.md](todo.md) lands, treat any change to `createBinaryJsonSnapshot` output as breaking.

The LSP protocol has nothing behind it but this rule: if a change affects what a client must send, can receive, or
may rely on over LSP or the shared client/server protocol, update [lsp-api.md](lsp-api.md) in the same
change: new requests, notifications, commands or payload fields, changed meaning or encoding of existing parameters,
and behaviour third-party clients must opt into. Architecture docs are not a substitute for the wire-level contract.

## Debugging

Press F5 to launch the Extension Development Host; the server accepts a debugger on port 6009. Server logs go to the
Output panel, "BGforge MLS" channel. For TS plugin logs, set `"typescript.tsserver.log": "verbose"` and check the
Output panel under "TypeScript".
