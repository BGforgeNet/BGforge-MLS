# Changelog

Notable changes to `@bgforge/format` (the library and the `fgfmt` CLI).

## 0.6.0

### Added

- `fgfmt` formats Fallout SSL it used to report as a syntax error: a character constant (`'A'`, `'\n'`,
  `'\0101'`), `foreach ... while` written without parentheses, a timed or guarded procedure
  (`procedure foo in 5`, `procedure foo when (cond)`), stepping into a computed element (`a[i + 1]++`),
  a ternary in a variable initialiser (`variable v := 1 if c else 2`), and a trailing comma after the
  last parameter.
- `fgfmt` formats Fallout SSL it used to refuse after formatting, when the whitespace-only check caught
  the output no longer matching the input: a keyword spelled any way but lowercase (`Procedure`, `IF`,
  `Begin`), a bare block inside a procedure, a `foreach` whose `while` guard sits inside the parentheses,
  and `variable i := 0` in a `for` header, which was rewritten to `= 0`. `critical` and `pure` in a
  procedure header were each pushed onto a line of their own instead of staying in it.
- WeiDU BAF IDS names containing a hyphen - `KUO-TOA`, `YUAN-TI`, `WILL-O-WISP` - are formatted rather
  than reported as a syntax error.

### Changed

- The Fallout SSL formatter writes keywords in the project's canonical spelling - lowercase, except the
  short-circuit operators `orElse` and `andAlso` - rather than whichever spelling the source used. The
  grammar matches them case-insensitively, so every spelling is legal input. Keywords inside a `#define`
  body are left as written, along with the rest of the macro.
- Because of that, `validateFormatting` needs a normaliser that folds keyword case to check an SSL file,
  exported as `stripCommentsForCompareFalloutSsl`. Pass it in place of `stripCommentsFalloutSsl`, which
  still strips comments and nothing else.
- Helpers shaped by the tree-sitter grammars moved to a second entry point, `@bgforge/format/internal`:
  `scanTildeDelimiter`, the comment normalisers, the TP2 formatting defaults and keyword constants, and
  the TP2 node predicates. Importing one of those needs the `/internal` path now. The main entry point
  keeps the formatters, the format-and-validate pipeline and editorconfig discovery, and is the only
  surface the version number speaks for - `/internal` follows the grammars and can change in any release.
- `CommentStripper` is now `CompareNormalizer`, after what `validateFormatting` does with it: reduce a
  file to the content formatting has to preserve. Every language drops comments there; Fallout SSL also
  folds keyword case, since its formatter canonicalises keyword spelling.
- `fgfmt` reports a formatter bug as `left unchanged - formatter bug: ...`, since the file is not written
  when the whitespace-only check fails.

### Fixed

- A procedure called through a string name - `"node_1"(1)`, which the engine resolves at run time - is
  laid out as one call. It parsed as a string followed by a parenthesised expression, so the two landed
  on separate lines.

### Removed

- The WeiDU tokeniser - `tokenizeWeidu`, `normalizeWhitespaceWeidu`, `WeiduTokenType` and the
  `WeiduToken` type. It is used only to build the formatters this package already exposes.

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
