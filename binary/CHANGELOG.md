# Changelog

Notable changes to `@bgforge/binary` (the library and the `fgbin` CLI). Binary-editor UI changes ship in the extension changelog, not here.

## 0.5.0

### Added

- Infinity Engine game archives: `openGame(dir)` reads an installed game through its `chitin.key` -
  BIF archives (plain, `BIF `, and BIFC compression), `dialog.tlk` strings, IDS and 2DA tables - with
  `override/` resolution and game identity detection (BG1/BG2/IWD/PST and the Enhanced Editions,
  including SoD/EET/BGT refinement). Read-only and streamed. A `chitin.key` naming a BIF outside the
  game folder is refused.
- Effect opcode reference: `opcodeReading(opcode, engine)` and `OpcodeReadings` carry one entry per
  engine reading of each opcode number - every Enhanced Edition and Icewind Dale 2 opcode included -
  with names, parameter labels, enum tables, and per-engine availability.
- `BinaryParser` declares its game `family` (`fallout` / `infinity-engine`), and `getByExtension`
  takes an optional family, so an extension both engines claim (`.pro`) resolves to the right parser.
- `fgbin --jobs <n>` processes directory files with `n` parallel workers. Output order matches the
  sequential walk; with `--check`, all files are checked before the exit code instead of stopping at
  the first mismatch.

### Fixed

- Signed fields no longer read as huge positive numbers: an effect's Save Bonus, an item ability's
  Damage and THAC0 bonuses, a creature's THAC0, and Fallout ammo's AC and DR modifiers now parse and
  serialise as the signed values the engines store. JSON snapshots of affected records change
  accordingly.

## 0.4.0

### Added

- `getNumericTypeRange`, `getDomainRange`, and the `NumericRange` type: a scalar field's valid numeric range, derived from its integer type and any domain constraint.
- Field presentation entries can now carry optional `description` and `docUrl` (a field's IESDP documentation text and doc link), for editor tooltips. Presentation-only - never part of the parsed record or the JSON snapshot.

## 0.3.0

### Changed

- Oversized JSON snapshots (crafted to inflate array lengths) are now rejected before allocation.
- Registering two parsers or format adapters under the same id now throws instead of silently overwriting.
- Proto-dir `.pro` reads (MAP subtype resolution) are now capped at the PRO size budget.

### Removed

- `findEditableField` is no longer exported; there is no replacement.

### Fixed

- Trailing-NUL trimming no longer leaves a literal NUL byte at the end of a trimmed value.
- CRE: an empty section whose offset a shrinking edit pushed past end-of-file is now recomputed correctly on save.
- The CLI's JSON-snapshot input-size cap can no longer be raced past by swapping the file mid-read.

## 0.2.0

### Added

- `fgbin --proto-dir <dir>`: load MAP object-subtype proto overrides from an explicit directory instead of the default sibling `<mapDir>/../proto/`. MAP inputs only; exits non-zero if the directory is missing.
- Structure-editing operations for in-place record mutation: add / remove / duplicate for MAP objects and variables and for ITM / SPL / CRE abilities and effects, with opaque-range re-anchoring for byte-faithful round-trips.

### Changed

- `fgbin` enforces a per-format input-size cap on CRE files, matching the other formats.

### Fixed

- PRO drug-effect fields are decoded as signed int32 (negative values were previously misread).
- CRE proficiencies are decoded as separate active and original-class values.
- MAP parsing clamps an out-of-range script-section count to the remaining buffer instead of overrunning it.

## 0.1.0

Initial release.
