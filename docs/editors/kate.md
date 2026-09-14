# Kate

Setup guide for using BGforge MLS with Kate (KDE text editor).

- [Prerequisites](#prerequisites)
- [Syntax highlighting](#syntax-highlighting)
- [Language server](#language-server)
- [File icons](#file-icons)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

Requires Kate 25.08+ for settings support. Older versions (21.12+) provide basic LSP features but cannot pass settings to the server.

## Syntax highlighting

Download `bgforge-mls-kate-<version>.zip` from the [latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases) and extract the `.xml` files to:

- **Linux**: `~/.local/share/org.kde.syntax-highlighting/syntax/`
- **Windows**: `%USERPROFILE%\AppData\Local\org.kde.syntax-highlighting\syntax\`
- **macOS**: `~/Library/Application Support/org.kde.syntax-highlighting/syntax/`

Restart Kate after installing. The definitions provide keyword, function, and constant highlighting plus code
folding. The zip also includes definitions for Fallout MSG (`.msg`), WeiDU TRA (`.tra`), Infinity 2DA (`.2da`),
Fallout scripts.lst (`scripts.lst`) and Fallout Worldmap (`worldmap.txt`).

Note: `.h` files default to C++ in Kate. Use `Tools > Highlighting > Fallout SSL` manually for Fallout header files.

## Language server

Enable the built-in LSP Client plugin in `Settings > Configure Kate > Plugins > LSP Client`.

Add a server in `Settings > Configure Kate > LSP Client > User Server Settings`:

```json
{
  "servers": {
    "fallout-ssl": {
      "command": ["bgforge-mls-server", "--stdio"],
      "highlightingModeRegex": "^Fallout SSL$"
    },
    "weidu-baf": { "use": "fallout-ssl", "highlightingModeRegex": "^WeiDU BAF$" },
    "weidu-d": { "use": "fallout-ssl", "highlightingModeRegex": "^WeiDU D$" },
    "weidu-tp2": { "use": "fallout-ssl", "highlightingModeRegex": "^WeiDU TP2$" },
    "fallout-worldmap-txt": { "use": "fallout-ssl", "highlightingModeRegex": "^Fallout Worldmap$" },
    "fallout-msg": { "use": "fallout-ssl", "highlightingModeRegex": "^Fallout MSG$" },
    "weidu-tra": { "use": "fallout-ssl", "highlightingModeRegex": "^WeiDU TRA$" },
    "infinity-2da": { "use": "fallout-ssl", "highlightingModeRegex": "^Infinity 2DA$" },
    "fallout-scripts-lst": { "use": "fallout-ssl", "highlightingModeRegex": "^Fallout scripts\\.lst$" }
  }
}
```

Kate sends the key of the matching entry as the document's language ID, and the server dispatches on it, so each
language needs its own entry named after the server's language ID. `use` makes the other entries share the first
one's server process and configuration. The `highlightingModeRegex` values match the language names from the
installed KSyntaxHighlighting definitions.

Besides the scripting languages, the server answers for MSG and TRA (formatting, outline, folding, parse-error
diagnostics), 2DA (formatting, semantic tokens coloring each column) and `scripts.lst` (formatting). The bundle has
no Kate definitions for SLB, Sword Coast Stratagems SSL or `weidu.log`, which the server also serves.

The `Fallout Worldmap` and `Fallout scripts.lst` KSH definitions match `worldmap.txt` and `scripts.lst` by
filename.

## File icons

Kate draws file icons from the desktop icon theme via XDG MIME types - it has no per-filetype icon setting of its own. The Kate KSH zip (from [Syntax highlighting](#syntax-highlighting) above) includes a `mimetypes/` folder with shared-mime-info definitions and matching icons. Installing them adds the icons for all KDE/XDG apps (Dolphin too), not just Kate. Linux only:

```bash
# run from the extracted bgforge-mls-kate-<version> directory
install -Dm644 mimetypes/bgforge-mls.mime.xml ~/.local/share/mime/packages/bgforge-mls.mime.xml
update-mime-database ~/.local/share/mime

mkdir -p ~/.local/share/icons/hicolor/scalable/mimetypes
cp mimetypes/application-x-*.svg ~/.local/share/icons/hicolor/scalable/mimetypes/
gtk-update-icon-cache ~/.local/share/icons/hicolor 2>/dev/null || true
kbuildsycoca6 2>/dev/null || kbuildsycoca5 2>/dev/null || true
```

Restart Kate. Notes:

- `.ssl` and other common extensions can collide with MIME types other applications define. If the wrong type wins, raise the glob priority in `bgforge-mls.mime.xml` (`<glob pattern="*.ssl" weight="60"/>`) and re-run `update-mime-database`.
- `.h` and `.d` are intentionally excluded (they collide with C headers and the D language).
- WeiDU BAF (`.baf`) and TP2 (`.tp2`) ship no scalable icon (their assets are raster-only) and keep the generic file icon.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

Kate sends settings via `workspace/configuration` (requires Kate 25.08+). Add them to the first server entry - the
ones with `use` read its settings:

```json
{
  "servers": {
    "fallout-ssl": {
      "command": ["bgforge-mls-server", "--stdio"],
      "highlightingModeRegex": "^Fallout SSL$",
      "settings": {
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
    }
  }
}
```

On older Kate versions, the server falls back to built-in defaults.

See [Settings Reference](../settings.md) for all available options.
