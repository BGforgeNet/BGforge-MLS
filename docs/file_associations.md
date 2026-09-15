# File associations

Which language or editor VS Code uses for each file type BGforge MLS registers, and how to change it.

## Languages

### SSL

Both Star-Trek Scripting Language and Sword Coast Stratagems Scripting Language use files with extension `ssl`.
BGforge MLS defaults to Star-Trek Scripting Language (Fallout). If you need SCS Scripting Language instead, you can
[set file associations](https://code.visualstudio.com/docs/languages/overview#_change-the-language-for-the-selected-file)
in VScode settings:

```json
"files.associations": {
  "*.ssl": "weidu-ssl"
}
```

This can be set globally, or per project, so you can work on both types of projects simultaneously.

### H

The same method goes for `.h` headers of C++, if you use those:

```json
"files.associations": {
    "*.h": "cpp"
}
```

### D

`.d` is also the extension of the D programming language. If an extension for D is installed as well, it can
claim `.d` files too; pin the language you want:

```json
"files.associations": {
    "*.d": "weidu-d"
}
```

### TSSL, TBAF, TD

`.tssl`, `.tbaf` and `.td` are registered as `typescript`, so VS Code's TypeScript support edits them; the TSSL and
TD TypeScript plugins add their language-specific behaviour ([typescript-plugins.md](editors/typescript-plugins.md)).

## Custom editors

Some file types open in an editor of the extension's own instead of the text editor:

| Files                                          | Editor                       | Opens by default |
| ---------------------------------------------- | ---------------------------- | ---------------- |
| `.pro`, `.map`, `.itm`, `.spl`, `.eff`, `.cre` | BGforge Binary Editor        | Yes              |
| `.frm`, `.fr0`-`.fr5`, `.bam`, `.animset`      | BGforge Animation Editor     | Yes              |
| `.int`, `.bcs`, `.bs`                          | Compiled Script (decompiled) | Yes              |
| `.dlg`                                         | BGforge Dialog Viewer        | Yes              |
| `.d`, `.ssl`, `.td`, `.tssl`                   | BGforge Dialog Editor        | No               |

The dialog editor is an option beside the text editor: open it with `Ctrl+Shift+V` (**BGforge MLS: Dialog Editor**)
from a Fallout SSL, D, TSSL or TD file, or with **Open With...** in the Explorer context menu.

To open a file in the text editor instead, use **Open With...** or **View: Reopen Editor With...** and pick
**Text Editor**. To change which editor a pattern opens in by default, set `workbench.editorAssociations` - the text
editor's id is `default`, and the extension's editors are `bgforge.binaryEditor`, `bgforge.animationEditor`,
`bgforge.scriptEditor`, `bgforge.dlgViewer` and `bgforge.dialogEditor`:

```json
"workbench.editorAssociations": {
    "*.pro": "default",
    "*.d": "bgforge.dialogEditor"
}
```
