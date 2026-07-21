# Documentation

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

Transpiler guides are in [`transpilers/`](../transpilers/) (TSSL, TBAF, TD -- each has a README, writing guide, and `llms.txt`).

## For Developers

| Document                                                         | Contents                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [lsp-api.md](lsp-api.md)                                         | Public LSP commands, custom requests, notifications, and integration notes |
| [architecture.md](architecture.md)                               | System overview, build pipeline, client/server/CLI structure, packaging    |
| [../server/INTERNALS.md](../server/INTERNALS.md)                 | Server internals: provider registry, symbol system, data flow, tree-sitter |
| [../CONTRIBUTING.md](../CONTRIBUTING.md)                         | Quick start, debugging, doc index                                          |
| [../scripts/README.md](../scripts/README.md)                     | Build and test scripts reference                                           |
| [ignore-files.md](ignore-files.md)                               | Ignore file reference (.gitignore, .vscodeignore, editorconfig, oxlint)    |
| [releasing.md](releasing.md)                                     | Tag-driven release procedures per stream (extension, libraries, Action)    |
| [data-pipeline.md](data-pipeline.md)                             | How engine data moves from external sources to runtime JSON and grammars   |
| [todo.md](todo.md)                                               | Roadmap / outstanding work                                                 |
| [binary-editor-ui-guidelines.md](binary-editor-ui-guidelines.md) | Binary editor UI conventions and review brief                              |
| [../binary/INTERNALS.md](../binary/INTERNALS.md)                 | Binary library internals: spec system, primitives, format adapters         |
| [dependencies.md](dependencies.md)                               | Pinned dependency version constraints and hold rationale                   |
