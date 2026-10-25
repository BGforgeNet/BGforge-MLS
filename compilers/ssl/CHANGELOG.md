# Changelog

Notable changes to `@bgforge/ssl` (the compiler library and the `ssl` CLI).

## 0.2.0

- Compiles `call ... when`, `import` and `export` procedures and blocks, and `export variable` blocks as the
  reference does, and keeps the backslashes of a raw string `@"..."`.
- Drops an unused imported procedure at `-O1` and above.
- Parses the remaining forms the reference accepts: `for` without parentheses, `0X` hex, `5.`, variadic macros,
  an `else` after a macro that opens an `if`. A form it cannot yet emit is refused rather than compiled as a
  plain look-alike.
- A keyword is never read as a name, as in the reference; a macro may still name itself or a parameter like a
  keyword. `in` is no longer an operator.
- A half-typed parameter list, array, map or `begin` is reported as the missing token, not as a syntax error.
- `-x` decompiles `drop_obj`, `gSay_Option`, `gSay_Reply`, `move_obj_inven_to_obj` and `play_sfx` as
  statements: they return nothing.

## 0.1.1

No changes to the library or the CLI; the first version published through npm trusted publishing.

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
