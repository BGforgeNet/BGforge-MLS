# Documentation

The index of every document in the repo. Start here.

That first sentence is a promise, not a description: `scripts/utils/test/doc-index-complete.test.ts` fails on any
tracked `*.md` not listed below, not under a directory listed below, and not in the test's exclusion map.

## For Users

| Document                                                       | Contents                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [settings.md](settings.md)                                     | All extension/server settings with defaults and per-editor examples                    |
| [editors/](editors/)                                           | Setup guides for Neovim, Emacs, Helix, Zed, Kate, Sublime, JetBrains, Geany, Notepad++ |
| [editors/typescript-plugins.md](editors/typescript-plugins.md) | TSSL/TD TypeScript plugin setup (all editors)                                          |
| [file_associations.md](file_associations.md)                   | VSCode file association configuration                                                  |
| [theme.md](theme.md)                                           | Syntax theme documentation                                                             |
| [icon-theme.md](icon-theme.md)                                 | Icon theme setup                                                                       |
| [changelog.md](changelog.md)                                   | Release changelog                                                                      |
| [../SECURITY.md](../SECURITY.md)                               | How to report a security vulnerability                                                 |

## For Developers

| Document                                         | Contents                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [development.md](development.md)                 | Quick start, verification tiers, public surfaces, debugging                |
| [architecture.md](architecture.md)               | System overview, build pipeline, client/server/CLI structure, packaging    |
| [lsp-api.md](lsp-api.md)                         | Public LSP commands, custom requests, notifications, and integration notes |
| [../server/INTERNALS.md](../server/INTERNALS.md) | Server internals: provider registry, symbol system, data flow, tree-sitter |
| [../binary/INTERNALS.md](../binary/INTERNALS.md) | Binary library internals: spec system, primitives, format adapters         |
| [data-pipeline.md](data-pipeline.md)             | How engine data moves from external sources to runtime JSON and grammars   |
| [todo.md](todo.md)                               | Roadmap / outstanding work                                                 |

## Languages and compilers

| Document                                                             | Contents                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [../compilers/README.md](../compilers/README.md)                     | What each compiler is and how they relate                          |
| [../compilers/ssl/README.md](../compilers/ssl/README.md)             | Fallout SSL -> INT compiler; ships the `ssl` CLI                   |
| [../compilers/tssl/README.md](../compilers/tssl/README.md)           | TypeScript -> INT compiler, the `tssl` CLI, and the folib contract |
| [../compilers/tssl/docs/](../compilers/tssl/docs/)                   | TSSL user guide, writing guide, and `llms.txt`                     |
| [../compilers/bcs/README.md](../compilers/bcs/README.md)             | Infinity Engine BCS codec and BAF compiler (library only, no CLI)  |
| [../transpilers/README.md](../transpilers/README.md)                 | Transpile library and the `fgtp` CLI                               |
| [../transpilers/tbaf/docs/](../transpilers/tbaf/docs/)               | TBAF -> BAF user guide, writing guide, and `llms.txt`              |
| [../transpilers/td/docs/](../transpilers/td/docs/)                   | TD -> D user guide, writing guide, and `llms.txt`                  |
| [../plugins/tssl-plugin/README.md](../plugins/tssl-plugin/README.md) | TSSL tsserver plugin source                                        |
| [../plugins/td-plugin/README.md](../plugins/td-plugin/README.md)     | TD tsserver plugin source                                          |

## Libraries and packages

| Document                                   | Contents                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| [../server/README.md](../server/README.md) | The server as a published npm package                                        |
| [../binary/README.md](../binary/README.md) | Binary library and the `fgbin` CLI (Fallout PRO/MAP, IE ITM/SPL/EFF/CRE/DLG) |
| [../format/README.md](../format/README.md) | Formatter library and the `fgfmt` CLI                                        |
| [../image/README.md](../image/README.md)   | Animation library: FRM/BAM codecs, conversions, PNG/APNG import/export       |
| [binary-editor-ui.md](binary-editor-ui.md) | Binary editor UI: layout schema, render layer, screenshot review brief       |

## Test harnesses

| Document                                                                                                 | Contents                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [../binary-editor/test/harness/README.md](../binary-editor/test/harness/README.md)                       | Binary-editor webview render harness and its drivers |
| [../binary-editor/test/fixtures/README.md](../binary-editor/test/fixtures/README.md)                     | Where the binary-editor fixtures come from           |
| [../client/src/dialog-editor/test/harness/README.md](../client/src/dialog-editor/test/harness/README.md) | Dialog-editor webview harness                        |

## Data, grammars, and assets

| Document                                                                     | Contents                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| [../server/data/README.md](../server/data/README.md)                         | YAML engine-data format for completion and hover       |
| [../grammars/README.md](../grammars/README.md)                               | Tree-sitter grammars: building, WASM, type generation  |
| [../grammars/](../grammars/)                                                 | Per-grammar `README.md` and `formatter.md`, one each   |
| [../binary/data/README.md](../binary/data/README.md)                         | Generated IE opcode and structure data                 |
| [../syntaxes/README.md](../syntaxes/README.md)                               | TextMate grammars (YAML source, compiled JSON)         |
| [../themes/README.md](../themes/README.md)                                   | Color and icon theme sources                           |
| [../language-configurations/README.md](../language-configurations/README.md) | Brackets, comments, and indentation rules per language |

## Build, release, and CI

| Document                                       | Contents                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [../scripts/README.md](../scripts/README.md)   | Build and test scripts reference                                                                                                                     |
| [../scripts/dev-web.md](../scripts/dev-web.md) | Running the extension in code-server (`pnpm dev:web`)                                                                                                |
| [releasing.md](releasing.md)                   | Tag-driven release procedures per stream (extension, libraries, Action)                                                                              |
| [dependencies.md](dependencies.md)             | Pinned dependency version constraints and hold rationale                                                                                             |
| [ignore-files.md](ignore-files.md)             | What ships in the VSIX, the oxfmt/oxlint exclusion asymmetry, and lint rules measured and rejected                                                   |
| [supply-chain.md](supply-chain.md)             | SBOM/SLSA provenance, CodeQL + Scorecard, and two deliberate non-additions                                                                           |
| [../actions/README.md](../actions/README.md)   | Reusable composite GitHub Actions: shared contract, plus one README each                                                                             |
| [../actions/](../actions/)                     | The per-Action READMEs, and `development.md` for changing them                                                                                       |
| Per-package changelogs                         | [binary](../binary/CHANGELOG.md), [format](../format/CHANGELOG.md), [tssl](../compilers/tssl/CHANGELOG.md), [transpile](../transpilers/CHANGELOG.md) |
