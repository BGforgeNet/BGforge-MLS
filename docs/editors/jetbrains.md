# JetBrains IDEs

Setup guide for using BGforge MLS with JetBrains IDEs (IntelliJ IDEA, WebStorm, CLion, etc.).

- [Prerequisites](#prerequisites)
- [Language server](#language-server)
- [Syntax highlighting](#syntax-highlighting)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
npm install -g @bgforge/mls-server
```

Install [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) from the JetBrains Marketplace.

## Language server

Go to `Settings > Languages & Frameworks > Language Servers` and add a new server:

- **Name**: BGforge MLS
- **Command**: `bgforge-mls-server --stdio`
- **File patterns**: `*.ssl`, `*.h`, `*.baf`, `*.d`, `*.tp2`, `*.tpa`, `*.tph`, `*.tpp`, `worldmap.txt`

## Syntax highlighting

Download `bgforge-mls.tmbundle.zip` from the [latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases), extract it, then:

1. Go to `Settings > Editor > TextMate Bundles`
2. Click `+` and point to the extracted `bgforge-mls.tmbundle` directory

The tmbundle also includes highlight-only definitions (no LSP provider) for Fallout MSG (`.msg`), WeiDU TRA (`.tra`), Infinity 2DA (`.2da`), and Fallout scripts.lst.

Note: `.h` files default to C in JetBrains IDEs. The config above overrides this globally. For per-project control, use `Settings > Editor > File Types`.

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
