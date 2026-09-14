# Themes

BGforge MLS contributes a color theme and a file icon theme. Maintaining their sources:
[themes/README.md](../themes/README.md).

## Color theme

BGforge MLS contributes a custom Monokai-based theme: **"BGforge Monokai"**. It's tailored to provide more visual cues for Infinity Engine modders.

_([How to change theme in VScode](https://code.visualstudio.com/docs/getstarted/themes#_color-themes).)_

The theme is best used with [IElib](https://ielib.bgforge.net).

### Default Monokai

![default monokai example](./monokai.png)

### BGforge Monokai

![bgforge monokai example](./bgforge_monokai.png)

## Icon theme

BGforge MLS contributes a file icon theme, **"BGforge"**, with icons for the Fallout and Infinity Engine file types.

_([How to change icon theme in VScode](https://code.visualstudio.com/docs/configure/themes#_file-icon-themes).)_

### Default icon theme

![default icon theme example](./icons-monokai.png)

### BGforge icon theme

![bgforge icon theme example](./icons-bgforge_monokai.png)

### Which icons other themes show

Most languages the extension registers carry an icon, and VS Code shows a language's icon under another file icon
theme only when that theme has no icon of its own for the language, file extension or file name, has specific file
icons at all (Minimal does not), and does not set `showLanguageModeIcons` to `false`. `.tssl`, `.tbaf` and `.td`
register as `typescript` and carry no icon of their own.

The compiled and binary formats the extension opens in its custom editors are not text in any language, so they have
no language to hang an icon on and only the BGforge icon theme maps them. Under another theme the icon they get
depends on that theme's own mappings; selecting the BGforge icon theme is what gives them their own.
