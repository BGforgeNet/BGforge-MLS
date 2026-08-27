## Theme

BGforge MLS contributes a custom icon theme with support for various weidu types.

_([How to change icon theme in VScode](https://code.visualstudio.com/docs/getstarted/themes#_selecting-the-file-icon-theme).)_

### Default icon theme

![default monokai example](./icons-monokai.png)

### BGforge icon theme

![bgforge monokai example](./icons-bgforge_monokai.png)

### Which icons other themes show

Source files carry their icon on the language itself, so `.ssl`, `.baf`, `.d`, `.tp2`, `.tra`, `.msg` and
`.2da` keep it under whichever file icon theme you use.

The compiled and binary formats - `.bcs`, `.bs`, `.dlg`, `.int`, `.pro`, `.map`, `.itm`, `.spl`, `.eff`,
`.cre`, `.frm`, `.bam` - are not text in any language, so they have no language to hang an icon on and are
mapped by the BGforge icon theme instead. Under another theme they fall back to that theme's generic file
icon. Selecting the BGforge icon theme is what gives them their own.
