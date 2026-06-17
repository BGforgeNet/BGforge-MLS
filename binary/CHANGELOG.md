# Changelog

Notable changes to `@bgforge/binary` (the library and the `fgbin` CLI). Binary-editor UI changes ship in the extension changelog, not here.

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
