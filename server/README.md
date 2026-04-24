# @bgforge/mls-server

Standalone LSP server for WeiDU languages, Fallout 2 SSL, and transpiled TSSL, TBAF, TD.

## Supported Languages

| Language         | Extensions                     | Features                                                                                                    |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Fallout SSL      | `.ssl`, `.h`                   | Completion, hover, signature, go-to-definition, formatting, symbols, workspace symbols, rename, inlay hints |
| WeiDU TP2        | `.tp2`, `.tpa`, `.tph`, `.tpp` | Completion, hover, go-to-definition, formatting, symbols, workspace symbols, rename, inlay hints            |
| WeiDU BAF        | `.baf`                         | Completion, hover, formatting, inlay hints                                                                  |
| WeiDU D          | `.d`                           | Completion, hover, go-to-definition, formatting, symbols, rename, JSDoc, inlay hints                        |
| Fallout worldmap | `worldmap.txt`                 | Completion, hover                                                                                           |

Aliases: SCS SSL (`.ssl`) and SLB (`.slb`) are treated as WeiDU BAF.

Transpiler support (TypeScript to target language): TSSL, TBAF, TD.

## Installation

```bash
npm install -g @bgforge/mls-server
```

## Usage

The server communicates over stdio:

```bash
bgforge-mls-server --stdio
```

[Settings Reference](../docs/settings.md) - All server settings with defaults.
[LSP API](../docs/lsp-api.md) - Public commands, custom requests, notifications, and third-party client integration notes.

See [Editor Setup](https://github.com/BGforgeNet/BGforge-MLS/blob/master/docs/editors/README.md) for editor-specific guides.

## Links

- [VSCode extension](https://marketplace.visualstudio.com/items?itemName=BGforge.bgforge-mls) (full-featured client)
- [Source code](https://github.com/BGforgeNet/BGforge-MLS)
- [Issue tracker](https://github.com/BGforgeNet/BGforge-MLS/issues)
- [Server Internals](INTERNALS.md) (provider registry, symbol system, data flow)
