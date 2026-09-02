# Changelog

Notable changes to `@bgforge/tssl` (the compiler library and the `tssl` CLI).

## 0.2.0

### Added

- `tssl --no-int` skips the bytecode, so `--ssl --no-int` writes the readable `.ssl` alone - for a tree
  that commits the SSL and has no use for the `.int`. Passing it without `--ssl` is an error, since the
  run would write nothing. `--opt` and `-s` steer the bytecode emitter it skips, so passing either
  alongside warns and carries on rather than failing the run.

### Changed

- **`--transpile` is now `--ssl`.** The old spelling is gone rather than aliased. The two output switches
  now name their outputs: `--ssl` adds the `.ssl` (off by default) and `--no-int` drops the `.int` (written
  by default), which also gives the SSL-only combination a spelling the old flag could not express.

  The `actions/tssl` inputs follow: `transpile: "true"` becomes `ssl: "true"`, and the new `int` input
  (default `true`) turns the bytecode off. With `int: "false"` the action drops the `opt` and
  `short-circuit` inputs, reporting that it did, since neither reaches an emitter that does not run.

- `types` is pinned empty, so the compile no longer discovers and binds every `@types/*` package reachable
  from the entry file. Ambient declarations from an installed `@types` package are no longer in scope in a
  `.tssl`, and a compile in a project that has them does less work.

## 0.1.0

First release.

- **Compiles TSSL to Fallout INT bytecode.** `tssl script.tssl` writes `script.int` - the TypeScript
  source becomes the compiler's IR directly, with no SSL text and no external compiler involved.
- **`--transpile`** also writes the readable `.ssl`, checked against a real corpus to compile to the same
  bytes.
- **`--opt <0|1|2>` and `-s`** select the optimisation level and short-circuit `and`/`or`.
- **`--check`** reports stale or missing output instead of writing it, and exits non-zero.
- **Syntax with no SSL equivalent is refused with its line**, never guessed at or copied through.

TSSL previously lived in `@bgforge/transpile` as one of the `fgtp` CLI's source types, emitting SSL text
only. Replace `fgtp src/ -r --save` with `tssl src/ -r --transpile`, or drop `--transpile` to get the
bytecode directly.
