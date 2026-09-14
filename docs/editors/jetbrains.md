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

Note: `.h` is also the C and C++ header extension. The `*.h` mapping above matches by file name alone, so it sends
every `.h` file to the server, C headers included - leave `*.h` out of the mapping if that is unwanted. The mapping
does not change a file's IDE file type. A TextMate grammar highlights only files whose name matches no IDE file type
other than plain text, so where `Settings > Editor > File Types` lists `*.h` under another file type, `.h` files keep
that type and its highlighting whatever TextMate association you make. Remove `*.h` from that file type for the
association to take effect; the change applies IDE-wide.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside
tsserver ([TypeScript Plugins](typescript-plugins.md) describes what they do). They load through
`typescript-language-server` added as a second LSP4IJ server, which passes plugins from its initialization options to
tsserver:

1. Install it: `pnpm add -g typescript-language-server,typescript@6`
2. In `Settings > Languages & Frameworks > Language Servers`, add a server named `TypeScript (TSSL/TD)` with the
   command `typescript-language-server --stdio`
3. In its **Mappings** tab, add the file name patterns `*.tssl` and `*.td`, both with the Language ID `typescript`
4. In its **Configuration** tab (**Server** sub-tab), paste into **Initialization Options**, replacing
   `<mls-node-modules>` with the `node_modules` directory holding `@bgforge/mls-server`:

```json
{
  "plugins": [
    { "name": "@bgforge/mls-server/out/tssl-plugin", "location": "<mls-node-modules>" },
    { "name": "@bgforge/mls-server/out/td-plugin", "location": "<mls-node-modules>" }
  ]
}
```

`name` must be a package path as above: tsserver refuses a plugin named by an absolute path.
`pnpm ls -g --parseable` lists that package as `<mls-node-modules>/@bgforge/mls-server`.

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
