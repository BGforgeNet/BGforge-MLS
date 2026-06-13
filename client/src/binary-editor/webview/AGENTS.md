# Binary-editor webview - UI conventions (render layer)

Project UI conventions for the binary-editor WEBVIEW (the Svelte render layer) - what a writer here must honor.
The _schema-side_ decisions (which fields, byte order, flag grouping, shared fragments) live in
`binary/src/AGENTS.md`; the holistic review brief + fuller rationale in `docs/binary-editor-ui-guidelines.md`.
General UI/UX principles (size to content, align columns, legible contrast, don't encode meaning in color
alone) are assumed - this records what is SPECIFIC to this editor, including which apparent oddities are
intentional so a change doesn't "fix" them.

## Field width: a small display-width tier scale

Value controls map to one of four fixed widths (S/M/ML/L) by DISPLAY width (characters rendered), not byte
size. Classified in `state/controls.ts` (`valueTier`); ch widths in the CSS tier classes
(`.field-control.tier-{s,m,ml,l}` -> `--val-ch`) in `styles.css`.

- **S** - small decimals (stats/levels/counts/IDs up to ~6 digits, the common case); **M** - hex, 8-char
  resref, short dropdowns; **ML** - mid dropdowns (most IE IDS enums) and 13-20 char strings; **L** - long char
  arrays and long dropdown labels (an effect's Timing, a CRE Kit/Class).
- Dropdowns size to their LONGEST option (so changing the selection never clips), quantized to the tiers - NOT
  hugged to the current option. INTENTIONAL: a dropdown often looks roomy next to a short current value, and
  same-tier dropdowns share one width. Do not "fix" this.
- A control narrower than its column track leaves empty space to its right. INTENTIONAL fixed-track design, not
  misalignment, as long as left edges line up.

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

## Nested-group detail uses a vertical tab strip

An auto-form detail with sub-groups (e.g. a MAP object's Inventory Header / Object Data) renders them as a
vertical tab strip; the filled selected tab is the vertical-tab style, not an action button.
