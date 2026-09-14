# @bgforge/binary

Library and CLI for parsing and serialising:

- Fallout `.pro` (prototype) and `.map` (savegame/map) files.
- Infinity Engine `.itm` (item) and `.spl` (spell) v1 files, `.eff` (effect) v2 files, `.cre` (creature) v1 files,
  and `.dlg` (dialog) v1 files.

Round-trips bytes <-> structured data <-> canonical JSON snapshots, suitable for
diff-friendly version control of binary fixtures and for the BGforge MLS
binary editor.

## Install

```bash
pnpm add @bgforge/binary
```

Requires Node 20 or newer.

## Library API

Pick a parser by file extension, parse bytes, and round-trip through a
canonical JSON snapshot:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parserRegistry, createBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "@bgforge/binary";

const parser = parserRegistry.getByExtension(".pro");
if (!parser) throw new Error("unsupported extension");

// Bytes -> structured ParseResult.
const bytes = readFileSync("scout.pro");
const result = parser.parse(new Uint8Array(bytes));

// ParseResult -> canonical JSON snapshot (diff-friendly, version-controllable).
const snapshot = createBinaryJsonSnapshot(result);
writeFileSync("scout.pro.json", snapshot);

// JSON snapshot -> ParseResult -> bytes.
const reloaded = parseBinaryJsonSnapshot(snapshot);
const out = parser.serialize?.(reloaded);
if (out) writeFileSync("scout-out.pro", out);
```

The same pattern works for `.map`, `.itm`, `.spl`, `.eff`, `.cre`, and `.dlg`. To load a
JSON snapshot directly from disk, use `loadBinaryJsonSnapshot(jsonText, options)`.

`.dlg` additionally exposes `buildDlg(input)` and `toDlgBuildInput(bytes)`, which build a dialog from its
content rather than re-emitting one over its own bytes - the path an edit that changes a trigger or action
string has to take, since that moves every offset after it.

Public exports also include parser types (`BinaryParser`, `ParseOptions`,
`ParseResult`, `ParsedField`, `ParsedGroup`, `ParseOpaqueRange`),
format-adapter registration, and presentation-schema lookups.

## `fgbin` CLI

```
fgbin <file.pro|file.map|file.itm|file.spl|file.eff|file.cre|file.dlg|dir> [--save] [--check] [--load] [--parse-only] [--graceful-map] [--proto-dir <dir>] [-r] [-q] [--jobs <n>] [--exclude-from <path>] [--exclude-base <dir>]
fgbin --extensions
```

With no mode flag, the JSON snapshot is printed to stdout.

- `--save` - write parsed JSON snapshot alongside the binary file
  (`.pro.json` / `.map.json` / `.itm.json` / `.spl.json` / `.eff.json` / `.cre.json` / `.dlg.json`)
- `--check` - exit 1 if the binary does not match its existing JSON snapshot
- `--load` - read a JSON snapshot and write the binary back out using the
  parser's native extension
- `--parse-only` - parse and report errors without building the snapshot; the
  exit code is the verdict. Cannot be combined with `--save`, `--check` or `--load`
- `--graceful-map` - opt into permissive MAP boundary guessing for ambiguous
  files (default is strict). Not used by `--load`: a MAP snapshot reloads
  permissively only when it carries an `objects-tail` opaque range
- `--proto-dir <dir>` - load MAP object-subtype overrides from
  `<dir>/{items,scenery}` instead of the default sibling `<mapDir>/../proto/`.
  Affects MAP inputs only; exits 1 if `<dir>` is missing
- `-r` - recurse into directories
- `-q` - quiet mode (suppress summary)
- `--jobs <n>` - process a directory's files with N parallel workers
- `--exclude-from <path>` - skip the files listed in `<path>` (`#` comments and
  blank lines ignored)
- `--exclude-base <dir>` - resolve `--exclude-from` entries against `<dir>`
  instead of the target
- `--extensions` - print the supported file extensions, one per line, and exit

## Supported file types

- `.pro` - Fallout 1/2 prototype files (items, critters, scenery, walls, tiles, misc).
- `.map` - Fallout 1/2 savegame/map files.
- `.itm` - Infinity Engine item files (v1: BG1, BG2, IWD).
- `.spl` - Infinity Engine spell files (v1: BG1, BG2, IWD).
- `.eff` - Infinity Engine sub-effect files (v2: BG2EE, IWDEE).
- `.cre` - Infinity Engine creature files (v1: BG1, BG2, BGEE).
- `.dlg` - Infinity Engine dialog files (v1, both header lengths: BG1, BG2, EE).
