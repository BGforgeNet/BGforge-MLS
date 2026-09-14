# JetBrains IDEs

Setup guide for using BGforge MLS with JetBrains IDEs (IntelliJ IDEA, WebStorm, CLion, etc.).

- [Prerequisites](#prerequisites)
- [Language server](#language-server)
- [Syntax highlighting](#syntax-highlighting)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

Install [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) from the JetBrains Marketplace.

## Language server

Go to `Settings > Languages & Frameworks > Language Servers` and add a new server:

- **Name**: BGforge MLS
- **Command**: `bgforge-mls-server --stdio`

In its **Mappings** tab, add a file name pattern for each format, with the **Language ID** set as below. The server
dispatches on the language ID, so set it on every mapping.

| File name pattern                  | Language ID            |
| ---------------------------------- | ---------------------- |
| `*.ssl`, `*.h`                     | `fallout-ssl`          |
| `*.baf`                            | `weidu-baf`            |
| `*.d`                              | `weidu-d`              |
| `*.tp2`, `*.tpa`, `*.tph`, `*.tpp` | `weidu-tp2`            |
| `*.slb`                            | `weidu-slb`            |
| `worldmap.txt`                     | `fallout-worldmap-txt` |
| `*.msg`                            | `fallout-msg`          |
| `*.tra`                            | `weidu-tra`            |
| `*.2da`                            | `infinity-2da`         |
| `scripts.lst`                      | `fallout-scripts-lst`  |
| `weidu.log`                        | `weidu-log`            |

Besides the scripting languages, the server answers for MSG and TRA (formatting, outline, folding, parse-error
diagnostics), 2DA (formatting, semantic tokens coloring each column), `scripts.lst` (formatting) and `weidu.log`
(go-to-definition from a mod entry to its `.tp2`). SLB is served as WeiDU BAF. So is Sword Coast Stratagems SSL
(language ID `weidu-ssl`), which shares the `.ssl` extension with Fallout SSL - map it per project rather than
globally.

## Syntax highlighting

Download `bgforge-mls-<version>.tmbundle.zip` from the
[latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases), extract it, then:

1. Go to `Settings > Editor > TextMate Bundles`
2. Click `+` and point to the extracted `bgforge-mls.tmbundle` directory

The tmbundle includes grammars for Fallout SSL, WeiDU BAF, WeiDU D and WeiDU TP2, plus Fallout MSG, WeiDU TRA,
Infinity 2DA, Fallout Worldmap, Fallout scripts.lst, WeiDU SLB, Sword Coast Stratagems SSL and WeiDU log.

None of the bundled grammars declares file extensions, so installing the bundle maps no files to them; associate
extensions with the grammars manually.

Note: `.h` is also the C and C++ header extension, and the `*.h` mapping above associates every `.h` file with the
server, C headers included. Leave `*.h` out of the mapping if that is unwanted.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. JetBrains IDEs with TypeScript support (WebStorm, IntelliJ Ultimate) use their own TypeScript service, which reads `tsconfig.json` plugins. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

BGforge MLS uses `workspace/configuration`. Paste the JSON into the **Configuration** tab (not Initialization Options) at `Settings > Languages & Frameworks > Language Servers > BGforge MLS`:

```json
{
  "bgforge": {
    "validate": "saveAndType",
    "falloutSSL": {
      "compilePath": "",
      "compileOptions": "-q -p -l -O2 -d -s -n",
      "outputDirectory": "",
      "headersDirectory": ""
    },
    "weidu": {
      "path": "weidu",
      "gamePath": ""
    }
  }
}
```

See [Settings Reference](../settings.md) for all available options.
