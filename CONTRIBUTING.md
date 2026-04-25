# Contributing

## Quick Start

```bash
pnpm install
pnpm build            # Build client, server, test bundles, webviews (includes TS plugins + CLIs)
pnpm test             # Typecheck + lint + unit tests + coverage + transpiler samples + CLI tests + knip
pnpm watch:client     # Dev mode: rebuild on change
pnpm watch:server
```

**Note:** This project uses `pnpm` exclusively. Use `pnpm exec <command>` instead of `npx <command>`.

## Documentation

| Document                                                       | Contents                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                   | System overview, build pipeline, client/server/CLI structure, data pipeline, design decisions |
| [docs/lsp-api.md](docs/lsp-api.md)                             | Public LSP/client-server contract for third-party clients                                     |
| [server/INTERNALS.md](server/INTERNALS.md)                     | Server internals: provider registry, symbol system, data flow, tree-sitter integration        |
| [scripts/README.md](scripts/README.md)                         | Build and test scripts reference                                                              |
| [grammars/README.md](grammars/README.md)                       | Tree-sitter grammars: building, WASM, CJS patching                                            |
| [server/data/README.md](server/data/README.md)                 | YAML data format for completion/hover                                                         |
| [plugins/tssl-plugin/README.md](plugins/tssl-plugin/README.md) | TSSL tsserver plugin: TS6133 suppression, engine proc hover                                   |
| [plugins/td-plugin/README.md](plugins/td-plugin/README.md)     | TD tsserver plugin: runtime injection, completion filtering                                   |
| [docs/ignore-files.md](docs/ignore-files.md)                   | Ignore file reference (.gitignore, .vscodeignore, editorconfig, oxlint)                       |

## Project Structure

See [docs/architecture.md](docs/architecture.md) for full repository layout.

## API Documentation Rule

If a change affects what a client must send, can receive, or may rely on over LSP or the shared client/server protocol, update [docs/lsp-api.md](docs/lsp-api.md) in the same change.

This includes:

- new custom requests, notifications, commands, or payload fields
- changes to the meaning or encoding of existing request parameters
- behavior differences that third-party clients may need to opt into

Architecture-only docs are not enough for those cases. Document the wire-level contract and compatibility expectations explicitly.

## Debugging

Press F5 in VSCode to launch the Extension Development Host. Server attaches on port 6009.

Server logs: Output panel, "BGforge MLS" channel.

TS plugin logs: set `"typescript.tsserver.log": "verbose"` in settings, check Output panel under "TypeScript".

## Temporary Files

Keep transient test/build artifacts under the repo-level `tmp/` directory unless a tool specifically requires system temp storage.

Do not create temporary directories inside source or fixture trees such as `server/test/`, `cli/test/`, or `scripts/**`.

## Submitting Changes

1. Fork the repository on GitHub and clone your fork.
2. Create a topic branch off `master` (`git checkout -b fix/short-description`). Avoid committing directly to `master` on your fork.
3. Make your changes on the topic branch. Match the commit-message style visible in `git log` — one short imperative subject (no period), an optional body explaining the *why*. Don't reference the PR number, the development workflow, or AI tooling.
4. Run `pnpm test:all` before pushing; that runs the canonical full-verification target (build, typecheck, lint, unit/integration/grammar/external suites). PR review starts from a green run.
5. Push your branch to your fork and open a pull request against `BGforgeNet/BGforge-MLS:master`. Describe what changed and why; link any issues the PR closes.
6. Update `docs/changelog.md` for any user-facing change (new feature, bug fix, behavior change). Internal refactors and test additions do not earn changelog entries.

For changes that affect the LSP wire contract, also update `docs/lsp-api.md` per the rule above.
