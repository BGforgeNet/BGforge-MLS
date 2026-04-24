# Sublime Text

Setup guide for using BGforge MLS with Sublime Text.

- [Prerequisites](#prerequisites)
- [File types and syntax highlighting](#file-types-and-syntax-highlighting)
- [Language server](#language-server)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
npm install -g @bgforge/mls-server
```

Install the [LSP](https://packagecontrol.io/packages/LSP) package via Package Control.

## File types and syntax highlighting

Download `bgforge-mls.tmbundle.zip` from the [latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases), extract it, and copy the `.tmLanguage.json` files from `bgforge-mls.tmbundle/Syntaxes/` into `Packages/User/` (accessible via `Preferences > Browse Packages...`). Restart Sublime Text.

This provides both file type detection and syntax highlighting. If you only need LSP features without highlighting, create minimal `.sublime-syntax` stubs instead:

**`SSL.sublime-syntax`**:

```yaml
%YAML 1.2
---
name: Fallout SSL
file_extensions: [ssl, h]
scope: source.fallout-ssl
contexts:
    main: []
```

Repeat for each language (`weidu-baf`/`baf`, `weidu-d`/`d`, `weidu-tp2`/`tp2 tpa tph tpp`, `fallout-worldmap-txt`/no extension).

The tmbundle also includes highlight-only definitions (no LSP provider) for Fallout MSG (`.msg`), WeiDU TRA (`.tra`), Infinity 2DA (`.2da`), and Fallout scripts.lst.

For `worldmap.txt`, use `View > Syntax > Fallout Worldmap` manually since syntax files match by extension, not filename.

Note: `.h` files default to C in Sublime Text. The config above overrides this globally. Remove `h` from the list if you also work with C headers.

## Language server

Open `Preferences > Package Settings > LSP > Settings` and add:

```json
{
    "clients": {
        "bgforge-mls": {
            "enabled": true,
            "command": ["bgforge-mls-server", "--stdio"],
            "selector": "source.fallout-ssl | source.weidu-baf | source.weidu-tp2 | source.weidu-d | source.fallout-worldmap-txt"
        }
    }
}
```

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

Open `Preferences > Package Settings > LSP > Settings` and add settings under the client configuration:

```json
{
    "clients": {
        "bgforge-mls": {
            "enabled": true,
            "command": ["bgforge-mls-server", "--stdio"],
            "selector": "source.fallout-ssl | source.weidu-baf | source.weidu-tp2 | source.weidu-d | source.fallout-worldmap-txt",
            "settings": {
                "bgforge.validate": "saveAndType",
                "bgforge.falloutSSL.compilePath": "",
                "bgforge.falloutSSL.compileOptions": "-q -p -l -O2 -d -s -n",
                "bgforge.falloutSSL.outputDirectory": "",
                "bgforge.falloutSSL.headersDirectory": "",
                "bgforge.weidu.path": "weidu",
                "bgforge.weidu.gamePath": ""
            }
        }
    }
}
```

See [Settings Reference](../settings.md) for all available options.
