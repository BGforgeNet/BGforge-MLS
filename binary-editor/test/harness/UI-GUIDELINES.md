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

Boxing rule (INTENTIONAL and consistent - do NOT flag the difference as cross-format divergence): a flag block
that SHARES a panel with other blocks gets its own titled inner box (a `fieldset` with a legend) so the
bitfield reads as one labelled set - e.g. ITM Usability's four byte-flags, ITM General Flags inside the
Identity panel, PRO Header Flags inside the Header panel, an effect's Save Type / Resistance beside its
fields, a MAP object's Flags beside its fields. A flag block that is the SOLE content of a titled panel takes
NO inner border and leans on the panel's own chrome (border + `h3`) as the group box - e.g. CRE Flags, CRE
Status, SPL Flags, SPL Exclusion. So when you see one flag block with an inner border and another without, that
is this share-vs-sole rule, not an inconsistency. Implemented by the `boxed` prop in `FlagColumns.svelte`
(`boxed=false` for the sole-in-panel case).

## Master-detail detail panels (shared / parallel fragments)

A record that appears in more than one format renders through ONE shared layout fragment, so the same record
looks identical wherever it appears rather than falling back to a generic auto-form. EFF v2 effect bodies
(standalone `.eff` and CRE-embedded v2 effects) share `effV2BodyRows`; the 48-byte ITM/SPL feature-block
effects share `featureBlockBodyRows`. Item and spell ABILITIES render through per-format ability fragments
(`itmAbilityBodyRows` / `splAbilityBodyRows`).

Parallel-not-identical is INTENTIONAL (do NOT flag as divergence): where two records genuinely differ, their
fragments share panel TITLES, ordering, and controls where the concepts align, and each adds only the panels
its own record needs. An ITM ability has Damage / Charges panels a SPL ability lacks (which has a Casting
panel instead); an EFF v2 effect has a Caster & Projectile panel and a fuller Classification panel that the
48-byte feature block lacks. This is the "similar record -> parallel presentation" rule. A shorter record
under a longer fragment (e.g. a v1 effect under the v2 fragment) falls back to the auto-form rather than
rendering a partial.

## Intentional cross-format patterns (verified - do NOT flag)

- **Faithful raw-byte display.** Resref / string fields show their stored bytes verbatim, so a field holding
  non-printable or binary bytes renders as mojibake (e.g. SPL Completion Sound, EFF Parent Resource on some
  fixtures). Faithful display is preferred over prettifying; the model keeps the raw bytes, so the field
  round-trips. This is consistent across formats, not a per-field codec bug.
- **PRO single-field property panels.** Every PRO object type gets its own titled `<Type> Properties` panel
  for cross-subtype consistency, even when it holds a single field (tile -> Material, misc -> Unknown). The
  panel is `fit` (content-width) so it shares the Header row. A lone-field property panel is this
  parallel-subtype rule, not a stranded panel.
- **Generic indexed labels for game-specific slots.** The binary format is game-agnostic, so slots whose names
  differ across games (CRE proficiencies 9-20) show a generic "Proficiency N" rather than guessing one game's
  names. Faithful to the format, not an unfinished label.
- **Nested-group detail uses a vertical tab strip.** An auto-form detail with sub-groups (e.g. a MAP object's
  Inventory Header / Object Data) renders them as a vertical tab strip; the filled selected tab is the
  vertical-tab style, not an action button.

## Harness-render caveats - artifacts, not defects (do NOT flag)

- The large empty area at the bottom of some screenshots is the harness's tall capture viewport, not a layout
  defect.
- `shot-primitives.png` is a standalone primitives gallery (raw controls), NOT the dense field layout - the
  tier sizing above does not apply there.
- Screenshots are captured at a reduced device scale so tall forms stay under the readable image-size limit;
  minor softness is expected.
