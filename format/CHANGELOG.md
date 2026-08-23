# Changelog

Notable changes to `@bgforge/format` (the library and the `fgfmt` CLI).

## Unreleased

### Changed

- Helpers shaped by the tree-sitter grammars moved to a second entry point, `@bgforge/format/internal`:
  `scanTildeDelimiter`, the comment normalisers, the TP2 formatting defaults and keyword constants, and
  the TP2 node predicates. Importing one of those needs the `/internal` path now. The main entry point
  keeps the formatters, the format-and-validate pipeline and editorconfig discovery, and is the only
  surface the version number speaks for - `/internal` follows the grammars and can change in any release.
- `CommentStripper` is now `CompareNormalizer`, after what `validateFormatting` does with it: reduce a
  file to the content formatting has to preserve. Every language drops comments there; Fallout SSL also
  folds keyword case, since its formatter canonicalises keyword spelling.

### Removed

- The WeiDU tokeniser - `tokenizeWeidu`, `normalizeWhitespaceWeidu`, `WeiduTokenType` and the
  `WeiduToken` type. It is used only to build the formatters this package already exposes.
- `keywordText`, which returned a keyword spelled as the source spelled it. No formatter needs it: the
  Fallout SSL formatter canonicalises keyword spelling instead, and every other grammar accepts exactly
  one spelling, so the lookup could only ever return what it was given.

## 0.5.0

### Added

- The WeiDU TP2 formatter recognizes `QUICK_MENU` and lays its groups out one component per line.
- `fgfmt` formats TP2 constructs it previously reported as syntax errors, including `ALTER_TLK_LIST`,
  `PATCH_BASH_FOR`, `APPEND_COL_OUTER`, `COPY_LARGE` with several file pairs, the `COMPRESS_INTO_*` /
  `DECOMPRESS_INTO_*` patches, `MENU_STYLE`, `LOAD`, and the `FORCED_SUBCOMPONENT` / `METADATA` /
  `NO_LOG_RECORD` / `INSTALL_BY_DEFAULT` component flags.
- Function, macro and parameter names that start with a digit (`STR_VAR 2da = ~~`) are formatted rather
  than skipped.

### Fixed

- Comments on the operands of a multi-line condition are no longer dropped, and such a condition is no
  longer rewrapped differently on each run.
- A comment between the file pairs of a `COPY` header no longer flips the rest of the header into patch
  layout, which moved content on every run.
- No stray double space before `BEGIN` on `ACTION_BASH_FOR`, `PATCH_BASH_FOR` and `PHP_EACH` loops.

## 0.4.0

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
