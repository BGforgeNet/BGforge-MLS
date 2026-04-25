# @bgforge/format

Formatting library and CLI for Fallout SSL, WeiDU BAF/D/TP2/TRA, Fallout MSG,
Infinity Engine 2DA, and Fallout scripts.lst files.

## Library API

Import format-pipeline helpers and editorconfig discovery from `@bgforge/format`:

```ts
import { validateFormatting, stripCommentsWeidu, getEditorconfigSettings } from "@bgforge/format";
```

Exported types include `FormatOutput`, `CommentStripper`, `WeiduToken`, and `WeiduTokenType`.

## `fgfmt` CLI

```
fgfmt <file|dir> [--save] [--check] [--save-and-check] [-r] [-q]
```

- `--save` — write formatted output back to file(s)
- `--check` — exit 1 if any file is not already formatted
- `--save-and-check` — save and verify idempotency in one pass
- `-r` — recurse into directories
- `-q` — quiet mode (suppress summary)

## Supported file types

`.ssl`, `.baf`, `.d`, `.tp2` (`.tph`/`.tpa`/`.tpp`), `.tra`, `.msg`, `.2da`, `scripts.lst`
