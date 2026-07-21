# Changelog

Notable changes to `@bgforge/transpile` (the library and the `fgtp` CLI).

## Unreleased

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
