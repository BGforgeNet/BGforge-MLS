# Changelog

Notable changes to `@bgforge/tssl` (the compiler library and the `tssl` CLI).

## 0.1.0

First release.

- **Compiles TSSL to Fallout INT bytecode.** `tssl script.tssl` writes `script.int`. The TypeScript
  source becomes the compiler's intermediate representation directly - no SSL text is produced or read
  on the way, and no external compiler is involved.
- **`--transpile` also writes the readable `.ssl`**, for a mod that still ships generated SSL or an
  author who wants to read what a script became. It is checked against a real corpus, at every
  optimisation level and with short-circuiting both ways, to compile to the same bytes the compiler
  wrote directly.
- **`--opt <0|1|2>` and `-s`** select the optimisation level and short-circuit evaluation of `and`/`or`.
- **`--check`** reports stale or missing output instead of writing it, and exits non-zero.

TSSL previously lived in `@bgforge/transpile` as one of the `fgtp` CLI's source types, emitting SSL text
only. Replace `fgtp src/ -r --save` with `tssl src/ -r --transpile`, or drop `--transpile` to get the
bytecode directly.
