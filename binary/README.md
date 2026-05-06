# @bgforge/binary

Library and CLI for parsing and serialising:

- Fallout `.pro` (prototype) and `.map` (savegame/map) files.
- Infinity Engine `.itm` (item) and `.spl` (spell) v1 files.

Round-trips bytes ↔ structured data ↔ canonical JSON snapshots, suitable for
diff-friendly version control of binary fixtures and for the BGforge MLS
binary editor.

For internals (spec system, primitives, derivation, format-adapter pattern,
adding a new format), see [INTERNALS.md](INTERNALS.md).

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
fgbin <file.pro|file.map|file.itm|file.spl|dir> [--save] [--check] [--load] [-r] [-q]
```

- `--save` — write parsed JSON snapshot alongside the binary file
  (`.pro.json` / `.map.json` / `.itm.json` / `.spl.json`)
- `--check` — exit 1 if the binary does not match its existing JSON snapshot
- `--load` — read a JSON snapshot and write the binary back out using the
  parser's native extension
- `--graceful-map` — opt into permissive MAP boundary guessing for ambiguous
  files (default is strict)
- `-r` — recurse into directories
- `-q` — quiet mode (suppress summary)

## Supported file types

- `.pro` — Fallout 1/2 prototype files (items, critters, scenery, walls, tiles, misc).
- `.map` — Fallout 1/2 savegame/map files.
- `.itm` — Infinity Engine item files (v1: BG1, BG2, IWD).
- `.spl` — Infinity Engine spell files (v1: BG1, BG2, IWD).

Infinity Engine wire specs are generated from
[IESDP](https://github.com/BGforgeNet/iesdp)'s `_data/file_formats/` YAML;
checked-in `.ts` outputs in `binary/src/{itm,spl,ie-common}/specs/` carry an
auto-generation banner. To refresh against upstream IESDP, run
`scripts/ie-binary-update.sh`.
