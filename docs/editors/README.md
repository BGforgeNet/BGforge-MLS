<!-- Editor setup guides index -->

# Editor Setup

- [Emacs](emacs.md)
- [Geany](geany.md)
- [Helix](helix.md)
- [JetBrains](jetbrains.md)
- [Kate](kate.md)
- [Neovim](neovim.md)
- [Notepad++](notepadpp.md)
- [Sublime Text](sublime-text.md)
- [Zed](zed.md)
- [TypeScript Plugins](typescript-plugins.md)

## Without a language server

In an editor whose LSP client cannot run the server, or in a build script, the command-line tools give the same
checks:

- `fgfmt <file|dir> --check` ([`@bgforge/format`](../../format/README.md)): exits 1 if a file is not formatted;
  `--save` formats it.
- `ssl <file.ssl>` ([`@bgforge/ssl`](../../compilers/ssl/README.md)): compiles a Fallout script and reports its
  errors.
- `tssl` ([`@bgforge/tssl`](../../compilers/tssl/README.md)) and `fgtp`
  ([`@bgforge/transpile`](../../transpilers/README.md)): compile TSSL and transpile TD and TBAF; `--check` exits 1 if
  an output is out of date.
