# Changelog

Notable changes to `@bgforge/transpile` (the library and the `fgtp` CLI).

## 0.3.0

### Fixed

- `fgtp --help` prints the help text once. It was registered with the argument parser and printed again
  by hand, so every invocation emitted two copies, the first with a stray colon appended.

### Removed

- **`.tssl` is no longer handled.** TSSL became a compiler in its own right and moved to
  [`@bgforge/tssl`](https://www.npmjs.com/package/@bgforge/tssl), which installs a `tssl` binary. Its
  default output is Fallout INT bytecode with no intermediate SSL; emitting the readable `.ssl` is an
  option (`tssl --transpile`) rather than the only thing it does, which is not a shape this CLI can
  express. `fgtp` now covers `.tbaf` and `.td`.

  Replace `fgtp src/ -r --save` with `tssl src/ -r --transpile` for TSSL sources, or drop `--transpile`
  to get bytecode directly.

  The library follows: `tssl`, `tsslWithSourceMap` and `createBatchState` are gone from
  `@bgforge/transpile`, `transpile()` no longer dispatches `.tssl`, and `outputPathFor()` no longer maps
  it.

## 0.2.1

Maintenance release.

## 0.2.0

### Added

- `fgtp --jobs <n>` processes directory files with `n` parallel workers. Output order matches the
  sequential walk; with `--check`, all files are checked before the exit code instead of stopping at
  the first mismatch.

## 0.1.2

### Fixed

- The TD transpiler now reports an error on a multi-variable `for` initializer during loop unrolling instead of silently keeping only the first variable.
- Multi-file transpiles no longer rely on a `node` binary on `PATH`; the bundler's child always runs on the current runtime.
- `quick-lru` is now a declared dependency, fixing standalone installs.

## 0.1.1

Maintenance release.

## 0.1.0

Initial release.
