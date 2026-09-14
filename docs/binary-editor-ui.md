# Binary editor UI

How the binary editor turns a parsed record into what you see, and the conventions that keep it consistent.
Four layers own it, and this document covers each:

- **Schema layer** - `binary/src/*/layout-schema.ts`, `ie-common/effect-layout.ts`, `feature-block-layout.ts`,
  the per-format ability fragments, and the presentation schema. Decides WHICH fields appear, in what order,
  grouped how. Nothing here is about pixels. The schema's own types and their per-property semantics:
  `binary/src/layout-schema-types.ts`.
- **Editor core** - `@bgforge/binary-editor` (`binary-editor/src/`). `resolveLayout()` picks the variant the
  parser reported and resolves every field ref to a `Row`; the relationship overlays (`binary-editor/src/relationship/`)
  relabel, retype and link fields from sibling values and emit cross-record diagnostics.
- **Host** - `client/src/binary-editor/game-rows.ts` decorates rows with what only an open game can supply (a
  strref's line, IDS names, open and thumbnail targets, gradient colours) before they reach the webview.
- **Render layer** - the Svelte webview under `client/src/binary-editor/webview/`. Decides how a field the
  schema placed is drawn: control widths, column fill, spacing, affordances.

Parser and codec work is a separate concern; see [binary/INTERNALS.md](../binary/INTERNALS.md) for the spec
system, external references and format adapters.

General UI/UX principles - size to content, align columns, legible contrast, don't encode meaning in colour
alone - are assumed. What follows is what is SPECIFIC to this editor, including which apparent oddities are
intentional, so a change doesn't "fix" them and a review doesn't flag them.

## Stable layout: editing never shifts the columns

The one behavior that spans both the schema and the render layer, and the easiest to get wrong: column positions
are fixed by construction, never derived from runtime content.

- Value controls use fixed display-width tiers (see Field width), so a longer value never widens its box.
- Labels are static EXCEPT in the effect detail, where the opcode overlay relabels a set of fields per opcode:
  the parameters, the dual-purpose 0x1c/0x20 pair, the stacking ids, and `power`. `MUTABLE_LABEL_RESERVE_CH` in
  `binary/src/ie-common/effect-layout.ts` lists the ones that get a label reserve, each with its own width, and
  says why `power` does not.
- **Schema side**: `effectBodyRows` emits `labelReserve` on each fields block that holds one of those fields,
  every ref carrying its own `ch`.
- **Render side**: `FieldsBlock.svelte` gives each label column `max-content` (hugs its own labels); a column
  holding a reserved field is floored with `minmax(<ch>ch, max-content)`, taking the widest reserve among ITS
  reserved fields. So when parameters and the level/dice pair share a block, each column floors to its own
  reserve rather than inheriting the wider one, and every column without a reserved field hugs its labels.
- Do NOT add a blanket label min-width, and do NOT reserve static columns. A short static label ("Opcode") must
  hug its value: the label->value gap MUST read tighter than the inter-column gap, or the value visually binds
  to the NEXT column's label (Gestalt proximity). Verify by comparing the two adjacent gaps, not the absolute
  label gap.
- Guarded by the ITM render harness ("value columns stay put when opcode/parameter labels change").

## Schema layer

Authoring conventions for the declarative layout. These are about how a parsed record is PRESENTED, not
about parsing it.

### Block kinds

A layout is variants -> (tabs -> subtabs ->) rows -> panels -> blocks. `layout-schema-types.ts` documents every
property; this is the map from block kind to the component that draws it. `LayoutRenderer.svelte` draws the
variant, its tab strips, rows and panels, and dispatches each block:

| Kind         | Component                                                 | Use                                                        |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `fields`     | `blocks/FieldsBlock.svelte` (joins: `JoinedField.svelte`) | Key/value fields in N column-major columns                 |
| `group`      | fieldset around `FieldsBlock` (+ `FlagColumns`)           | A boxed, labelled subgroup inside a panel                  |
| `flags`      | `blocks/FlagColumns.svelte`                               | One bitfield as checkbox columns                           |
| `flagGroups` | `blocks/FlagGroups.svelte`                                | Bits regrouped by semantic category across bytes           |
| `grid`       | `blocks/GridBlock.svelte`                                 | Flat label+control cells (skills, item slots, sound slots) |
| `matrix`     | `blocks/MatrixBlock.svelte`                               | A true 2D table (CRE stats, proficiencies)                 |
| `list`       | `blocks/ListBlock.svelte`                                 | A variable-length section, `inline` or `master-detail`     |
| `spellbook`  | `blocks/SpellbookBlock.svelte`                            | The CRE spell tables joined into one type -> level view    |
| `effectTree` | `blocks/EffectTreeBlock.svelte`                           | ITM/SPL abilities with the effects each owns               |
| `raw`        | `blocks/RawBlock.svelte`                                  | Declared by no layout yet; the component is a stub         |

A `list` renders `inline` through `InlineList.svelte` (one `Field` row per entry) or `master-detail` through
`ListSection.svelte` (`VirtualList` plus `ListEntryDetail`). The selected entry's detail renders through the first
of `detailVariant` and `detailVariantFallbacks` whose refs all resolve, else the auto-form (`FormSection.svelte`),
and `childList` adds an owner-scoped nested list (`ChildEntryList.svelte`, a MAP object's inventory).

### One shared fragment per record - same record renders identically

A record that appears in more than one format renders through ONE shared layout fragment, never a per-site
generic auto-form, so it looks identical everywhere. Item and spell ABILITIES use per-format fragments
(`itmAbilityBodyRows` / `splAbilityBodyRows`). EVERY Infinity Engine effect renders through one shared builder,
`effectBodyRows` (`ie-common/effect-layout.ts`), via two fragments: the EFF v2 body (264B, `effV2BodyRows`) and
the 48-byte feature block (`featureBlockBodyRows`). The feature block is ONE record - the same 48 bytes IESDP
documents as both the ITM/SPL feature block and the EFF v1 record (`feature_block.yml` points to `eff_v1.htm`
for every field) - so ITM effects, SPL effects, AND a CRE's `effStructureVersion`-0 effects all render through
`featureBlockBodyRows`. Do NOT add a second 48-byte effect spec or fragment.

- **Parallel-not-identical is INTENTIONAL.** Where two records genuinely differ, their fragments share ordering
  and controls where the concepts align, and each adds only the fields its own record needs (an ITM ability has
  Damage / Charges panels a SPL ability lacks; SPL has a Casting panel instead). Don't flag as divergence.
- **The ITM ability Damage panel folds each damage roll into one cell.** Dice (`diceThrown`, `diceSides`,
  `damageBonus`) and Alt. Dice (the same triple for launcher ammo) each render as one `XdY+Z` join
  (`binary/src/itm/ability-layout.ts`). Those are three separate fields each, so the fold is presentation only.
  The effect's Dice Thrown/Dice Sides pair is different: it is one dual-purpose field pair that does NOT fold (see
  Effect layout below).

### Effect layout = wire byte order, no semantic panel titles

`effectBodyRows` lays fields in on-disk (wire) byte order, matching the spec, with NO semantic panel titles. A
run of plain fields becomes a full-width 2-column panel (the wide L-tier opcode / timing / variable controls
need the full width); each bitfield and each labelled subgroup becomes its own content-width (`fit`) box at its
byte position; consecutive boxes pack side by side into one wrapping row (ragged box heights are fine). The
probability pair folds into one labelled cell (a `join`): Probability (`<p2> - <p1>`). EFF v2 adds single-column
subgroup boxes (Save Info, Classification, Parameters, Resources, Coordinates, Parent Resource); a subgroup box
may also carry a `{ flags }` member that renders as a flag-checkbox table inside the same legend box (EFF v2
Parent Resource Flags). These foldings / boxes are intentional - the label overrides still name the underlying
fields in the model. EFF v2 leads its trailing box run with the Resistance/Save Type flag pair side by side
(matching the v1 feature block) and pulls `timeApplied` to the end of the trailing plain run.

- The 0x1c/0x20 dword pair is dual-purpose: a Maximum/Minimum Level range for most opcodes, Dice Thrown/Dice
  Sides for a few (12/17/18/331/333, 218 when param2=1). It is spec-named `maxLevel`/`minLevel` in the feature
  block and `diceThrown`/`diceSides` in the EFF body, but it is ONE field - so it does NOT fold; it renders as
  two standalone fields whose default label is the level reading, flipped to the dice reading per opcode by the
  `ie-effects` overlay (just as parameter1/parameter2 are relabeled). Both spec names get a label override to
  the level default; the overlay owns the dice exception.
- Records carry different fields, so each passes its own ordered list: only EFF v2 has coordinates / trailing
  subgroups; EFF v1's `resistance` / `savingThrowType` are plain values (no flag table), so they are plain
  fields - faithful, not divergence.

### Flag boxing: box when sharing a panel, bare when sole

A flag block that SHARES a panel with other blocks gets its own titled inner box (fieldset + legend) so the
bitfield reads as one set (ITM General Flags in the Identity panel, an effect's Save Type / Resistance beside
its fields). A flag block that is the SOLE content of a titled panel takes NO inner border and leans on the
panel's chrome (CRE Flags, SPL Flags). The schema declares no such property: `LayoutRenderer.svelte` derives it
from the panel (a titled panel whose only block is the flag block renders it bare), so authoring the panel is
the whole decision - don't second-guess it in CSS. One flag block with an inner border and another without is
this share-vs-sole rule, not an inconsistency.

- **Category-grouped flags** (`flagGroups` block): when a field's meaningful groupings cross wire byte
  boundaries, regroup by SEMANTIC CATEGORY, not storage byte (ITM "Unusable By" -> Alignment / Class / Race;
  "Unusable By Kit" -> per base class). Each category is its own boxed subgroup; a large category splits into
  balanced sub-columns. Intentional, not divergence from the per-byte FlagColumns treatment.

### Hex display for type-encoded IDs

Declare hex (not decimal) for a numeric field that packs `(type << 24) | index` - hex makes the type nibble
legible and stops the master list showing indistinguishable big decimals: MAP `FID` / `PID`, PRO
Inventory/Head/Male/Female `FRM ID`. A plain index (the PRO header `frmId`) stays decimal.

### External references come from the spec

What a field's value or bits point at outside the file (`ref`, `slotRef`, `flagsRef`) is declared on the SPEC,
not in the layout, and the rules for declaring one are in [binary/INTERNALS.md](../binary/INTERNALS.md) (External
references). The render layer sees only what the host resolved from those declarations: `row.strrefText`,
`row.enumOptions`, `row.openTarget`, `row.thumbnail`, `row.refExt`, `row.flagBitNames`, `row.animationTarget`,
`row.gradientColors`.

### Faithful raw bytes; faithful labels

- **Raw bytes verbatim.** Resref / string fields show their stored bytes; a field holding non-printable bytes
  renders as mojibake (SPL Completion Sound, some EFF Parent Resource). Faithful display is preferred over
  prettifying; the model round-trips the raw bytes. Consistent across formats, not a per-field codec bug.
- **Generic indexed labels for game-specific slots.** The format is game-agnostic, so a slot whose name differs
  across games (CRE proficiencies 9-20) shows "Proficiency N", not one game's guess. Faithful to the format,
  not an unfinished label.
- **PRO single-field property panels.** Every PRO object type gets its own titled `<Type> Properties` panel for
  cross-subtype consistency even when it holds a single field (tile -> Material). The panel is `fit` so it
  shares the Header row; a lone-field panel is this parallel-subtype rule, not a stranded panel.

## Render layer

What a writer in the Svelte webview must honour.

### Field-presentation features cover every block renderer, through one shared layer

Fields render through MULTIPLE components under `client/src/binary-editor/webview/components/`:
`Field.svelte` (kv/detail forms, also used by `FormSection.svelte` and `InlineList.svelte`),
`blocks/FieldsBlock.svelte` (packed titled boxes), `JoinedField.svelte` (a `join` folded into one row),
`blocks/GridBlock.svelte` (label+control grids), `blocks/MatrixBlock.svelte` (2D matrices) and
`blocks/FlagColumns.svelte` (one bitfield), with `CellControl.svelte` as the shared control dispatcher underneath.
A per-field presentation property (a tooltip, a range hint, a diagnostic/advisory, a link affordance) added to ONE
of these renderers is a defect unless every other renderer either also gets it (via one shared helper/component,
never per-block copies) or is explicitly declared N/A with the reason. A field's presentation must not depend on
which block kind the layout schema happened to place it in.

Two shared layers carry it. Everything the CONTROL draws - the strref line, the range tooltip, the gradient
picker - is in the control components `CellControl` dispatches to. Everything drawn BESIDE the control - picture,
open chip, animation chip, jump chip, diagnostic marker and quick fix - is `FieldAffordances.svelte`, which every
renderer draws beside the value, and the doc link is `DocLink.svelte` beside whatever names the field. The
read-only reason for a locked row is `readOnlyTitle` in `state/controls.ts`. Guarded per renderer by
`client/test/binary-editor/webview/field-affordances.test.ts`.

Where the renderers place them differs only as far as their shape forces:

- A **grid** slot label that is itself the jump link (a CRE item slot) draws no second jump chip.
- A **matrix** row label names the row, not a cell, so each cell's doc link and affordances sit between the label
  and the cells. The label is the only flexible track, so they shorten it (ellipsized, full text in its tooltip)
  and never move a value column.
- A **join** puts each part's doc link in its shared label and the parts' affordances after the whole run.
- A **flag** field's affordances sit beside whatever names it: its own legend when boxed, the panel title when it
  is the sole block of a titled panel, the group legend when it is a group's `flagsField`.
- Matrix, join, legend and panel-title placements are compact: the quick fix shows its icon and names itself in
  its tooltip.
- `FlagGroups.svelte` is N/A: it regroups bits of several fields under category legends and never draws a field's
  name, so there is nothing to put a row affordance beside. `SpellbookBlock` and `EffectTreeBlock` draw no field
  row of their own; their detail panes render through the renderers above.

The per-row affordances this rule covers, each keyed off one row property:

- **Documentation link** - `row.docUrl` renders `DocLink.svelte`, a `?` beside the label whose tooltip repeats
  the field's `description`.
- **Open chip / picture** - `row.openTarget` and `row.thumbnail`; see the two sections below.
- **Animation chip** - `row.animationTarget` renders `AnimationLink.svelte`, which opens the animation gallery on
  that creature animation id. Set whenever a game is open, including for an id no table names.
- **Jump link** - `row.link` (set by a relationship overlay) renders `JumpLink.svelte`, navigating to the
  referenced entry in its own list.
- **Gradient colour picker** - `row.gradientColors` turns `NumberField.svelte` into swatches plus a picker over
  the install's gradient table, fetched through `state/gradient-table-context.ts`.
- **Diagnostics** - the validate pass and each relationship overlay's `constraints` (dangling cross-record
  references, a spellbook over capacity) reach the webview as `Diagnostic[]`. `App.svelte` summarises them in a
  banner, and `FieldAffordances.svelte` marks a field's own beside its control, with the first quick fix as a
  button.

### Resolved strrefs: idle text in roomy controls, tooltip in dense ones

A field whose spec declares `ref: { kind: "strref" }` carries the host-resolved `dialog.tlk` line in
`row.strrefText` when the record was opened from an installed game. `NumberField.svelte` renders it with the hex
field's wrapper shape - a dimmed static span holding the number beside a borderless input holding the line,
chromed as one control (tier ML, line ellipsized), so the eye lands on the text rather than the number. Focus
hides the span and swaps the input to the bare number, so what you edit is what is stored and the value is never
shown twice; the title carries the full line. A record outside a game has no `strrefText` and renders an
ordinary number.

The `compact` prop on `CellControl` is the declared N/A for the shared-layer rule above: it keeps the number in
the cell and moves the line to the tooltip. `MatrixBlock` and `JoinedField` set it - a matrix cell and a join part
are fixed small boxes with no room to grow.
A grid is NOT compact: it shows the line like any other form, which works because a grid sheds columns rather
than overflowing (see Grids).

### Resolvable resrefs get an open chip; unresolvable ones get nothing

A field the spec marks `{ kind: "resource" }` carries `row.openTarget` when the OPEN GAME actually has the
resource - the host takes the declared type (or this game's `byFlavour` override) and asks only whether it is
there. A `{ kind: "deferred" }` resref never resolves, so it renders bare. `OpenResourceLink.svelte` renders a
`-> <ext>` chip beside the value, styled as `JumpLink` (which navigates WITHIN the record; this opens a
different resource entirely, via a host command so the binary-vs-default editor choice stays in one place).

Absent `openTarget` renders NOTHING - no marker, no dimming, no advisory. That is deliberate and must stay:
a mod record legitimately references what a later install step creates, so flagging it would fire on correct
input. Per the shared-layer rule above, the chip is rendered by `FieldAffordances.svelte` in every renderer -
and SUPPRESSED on a row that also carries a picture, which becomes the link instead (see the picture section
below; the decision is `showsOpenChip`, never an inline condition in a renderer).

**A NUMERIC field can carry the chip too, and it is not a resref.** Where an `{ kind: "ids" }` ref declares
`symbolResource`, the value's symbol in that table IS a resref - PROJECTL.IDS's symbols are `.PRO` basenames -
so an ability's projectile offers to open the projectile file while staying a numeric dropdown. The chip is
keyed off `row.openTarget` alone, so nothing in the render layer needs to know which of the two produced it.
The pairing sets `openTarget` ONLY, never `refExt`: `refExt` turns a field into a resref picker, which would
be wrong for a field whose value is a number chosen from a named list.

### A resolvable picture draws inline, in a box that never changes size

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

### A resref field is a picker with a game, and the list is a suggestion set - never the domain

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
it is given, so the cap is what keeps a list of thousands of resrefs from mounting a node per entry; keep the
notice if you touch it - a silently truncated list reads as a complete one.

The `Combobox` is not this panel's control: it lives in `client/src/webview-ui/`, shared with other panels, and
the headers of `primitives.css` and `base.css` there say how a panel links its styles.

### Field width: a small display-width tier scale

Value controls map to a small fixed set of widths by DISPLAY width (characters rendered), not byte size.
`controlWidthClass` in `state/controls.ts` is the one classifier every renderer applies, and the ch widths live in
`styles.css`. Text inputs (number / string / hex) take a four-step `tier-{s,m,ml,l}` scale via `valueTier`; enums
take a six-step `dd-1..dd-6` scale via `dropdownWidth`; resref pickers take a dropdown box sized from the field's
char capacity. The comments at those definitions carry the boundaries and why each exists.

- **A text tier is sized to the field, never the value.** A decimal's tier follows its integer's byte width, a
  string's its char capacity, a strref's its `ref` - so a value change cannot clip or widen, and siblings of one
  field in a grid come out equal.
- **A dropdown is sized to its OWN longest option**, value-prefixed as the trigger renders it, measured in ch via
  canvas and quantized. It does not inherit the text tier of the column it shares, which would leave every enum
  as wide as the widest hex or resref input beside it. Every enum is a searchable `Combobox`; its width comes
  from its options alone.
- **A dropdown looks roomy beside a SHORT current value.** That is the off-the-longest-option contract, not a
  defect: changing the selection never clips, and dropdowns still align with each other.

### Column alignment

A tier sets only a control's right edge. The value track is `auto`, so it sizes to the widest control in its
column, and every control left-aligns in its track. A control narrower than its track therefore leaves empty
space to its right. INTENTIONAL: left edges stay aligned.

### Grids: the schema's column count is a maximum

`GridBlock` is multi-column (`column-count` from the schema as a cap, a measured `column-width` as the
minimum), so it sheds columns instead of overflowing; raising the schema's count is safe but does not guarantee
that many columns. Sizing cannot be declared here: a cell is a label plus a tier-sized control, and with a game
open a CRE sound slot's label comes from the game's IDS table and runs far longer than the schema's generic
"Sound 12". The fit is measured in `GridBlock.svelte`, whose comment says how.

A grid cell consumes `--val-ch` exactly like the kv forms. Do NOT add `min-width: 0` to a grid control (the kv
rules have it): the control track is `auto`, so a shrinkable control lets the track shrink with it and the value
clips.

Guarded at two viewports by `render-cre.mts`. The harness has no game, so it exercises the narrow-panel case
rather than the long-label one; both are "content wider than the panel".

### Multi-column fill: column-major (top-down first)

A multi-column group fills column 1 top-to-bottom, then column 2, ... - NOT left-to-right across rows. Reading
order runs DOWN each column. Holds for the scalar fields grid (`FieldsBlock.svelte`, `grid-auto-flow:column` +
a fixed row count), the flat label/control grid (`GridBlock.svelte`), and flag grids
(`FlagColumns.svelte` / `FlagGroups.svelte`). Exception: `MatrixBlock.svelte` (CRE stats / proficiencies) is a
true 2D matrix - nothing to fill column-major. Guarded by the ITM/CRE render harnesses ("fills top-down first").

### Uniform spacing: one inter-column / inter-block gap

The gap between a multi-column grid's columns and the gap between adjacent blocks in a panel are the SAME
spacing, both driven by one CSS variable (`--bb-col-gap` on `.layout-root`, consumed by `.kv-multi`,
`.panel-blocks` and `.grid`). Reuse that variable for any new multi-column / multi-block layout; never mint a
fresh gap value. Guarded by the ITM harness ("inter-block gap equals inter-column gap").

### Flag groups (render)

A flag field renders full-width below the scalar key-value grid, not as a value-tier member. Boxed-vs-bare
follows the share-vs-sole rule under Flag boxing, above.

**A bit can be named by the install, and only a SHARED bit is relabelled.** Where the spec declares `flagsRef`,
the host resolves the kits the open game maps onto each bit into `row.flagBitNames` - a LIST per bit, because the
relation is many-to-one. `FlagGroups.svelte` leaves a bit the install claims for one kit exactly as it was: the
vendored label already names it, and more tersely than the game's own string (a "Cleric" subgroup shows "Talos",
not "Priest of Talos"). A bit several kits share cannot be named after any one of them, so it takes a group label
with the kits listed in its `title`. Do NOT "improve" this into naming every bit from the game - it would undo
the deliberate terse labels and, on a shared bit, pick an arbitrary winner.

`FlagColumns.svelte` is the declared N/A for the shared-layer rule: no field it renders declares `flagsRef` (ITM
kit usability is the only one, and it renders only through `flagGroups`), so there is nothing for it to resolve.
Wire it the same way if a second bitfield ever declares one.

### Nested-group detail uses stacked headed sections

An auto-form detail with sub-groups (e.g. a MAP object's Object Data / Subtype Data) renders each group as its
own titled section, stacked vertically (`.subgroup` + `<h4>` title) - not a tab strip. The scalar fields sit
above the sections. (The childList - a MAP object's Inventory - is separate; see `ListEntryDetail`.)

## Reviewing a rendered screenshot

Render with the harness (see `binary-editor/test/harness/README.md`), then check the screenshot against the
per-layer rules above. Two checks catch what reading the code does not:

- Read the actual text in every label / header / cell - text clipped to an ellipsis is a width defect to fix,
  not chrome.
- Scan the WHOLE surface (every panel / tab / variant), not just the area changed.

The intentional patterns that must not be flagged are listed in `binary-editor/AGENTS.md`, each with its reason
in the sections above; what the harness itself leaves in a screenshot is in the harness README.
