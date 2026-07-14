# Binary-editor webview - UI conventions (render layer)

Project UI conventions for the binary-editor WEBVIEW (the Svelte render layer) - what a writer here must honor.
The _schema-side_ decisions (which fields, byte order, flag grouping, shared fragments) live in
`binary/src/AGENTS.md`; the holistic review brief + fuller rationale in `docs/binary-editor-ui-guidelines.md`.
General UI/UX principles (size to content, align columns, legible contrast, don't encode meaning in color
alone) are assumed - this records what is SPECIFIC to this editor, including which apparent oddities are
intentional so a change doesn't "fix" them.

## Field-presentation features cover every block renderer, through one shared layer

Fields render through MULTIPLE components: `Field.svelte` (kv/detail forms), `blocks/FieldsBlock.svelte`
(packed titled boxes), `blocks/GridBlock.svelte` (label+control grids), `blocks/MatrixBlock.svelte` (2D
matrices), with `CellControl.svelte` as the shared control dispatcher underneath. A per-field presentation
property (a tooltip, a range hint, a diagnostic/advisory, a link affordance) added to ONE of these renderers
is a defect unless every other renderer either also gets it (via one shared helper/component, never per-block
copies) or is explicitly declared N/A with the reason. A field's presentation must not depend on which block
kind the layout schema happened to place it in.

## Field width: a small display-width tier scale

Value controls map to a small fixed set of widths by DISPLAY width (characters rendered), not byte size. TEXT
inputs (number / string / hex) use a four-step S/M/ML/L scale; DROPDOWNS have their own five-step scale
(below). Classified in `state/controls.ts` (`valueTier` for text inputs, `dropdownWidth` for enums); ch widths
in the CSS classes (`.field-control.tier-{s,m,ml,l}` and `.field-control.dd-{1..5}` -> `--val-ch`) in
`styles.css`.

- **Text tiers**: **S** - decimals that show up to ~6 digits, i.e. 8/16-bit ints (stats/levels/counts, the
  common case); **M** - decimals that can show 8-11 digits, i.e. 24/32-bit ints (a strref/XP/gold), plus hex
  (`0x`+8 digits) and 8-char resref; **ML** - 13-20 char strings (a char[16] MAP filename); **L** - long char
  arrays. A decimal's max digit count is fixed by its integer range (its byte width), so the tier is sized to
  that max, never the current value - a value change can't clip; hex32 is always M; IE strings are mostly resref
  -> M.
- **Dropdowns are sized independently**, to their OWN longest option (value-prefixed, as the trigger renders it),
  quantized to the `dd-1..dd-5` ch scale (10/16/20/25/32ch). Measured per-dropdown via canvas (in ch, so it
  scales with the theme font; char-counting over-promotes wordy labels and clips hex-prefixed ones). WHY a
  separate scale: a dropdown often shares a column with a hex/resref input that needs MORE room than any enum
  option, so inheriting the text tier left every dropdown over-wide; sizing to its own longest option fixes it.
  The searchable combobox (effect opcode) keeps the widest box (dd-5) for free-text typing.
- Sized off the LONGEST option (not the current value), so changing the selection never clips, and dropdowns
  still align with each other (quantized). A dropdown still looks a little roomy next to a SHORT current value -
  that is the off-the-longest-option contract, not a defect.
- A control narrower than its column track leaves empty space to its right. INTENTIONAL: the value track is
  `auto`, so it sizes to the widest control in the column; left edges stay aligned.

## Keep columns aligned with fixed grid tracks

A tier sets only a control's right edge, never its left edge or the next column's position. Use fixed grid
tracks sized to the widest tier in each column; left-align every control in its track.

## Multi-column fill: column-major (top-down first)

A multi-column group fills column 1 top-to-bottom, then column 2, ... - NOT left-to-right across rows. Reading
order runs DOWN each column. Holds for the scalar fields grid (`FieldsBlock.svelte`, `grid-auto-flow:column` +
a fixed row count), the flat label/control grid (`GridBlock.svelte`), and flag grids
(`FlagColumns.svelte` / `FlagGroups.svelte`). Exception: `MatrixBlock.svelte` (CRE stats / proficiencies) is a
true 2D matrix - nothing to fill column-major. Guarded by the ITM/CRE render harnesses ("fills top-down first").

## Uniform spacing: one inter-column / inter-block gap

The gap between a multi-column grid's columns and the gap between adjacent blocks in a panel are the SAME
spacing, both driven by one CSS variable (`--bb-col-gap` on `.layout-root`, consumed by `.kv-multi` and
`.panel-blocks`). Reuse that variable for any new multi-column / multi-block layout; never mint a fresh gap
value. Guarded by the ITM harness ("inter-block gap equals inter-column gap").

## Stable layout: columns must not jump on edits

Editing a value (or anything that rewrites a label) must not shift the layout - column positions are fixed by
construction, never derived from runtime content. Value controls use fixed tiers (a longer value never widens
its box). Label columns are per-column `max-content` so each hugs its own labels; the ONE column whose label is
rewritten at runtime (the effect detail's parameter column) is floored with `minmax(<reserveCh>ch, max-content)`
so its value can't jump as the label changes. The schema marks that column via `labelReserve` (see
`binary/src/AGENTS.md`); the renderer honors it in `FieldsBlock.svelte`.

- Do NOT add a blanket label min-width floor. A short static label ("Opcode") must hug its value: the
  label->value gap MUST read tighter than the inter-column gap, or the value visually binds to the NEXT
  column's label (Gestalt proximity). Verify by comparing the two adjacent gaps, not the absolute label gap.
- Guarded by the ITM harness ("value columns stay put when labels change").

## Flag groups (render)

A flag field renders full-width below the scalar key-value grid, not as a value-tier member. Boxed-vs-bare
follows the schema's `boxed` flag (`FlagColumns.svelte`): a flag block sharing a panel gets its own titled inner
box; a flag block that is the SOLE content of a titled panel takes no inner border and leans on the panel
chrome. Don't second-guess that in CSS - the share-vs-sole decision is the schema's (see `binary/src/AGENTS.md`);
render it as marked.

## Nested-group detail uses stacked headed sections

An auto-form detail with sub-groups (e.g. a MAP object's Object Data / Subtype Data) renders each group as its
own titled section, stacked vertically (`.subgroup` + `<h4>` title) - not a tab strip. The scalar fields sit
above the sections. (The childList tab - a MAP object's Inventory - is separate; see `ListEntryDetail`.)
