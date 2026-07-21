# Changelog

Notable changes to `@bgforge/format` (the library and the `fgfmt` CLI).

## Unreleased

### Added

- `fgfmt --jobs <n>` processes directory files with `n` parallel workers. Output order matches the
  sequential walk; with `--check`, all files are checked before the exit code instead of stopping at
  the first mismatch.

## 0.3.0

### Added

- The WeiDU TP2 formatter recognizes `DEFINE_DIMORPHIC_FUNCTION` definitions.

## 0.2.0

### Added

- The WeiDU TP2 formatter recognizes the `REQUIRE_FILE` / `FORBID_FILE` / `FORBID_PREDICATE` component flags.

### Fixed

- The WeiDU D formatter is now idempotent when a `~string~` immediately follows a keyword.
- Corrected the WeiDU TP2 formatter's keyword set (dropped keywords the grammar never matched).

## 0.1.1

Maintenance release.

## 0.1.0

Initial release.
