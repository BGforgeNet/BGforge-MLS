# @bgforge/format

Formatting library and CLI for Fallout SSL, WeiDU BAF/D/TP2/TRA, Fallout MSG,
Infinity Engine 2DA, and Fallout scripts.lst files.

## Install

```bash
pnpm add @bgforge/format
```

Requires Node 20 or newer.

## Library API

Pure-string formatters take a raw file's text and return formatted text plus
an optional warning:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { formatTra, formatMsg, format2da, formatScriptsLst } from "@bgforge/format";

const raw = readFileSync("dialog.tra", "utf-8");
const result = formatTra(raw);
writeFileSync("dialog.tra", result.text);
if (result.warning) console.warn(result.warning);
```

The same pattern applies to `formatMsg`, `format2da`, and `formatScriptsLst`.

Tree-based formatters (`formatFalloutSsl`, `formatWeiduBaf`, `formatWeiduD`,
`formatWeiduTp2`) take a parsed tree-sitter root node plus formatting options;
see the source for the exact signatures.

Other helpers cover comment stripping (`stripCommentsWeidu`, `stripCommentsFalloutSsl`,
...), formatting validation (`validateFormatting`), and editorconfig discovery
(`getEditorconfigSettings`).

`@bgforge/format/internal` is a second entry point holding helpers shaped by the
tree-sitter grammars - comment normalisers, tilde-delimiter scanning, and TP2 node
predicates. It exists for this repo's own callers and carries no semver promise;
its contents move whenever a grammar does.

## `fgfmt` CLI

```
fgfmt <file|dir> [--save] [--check] [--save-and-check] [--check-idempotency] [-r] [-q] [--jobs <n>]
```

- `--save` - write formatted output back to file(s)
- `--check` - exit 1 if any file is not already formatted
- `--save-and-check` - save and verify idempotency in one pass
- `--check-idempotency` - verify idempotency without writing anything, for sweeping a tree other
  jobs are reading at the same time
- `-r` - recurse into directories
- `-q` - quiet mode (suppress summary)
- `--jobs <n>` - process directory files with `n` parallel workers (output order matches the sequential walk;
  with `--check`, all files are checked before the exit code instead of stopping at the first mismatch)
- `--exclude-from <path>` - skip the files listed in `<path>` (`#` comments and blank lines ignored)
- `--exclude-base <dir>` - resolve `--exclude-from` entries against `<dir>` rather than the target, for a
  list shared by targets at different depths

## Supported file types

`.ssl`, `.baf`, `.d`, `.tp2` (`.tph`/`.tpa`/`.tpp`), `.tra`, `.msg`, `.2da`, `scripts.lst`
