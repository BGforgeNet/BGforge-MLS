# @bgforge/binary

Library and CLI for parsing and serialising Fallout `.pro` (prototype) and
`.map` (savegame/map) binary files. Round-trips bytes ↔ structured data ↔
canonical JSON snapshots, suitable for diff-friendly version control of
binary fixtures and for the BGforge MLS binary editor.

## Library API

```ts
import {
    parserRegistry,
    createBinaryJsonSnapshot,
    loadBinaryJsonSnapshot,
    parseBinaryJsonSnapshot,
} from "@bgforge/binary";
```

Public exports include the parser registry (`parserRegistry`), parser types
(`BinaryParser`, `ParseOptions`, `ParseResult`, `ParsedField`, `ParsedGroup`,
`ParseOpaqueRange`), JSON snapshot helpers, format-adapter registration, and
presentation-schema lookups.

## `fgbin` CLI

```
fgbin <file.pro|file.map|dir> [--save] [--check] [--load] [-r] [-q]
```

- `--save` — write parsed JSON snapshot alongside the binary file
  (`.pro.json` / `.map.json`)
- `--check` — exit 1 if the binary does not match its existing JSON snapshot
- `--load` — read a JSON snapshot and write the binary back out using the
  parser's native extension
- `--graceful-map` — opt into permissive MAP boundary guessing for ambiguous
  files (default is strict)
- `-r` — recurse into directories
- `-q` — quiet mode (suppress summary)

## Supported file types

`.pro` (Fallout 1/2 prototype files: items, critters, scenery, walls, tiles,
misc), `.map` (Fallout 1/2 savegame/map files).
