# Changelog

Notable changes to `@bgforge/format` (the library and the `fgfmt` CLI).

## Unreleased

### Added

- A format result may carry `notice`: the text is formatted, but a comment had to move to keep it, and the notice
  says where. `warning` keeps meaning the formatter refused. `fgfmt` writes the file and prints the notice.

### Changed

- The safety check compares comments, and Fallout `.msg` audio names, in order, so a result that loses or alters
  one is refused.
- Blank lines above comments are kept. A TP2 `ELSE INNER_ACTION` block is formatted as a block.

### Fixed

- No formatter drops, duplicates or merges a comment, or changes the text of a string or a comment: comments
  between call arguments, after `begin`, around `END ELSE`, in TP2 loop and `COPY` headers and in expressions
  stay where they were written; tabs inside SSL comments and blanks inside WeiDU strings are kept.
- Every formatter is idempotent on comment shapes that used to change on a second pass, and TRA with an unclosed
  comment no longer gains a blank line per pass. SSL keeps both dimensions of `variable b[4, 2]`.
- Formatting never takes time quadratic in a line's length.
- `format2da` keeps GemRB's and WeiDU's reading of every line except for trimmed trailing spaces: a row's text past
  GemRB's last column is kept as written, a row starting with a space keeps an empty name, blank lines up to
  GemRB's column-names line keep their place, cells split on spaces and tabs only, and a lone `\r` ends a line.
  It refuses an encrypted file (first two bytes 0xFF).
- `fgfmt --save` no longer replaces the bytes of a file that is not UTF-8 with U+FFFD: such a file is formatted
  byte for byte, whatever its codepage, and keeps every byte but spaces, tabs and line breaks. A file with NUL bytes
  (UTF-16) is refused.
- The formatters and the safety check treat only spaces, tabs and line breaks as blanks: a no-break space,
  ideographic space or other Unicode space at the edge of a comment, note or audio name is kept, not trimmed.

## 0.9.0

### Changed

- Output differs from 0.8.0 in three places: Fallout SSL indents the `end` of an empty block to its statement;
  WeiDU BAF indents the conditions under `OR(#2)` or `OR(0x2)` as under `OR(2)`, and keeps them flat under an
  unknown `%n%` count; Fallout `.msg` keeps indented entries as written.
- A keyword used as a name is a syntax error in WeiDU TP2 and D and in Fallout SSL, as WeiDU and the SSL
  compiler read it, so such a file is refused. An SSL macro may still name itself or a parameter like a keyword,
  and `in` is no longer an SSL operator.

### Fixed

- Files refused as syntax errors are formatted where WeiDU, the SSL compiler or the game accept them:
  - WeiDU TP2: the remaining actions, patches, values, operators and clause shapes, `AND` between predicates, an
    assignment after a list, a comment inside a string.
  - WeiDU D: sounds, female text, `^` and `!strref` in any text, bare words as strings, `%var%` as a trigger or
    action, numbers in hex or quoted, nested comments, `~~~~~` strings.
  - WeiDU BAF: nested comments, multi-line strings, sounds and female text, object rectangles, `#5`, `#` and `!`
    in names, `%var%` as a call name, `IF ... THEN END`.
  - Fallout SSL: `import` and `export` procedures and blocks, `call ... when`, raw strings `@"..."`, `for` without
    parentheses, `0X` hex, `5.`, variadic macros, an `else` after a macro that opens an `if`.
- WeiDU .tra: formatting continues past a comment holding a quote or a percent sign.

## 0.8.0

### Changed

- Requires Node 22 or newer, up from 20.
- When `fgfmt` cannot re-parse its own output, it says why, as it already did for a file it cannot parse.
- `validateFormatting` catches whitespace changed inside a string, not only outside one: the `stripComments*`
  normalizers now keep each string's whitespace as visible `\u{..}` escapes (dropping `\r`), so their output
  differs from 0.7.0 for any text holding a string with whitespace in it. WeiDU D is the exception: its new
  `stripCommentsWeiduD` leaves string whitespace alone, because the D formatter reformats trigger and action
  strings, which are code.

### Fixed

- WeiDU .tra: a multi-line `%...%` string is kept exactly as written; its trailing spaces were trimmed and its
  blank lines collapsed.
- WeiDU TP2 and D: `//` inside a string, such as a URL in `~...~`, is no longer taken for a comment.
- WeiDU TP2: `PATCH_TIME`, `OUTER_SNPRINT`, `PATCH_DEFINE_ARRAY`, a function result returned into an array element
  or an evaluated name, and an empty `STR_VAR`, `RET` or `RET_ARRAY` list are formatted instead of refused as
  syntax errors.
- WeiDU TP2: a file using a quoted resource type in `CREATE` (`CREATE ~ITM~ ~m#sword~`) is no longer refused as a
  syntax error.
- WeiDU D: a multi-line SAY, REPLY or JOURNAL string is kept exactly as written; only trigger and action code is
  re-indented.
- Fallout SSL: tabs inside string literals are kept, and `//` inside a `#define`'s string is not a comment.
- Fallout `.msg`: what follows an entry on its line is kept, and CRLF line endings stay CRLF.

## 0.7.0

### Added

- `fgfmt --check-idempotency` verifies that formatting is stable without writing anything, where
  `--save-and-check` had to write first to reach the same verdict.
- `fgfmt --exclude-from <path>` skips the files listed in `<path>`, one per line, blank lines and `#`
  comments ignored.

### Changed

- WeiDU D: a `%variable%` is accepted where a name or say text goes, and `INTERJECT_COPY_TRANS` takes the
  bare `END` WeiDU expects. A bare `%macro%` standing in for a whole transition is no longer parsed as one.
- WeiDU BAF: a `RESPONSE` with no actions is accepted rather than reported as a syntax error. The
  reference compiler takes one, and real scripts carry them.
- The first `.d` parse in a process takes a small fraction of the memory it used to, and parses faster.

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
- `fgfmt --help` names the command you actually run. It announced itself as `format-cli`, which is not
  what the package installs.
- `fgfmt --help` prints the help text once. It was registered with the argument parser and printed again
  by hand, so every invocation emitted two copies, the first with a stray colon appended.

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
