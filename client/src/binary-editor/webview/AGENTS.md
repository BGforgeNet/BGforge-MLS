# Binary-editor webview - UI conventions (render layer)

Project UI conventions for the binary-editor WEBVIEW (the Svelte render layer) - what a writer here must honor.
The _schema-side_ decisions (which fields, byte order, flag grouping, shared fragments) live in
`binary/src/AGENTS.md`; the holistic review brief + fuller rationale in `binary-editor/AGENTS.md`.
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

## Resolved strrefs: idle text in roomy controls, tooltip in dense ones

A field whose spec declares `ref: { kind: "strref" }` (see `binary/src/AGENTS.md`) carries the host-resolved
`dialog.tlk` line in `row.strrefText` when the record was opened from an installed game. `NumberField.svelte`
renders it with the hex field's wrapper shape - a dimmed static span holding the number beside a borderless
input holding the line, chromed as one control (tier L, line ellipsized), so the eye lands on the text rather
than the number. Focus hides the span and swaps the input to the bare number, so what you edit is what is
stored and the value is never shown twice; the title carries the full line. A record outside a game has no
`strrefText` and renders an ordinary number.

The `compact` prop on `CellControl` is the declared N/A for the shared-layer rule below: it keeps the number in
the cell and moves the line to the tooltip. Only `MatrixBlock` sets it - a true 2D matrix has no room to grow.
A grid is NOT compact: it shows the line like any other form. Getting there needed the grid to stop sizing
itself by content - see the sizing note below - because a 5-column grid of L-tier controls overflowed the panel.

## Resolvable resrefs get an open chip; unresolvable ones get nothing

A field the spec marks `{ kind: "resource" }` carries `row.openTarget` when the OPEN GAME actually has the
resource - the host takes the declared type (or this game's `byFlavour` override) and asks only whether it is
there. A `{ kind: "deferred" }` resref never resolves, so it renders bare. `OpenResourceLink.svelte` renders a
`-> <ext>` chip beside the value, styled as `JumpLink` (which navigates WITHIN the record; this opens a
different resource entirely, via a host command so the binary-vs-default editor choice stays in one place).

Absent `openTarget` renders NOTHING - no marker, no dimming, no advisory. That is deliberate and must stay:
a mod record legitimately references what a later install step creates, so flagging it would fire on correct
input. Per the shared-layer rule above, the chip is rendered by BOTH `Field.svelte` and `GridBlock.svelte` -
and SUPPRESSED on a row that also carries a picture, which becomes the link instead (see the picture section
below; the decision is `showsOpenChip`, never an inline condition in a renderer).

**A NUMERIC field can carry the chip too, and it is not a resref.** Where an `{ kind: "ids" }` ref declares
`symbolResource`, the value's symbol in that table IS a resref - PROJECTL.IDS's symbols are `.PRO` basenames -
so an ability's projectile offers to open the projectile file while staying a numeric dropdown. The chip is
keyed off `row.openTarget` alone, so nothing in the render layer needs to know which of the two produced it.
The pairing sets `openTarget` ONLY, never `refExt`: `refExt` turns a field into a resref picker, which would
be wrong for a field whose value is a number chosen from a named list.

## A resolvable picture draws inline, in a box that never changes size

A resref field whose resolved type is a PICTURE - an icon BAM, a portrait BMP - additionally carries
`row.thumbnail`, and `ResourceThumbnail.svelte` draws it beside the value. Which types qualify is the host's
answer, not the render layer's (`client/src/ie-resources/thumbnails.ts` owns both the predicate and the decode),
because the row is marked at build time and the bytes are fetched later: a type the host cannot draw would
reserve a box nothing ever fills.

**The picture IS the open control, and it replaces the chip.** Where the target can be opened the image is a
`<button>` that opens it, and the row drops the `-> ext` chip - one control per action, and the one that shows
what it will open. Rows with no picture keep the chip, which is the only affordance a resource with nothing to
show can have. Neither renderer decides this itself: `showsOpenChip(row)` and `thumbnailOpens(row)`
(`state/controls.ts`) are shared, so a row cannot end up with both affordances in one block and one in another.
A drawable type nothing can open renders an inert `<span>` - it promises nothing - and the button carries an
`aria-label`/`title` because an icon-only control has no visible text to name it.

Three properties are load-bearing and are guarded rather than left to care:

- **The box is fixed and present from the first paint**, before any bytes exist. A picture that appeared on
  arrival would push every control in its row, which the stable-layout rule above forbids.
  `render-resource-picker.mts` measures the row's height with and without a picture and fails if they differ.
  Its 22px size was measured against that, not chosen by eye: a 32px kv row absorbs the box up to 26px and
  grows at 28px, so it is deliberately BIGGER than the ~21px control beside it and still short of the row.
  Raising it means redoing that measurement.
- **`img-src data:` is in the CSP** (`index.html`), and the harness's policy matches. Without it
  `default-src 'none'` blocks every thumbnail SILENTLY - the box renders, the picture does not.
- **Marked only when the game HAS the resource**, like the open chip, so an unresolvable resref reserves nothing
  and fetches nothing.

The two affordances are independent, and neither implies the other: a portrait draws AND opens (VS Code's own
image preview shows it), while a CRE's script opens and is not a picture. Do not collapse them into one flag.
Bytes are fetched per resource and cached by the bridge, so several fields naming one icon cost one decode.

## A resref field is a picker with a game, and the list is a suggestion set - never the domain

`row.refExt` (the type the field points at in THIS game) is the separate, weaker signal: the host sets it
whenever the record came from a game, where `openTarget` additionally needs the current VALUE to resolve. So
an empty or unresolvable resref is still pickable while staying un-openable, which is the split the two
affordances exist for. `ResourceField.svelte` renders it through the same `Combobox` every enum uses, loading
the install's resrefs of that type on FIRST OPEN (`onopen`) - a record carries many such fields and the lists
run to thousands, so mounting must not fetch. The bridge caches per type.

`allowCustom` is UNCONDITIONAL here, where an enum ties it to `enumOpen`. Same reason the chip stays absent
rather than flagging: confining the field to what is installed today would reject correct input. Do not "fix"
this into a closed list, and do not add a warning for a typed name the install lacks.

The `Combobox` caps how many options it RENDERS and states the overflow in the list. bits-ui mounts every item
it is given, so the cap is what keeps a ~12300-entry BAM list from mounting 12300 nodes; keep the notice if you
touch it - a silently truncated list reads as a complete one.

## A grid fits columns to the panel; the schema count is a maximum

`GridBlock` is multi-column (`column-count` from the schema as a cap, a measured `column-width` as the
minimum), so it sheds columns instead of overflowing. Sizing cannot be declared here: a cell is a label plus a
tier-sized control, and with a game open a CRE sound slot's label comes from the game's IDS table and runs
three times longer than the schema's generic "Sound 12". The measured `--nm-w` (widest label) is applied to
every cell so controls align down a column - the old subgrid cannot span multicol columns - and `--col-w` sums
the widest label and widest control separately, because those two rarely sit in the same cell.

Guarded at two viewports by `render-cre.mts`. The harness has no game, so it exercises the narrow-panel case
rather than the long-label one; both are "content wider than the panel".

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
- **A resref picker takes a dropdown box sized from the FIELD's char capacity**, not from its options: every
  option is a resref of the same char array, so the field already bounds them - and the width must hold before
  the list has loaded, which sizing off the options would not.
- Sized off the LONGEST option (not the current value), so changing the selection never clips, and dropdowns
  still align with each other (quantized). A dropdown still looks a little roomy next to a SHORT current value -
  that is the off-the-longest-option contract, not a defect.
- A control narrower than its column track leaves empty space to its right. INTENTIONAL: the value track is
  `auto`, so it sizes to the widest control in the column; left edges stay aligned.

## A grid cell is sized by its tier, never by its content

`GridBlock` cells consume `--val-ch` exactly like the kv forms. Two traps this closes, both of which shipped as
visible defects in the CRE sound slots (100 strrefs):

- **The tier is a property of the FIELD, not of the value.** `valueTier` keys on `row.ref`, never on whether a
  particular strref resolved - keying on the resolved text sized siblings of one field differently, so a
  5-column grid came out 266/266/117/117/117 and read as ragged.
- **A grid control must not fall back to its intrinsic width.** Grid inputs were pinned to a flat `52px`, under
  the S tier, which clipped any value past ~4 digits. They now take `var(--val-ch, 52px)`. Do NOT add
  `min-width: 0` here (the kv rules have it): the control track is `auto`, so a shrinkable control lets the
  track shrink with it and the value clips again.

The schema's column count is a MAXIMUM, not a promise - the block fits what the panel allows (see above), so
raising it is safe but does not guarantee that many columns.

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

**A bit can be named by the install, and only a SHARED bit is relabelled.** Where the spec declares `flagsRef`
(see `binary/src/AGENTS.md`), the host resolves the kits the open game maps onto each bit into
`row.flagBitNames` - a LIST per bit, because the relation is many-to-one. `FlagGroups.svelte` leaves a bit the
install claims for one kit exactly as it was: the vendored label already names it, and more tersely than the
game's own string (a "Cleric" subgroup shows "Talos", not "Priest of Talos"). A bit several kits share cannot be
named after any one of them, so it takes a group label with the kits listed in its `title`. Do NOT "improve"
this into naming every bit from the game - it would undo the deliberate terse labels and, on a shared bit, pick
an arbitrary winner.

`FlagColumns.svelte` is the declared N/A for the shared-layer rule at the top: no field it renders declares
`flagsRef` (ITM kit usability is the only one, and it renders only through `flagGroups`), so there is nothing
for it to resolve. Wire it the same way if a second bitfield ever declares one.

## Nested-group detail uses stacked headed sections

An auto-form detail with sub-groups (e.g. a MAP object's Object Data / Subtype Data) renders each group as its
own titled section, stacked vertically (`.subgroup` + `<h4>` title) - not a tab strip. The scalar fields sit
above the sections. (The childList tab - a MAP object's Inventory - is separate; see `ListEntryDetail`.)
