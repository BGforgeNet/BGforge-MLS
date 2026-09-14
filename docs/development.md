# Development

How to build, test and debug the repository. [README.md](README.md) indexes every other document, including the
architecture and internals guides.

This project uses `pnpm` exclusively - `pnpm exec <command>`, never `npx`.

## Prerequisites

- **Node.js 24**, the line CI builds and tests on. The published packages declare `engines.node` `>=20`, which is the
  floor for consumers, not the development version.
- **pnpm** at the version pinned by the root `package.json` `packageManager` field.
- **Network access** for the first `pnpm build:grammar` (tree-sitter downloads its WASI SDK into its own cache), for
  the WeiDU binary `scripts/ensure-weidu.sh` downloads when none is on `PATH`, for the pinned lint binaries
  `pnpm lint:shell` and `pnpm lint:workflows` fetch, for the code-server `pnpm dev:web` downloads into `.dev/` on
  first run, and for `pnpm test:external`.
- **`curl` and `xmllint`** (libxml2) for the script tests: `scripts/utils/test/generate-ksh.test.ts` downloads the KDE
  syntax-highlighting schema and validates the generated Kate bundle against it.
- **`zip`** for `pnpm package` and `pnpm build:editors`.
- **`unzip`** to unpack the WeiDU download `scripts/ensure-weidu.sh` falls back to, and for `pnpm package` and
  `pnpm package:grammars`, which unpack their archives to verify the contents.
- **`xvfb-run`** and the host libraries Electron needs, for `pnpm test:e2e` only.
- **Chromium** for `pnpm test:harness` only: `pnpm exec playwright install chromium`.

## Quick start

```bash
pnpm install          # also installs the lefthook pre-commit hooks
pnpm build:grammar    # tree-sitter WASMs - gitignored, and every build below copies them
pnpm build            # client, server, webviews, TS plugins, CLIs
pnpm test             # dev-loop suite
```

`pnpm build:grammar` is needed again only after a grammar change. Run the pre-commit hooks by hand with
`pnpm exec lefthook run pre-commit`.

## Everyday commands

| Command                                        | For                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm build:dev`                               | The minimal build F5 runs: client, webviews, TS plugins, server              |
| `pnpm watch:client`, `pnpm watch:server`       | Rebuild on change                                                            |
| `pnpm test:project <name> [file filter]`       | One package's tests; names are in each package's vitest config               |
| `pnpm lint`                                    | Every lint pass the gate runs                                                |
| `pnpm exec oxfmt <files>`                      | Format changed files (`--check` to verify only)                              |
| `pnpm lsp-probe <request> <file> <line> <col>` | Ask the built server one LSP request                                         |
| `pnpm ssl-diff <file.ssl>`                     | Compare one SSL construct against the reference compiler                     |
| `pnpm anim-probe <gameDir> <query> <arg>...`   | Ask an Infinity Engine install about an animation                            |
| `pnpm dev:web`                                 | Run the whole extension in code-server ([dev-web.md](../scripts/dev-web.md)) |
| `pnpm test:harness`                            | Mount the real webview bundles in headless Chromium                          |
| `pnpm test:e2e`                                | E2E tests in a real VS Code, after `pnpm build`                              |

When to reach for each probe, and its flags: the "Reach for the right probe" section of [AGENTS.md](../AGENTS.md).
The build and test scripts behind these commands: [scripts/README.md](../scripts/README.md).

## Verification tiers

Cheapest first:

1. `scripts/test-scoped.sh [paths...]` while iterating - maps changed paths (default: uncommitted changes) to the
   affected suites. `--dry-run` prints the plan.
2. `pnpm test` when a change outgrows the scoped suites.
3. `pnpm test:cov <pkg>...` on the packages you touched, once code has moved between files - it is the cheap way
   to find a coverage breach, which otherwise surfaces only at the end of the full gate. See
   `scripts/test-coverage.sh` for why it is a tier of its own.
4. `pnpm build:all` + `pnpm test:all` before submitting, and for anything spanning subsystems or touching shared
   build infra, grammars, transpilers, or the server.

`pnpm test` is not a close-out gate however green: it enforces no coverage thresholds - `pnpm test:cov`, `test:all`
and CI do - so a change can pass `pnpm test` and still commit a breach. What each command runs and leaves out is in
[scripts/README.md](../scripts/README.md).

`pnpm test:harness` is a tier of its own, outside `test:all`: it is the only check that sees a render, mount, CSP
or layout regression. Run it yourself after a webview change rather than finding out on push. The harness READMEs
cover the individual drivers.

`pnpm test:e2e` is outside `test:all` too, and CI runs it only on release tags.

Every vitest config and suite runs from any working directory; includes and fixture paths are anchored to their own
file. Keep it that way.

## Coverage thresholds

Per-package vitest coverage thresholds reflect the slice of behaviour each package's unit tests are responsible
for, not the package's full execution surface. The values, and each package's exclusions, live in that package's
own vitest config (`coverage.thresholds`). Some packages run intentionally low floors because another layer - a
grammar corpus, a fixture-driven integration suite, a corpus differential - verifies most of their behaviour; each
config says which layer.

Floors are round percentages set a point or two under the measured actuals, not the actuals themselves: a floor
pinned to the exact current figure goes red the first time a refactor shifts a ratio by a fraction, which trains
everyone to edit the number rather than read it. Ratchet upward only on deliberate coverage work - a widened unit
slice, a newly covered path - never as a reflex after an unrelated change moved the figure.

Stryker mutates only the files listed under `mutate` in `stryker.conf.json`, and its thresholds live in the same
file. The reasoning behind that scope is in the header of `.github/workflows/mutation.yml`.

## CI

| Workflow              | Runs on                                      | Runs                                                                                                |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `build.yml`           | Every push and pull request; `vX.Y.Z` tags   | `pnpm test:all`, build, package; the release steps on a tag                                         |
| `harness.yml`         | Every push and pull request                  | `pnpm test:harness`                                                                                 |
| `codeql.yml`          | Pushes and pull requests to `master`; weekly | CodeQL static analysis                                                                              |
| `scorecard.yml`       | Pushes and pull requests to `master`; weekly | OpenSSF Scorecard                                                                                   |
| `mutation.yml`        | Weekly; manual dispatch                      | `pnpm test:mutation`                                                                                |
| `test-node-next.yml`  | Weekly; manual dispatch                      | `pnpm test:all` on the Node "Current" line                                                          |
| `publish-library.yml` | `<lib>/vX.Y.Z` tags                          | Build and publish one library, after its test suite where it has one ([releasing.md](releasing.md)) |

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
| `*.pro.json` snapshot shape                                 | the committed snapshots under `client/testFixture/proto/`              |
| `*.{map,itm,spl,eff,cre,dlg}.json` snapshot shape           | nothing - no committed snapshot pins it                                |

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
