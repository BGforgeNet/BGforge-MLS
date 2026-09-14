# Sublime Text

Setup guide for using BGforge MLS with Sublime Text.

- [Prerequisites](#prerequisites)
- [File types and syntax highlighting](#file-types-and-syntax-highlighting)
- [Language server](#language-server)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

Install the [LSP](https://packagecontrol.io/packages/LSP) package via Package Control.

## File types and syntax highlighting

The release's `bgforge-mls-<version>.tmbundle.zip` carries the grammars as `.tmLanguage.json` files. Sublime Text's
[syntax documentation](https://www.sublimetext.com/docs/syntax.html) names `.sublime-syntax` and `.tmLanguage` as
the formats it reads and does not list the JSON form. None of the bundled grammars declares file extensions either,
so they provide no file type detection.

File types come from `.sublime-syntax` files: `file_extensions` associates extensions with the syntax, and `scope`
is what the LSP `selector` below matches. Create one per language in `Packages/User/` (accessible via
`Preferences > Browse Packages...`). This minimal form carries no highlighting rules:

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

Repeat for each language, keeping the scope names as written: the LSP package derives the language ID the server
dispatches on from the scope's second dot-separated part (`fallout-ssl`).

| `name`              | `scope`                       | `file_extensions`      |
| ------------------- | ----------------------------- | ---------------------- |
| WeiDU BAF           | `source.weidu-baf`            | `[baf]`                |
| WeiDU D             | `source.weidu-d`              | `[d]`                  |
| WeiDU TP2           | `source.weidu-tp2`            | `[tp2, tpa, tph, tpp]` |
| WeiDU SLB           | `source.weidu-slb`            | `[slb]`                |
| Fallout Worldmap    | `source.fallout-worldmap-txt` | none                   |
| Fallout MSG         | `source.fallout-msg`          | `[msg]`                |
| WeiDU TRA           | `source.weidu-tra`            | `[tra]`                |
| Infinity 2DA        | `source.infinity-2da`         | `[2da]`                |
| Fallout scripts.lst | `source.fallout-scripts-lst`  | none                   |
| WeiDU log           | `source.weidu-log`            | none                   |

Besides the scripting languages, the server answers for MSG and TRA (formatting, outline, folding, parse-error
diagnostics), 2DA (formatting, semantic tokens coloring each column), `scripts.lst` (formatting) and `weidu.log`
(go-to-definition from a mod entry to its `.tp2`). SLB is served as WeiDU BAF. So is Sword Coast Stratagems SSL
(scope `source.weidu-ssl`), which shares the `.ssl` extension with Fallout SSL - give its syntax no
`file_extensions` and select it per file.

For `worldmap.txt`, `scripts.lst` and `weidu.log`, select the syntax manually from `View > Syntax`, since
`file_extensions` matches extensions, not file names.

Note: `.h` files default to C in Sublime Text. The config above overrides this globally. Remove `h` from the list if you also work with C headers.

## Language server

Open `Preferences > Package Settings > LSP > Settings` and add:

```json
{
  "clients": {
    "bgforge-mls": {
      "enabled": true,
      "command": ["bgforge-mls-server", "--stdio"],
      "selector": "source.fallout-ssl | source.weidu-baf | source.weidu-tp2 | source.weidu-d | source.weidu-slb | source.weidu-ssl | source.fallout-worldmap-txt | source.fallout-msg | source.weidu-tra | source.infinity-2da | source.fallout-scripts-lst | source.weidu-log"
    }
  }
}
```

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside
tsserver ([TypeScript Plugins](typescript-plugins.md) describes what they do). In Sublime Text they load through the
[LSP-typescript](https://packagecontrol.io/packages/LSP-typescript) package, whose server passes plugins from its
initialization options to tsserver.

1. Install LSP-typescript via Package Control.
2. Open a `.tssl` file and choose `View > Syntax > Open all with current extension as... > TypeScript`; repeat for a
   `.td` file.
3. Open `Preferences > Package Settings > LSP > Servers > LSP-typescript` and add to your user settings, replacing
   `<mls-node-modules>` with the `node_modules` directory holding `@bgforge/mls-server`. LSP merges this object into
   the default `initialization_options`, so the other default keys stay:

```json
{
  "initialization_options": {
    "plugins": [
      { "name": "@bgforge/mls-server/out/tssl-plugin", "location": "<mls-node-modules>" },
      { "name": "@bgforge/mls-server/out/td-plugin", "location": "<mls-node-modules>" }
    ]
  }
}
```

`name` must be a package path as above: tsserver refuses a plugin named by an absolute path.
`pnpm ls -g --parseable` lists that package as `<mls-node-modules>/@bgforge/mls-server`.

## Settings

Open `Preferences > Package Settings > LSP > Settings` and add settings under the client configuration:

```json
{
  "clients": {
    "bgforge-mls": {
      "enabled": true,
      "command": ["bgforge-mls-server", "--stdio"],
      "selector": "source.fallout-ssl | source.weidu-baf | source.weidu-tp2 | source.weidu-d | source.weidu-slb | source.weidu-ssl | source.fallout-worldmap-txt | source.fallout-msg | source.weidu-tra | source.infinity-2da | source.fallout-scripts-lst | source.weidu-log",
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
