# Changelog

Notable changes to `@bgforge/ssl` (the compiler library and the `ssl` CLI).

## 0.1.0

First release.

- **Compiles Fallout SSL to INT bytecode** byte-identical to the reference `sslc` at `-O0`, `-O1` and `-O2`,
  across every script in the modding corpora this project tests against. No external compiler is involved.
- **The reference compiler's switches**, so a build script written for `sslc` can call `ssl` instead. The
  deliberate differences are listed in the README.
- **`-x` / `--decompile` and `-X` / `--listing`** read a compiled script back as source or as an
  instruction listing.
- **`-j<n>`** compiles several inputs at once, with output in input order.
- **A library** for the same pipeline: preprocessor, parser, optimiser, INT emitter and decompiler.
