# Binary-editor UI guidelines

Project-specific UI choices for the binary-editor webview, with rationale. Render the editor with the harness
(see `README.md`), then review the screenshots against this file. General UI/UX principles (size to content,
align columns, legible contrast, don't encode meaning in color alone, scan the whole surface) are assumed -
this file records only what is SPECIFIC to this editor, including which apparent oddities are intentional so a
review doesn't flag them.

## Field width: a small display-width tier scale

Value controls map to one of three fixed widths, chosen by the field's DISPLAY width (characters it renders),
not its byte size. The tier is classified in `client/src/binary-editor/webview/state/controls.ts`
(`valueTier`); the ch widths live in CSS tier classes (`.field-control.tier-{s,m,l}` -> `--val-ch`) in
`client/src/binary-editor/webview/styles.css`.

- **S (6ch)** - decimal numbers: stats, levels, counts, IDs, strrefs up to ~6 digits. The common case.
- **M (14ch)** - hex fields, 8-char resref strings, dropdowns, mid-length strings.
- **L (32ch)** - long char arrays (e.g. a 32-char variable name) and long dropdown labels.

Fixed grid tracks keep columns aligned: a tier sets only a control's right edge, never its left edge or the
next column's position. Rationale: one snug numeric width keeps the dominant small fields tight while the few
wider values still fit; per-value widths would read as ragged across records.

INTENTIONAL - do not flag:

- Dropdowns are sized to their LONGEST option label (so changing the selection never clips), so a dropdown
  often looks roomy next to its current value.
- A control narrower than its column track has empty space to its right - that is the fixed-track design, not
  misalignment, as long as the left edges line up.

## Hex display for type-encoded IDs

Some numeric fields display in hex rather than decimal because the value is a packed `(type << 24) | index`
ID - hex makes the type nibble legible and stops the master list from showing indistinguishable big decimals:
MAP `FID`/`PID`, PRO Inventory/Head/Male/Female `FRM ID`. The PRO header `frmId` is a plain index, so it
stays decimal.

## Flag groups

A flag field's checkboxes are the bits of one bitfield; group them so it is obvious they belong together.
Flags are a full-width block below the scalar key-value grid, not members of the value-width tier scale.

Known gap: flag-group bordering is not yet uniform across all formats (some flags sit in their own titled
panel, some inline in a shared panel). Don't over-flag this on a per-format basis until it is unified.

## Harness-render caveats - artifacts, not defects (do NOT flag)

- The large empty area at the bottom of some screenshots is the harness's tall capture viewport, not a layout
  defect.
- `shot-primitives.png` is a standalone primitives gallery (raw controls), NOT the dense field layout - the
  tier sizing above does not apply there.
- Screenshots are captured at a reduced device scale so tall forms stay under the readable image-size limit;
  minor softness is expected.
