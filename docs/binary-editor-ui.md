# Binary editor UI

How the binary editor turns a parsed record into what you see, and the conventions that keep it consistent.
Two layers own it, and this document covers both:

- **Schema layer** - `binary/src/*/layout-schema.ts`, `ie-common/effect-layout.ts`, `feature-block-layout.ts`,
  the per-format ability fragments, and the presentation schema. Decides WHICH fields appear, in what order,
  grouped how. Nothing here is about pixels.
- **Render layer** - the Svelte webview under `client/src/binary-editor/webview/`. Decides how a field the
  schema placed is drawn: control widths, column fill, spacing, affordances.

Parser and codec work is a separate concern; see [binary/INTERNALS.md](../binary/INTERNALS.md) for the spec
system and format adapters.

General UI/UX principles - size to content, align columns, legible contrast, don't encode meaning in colour
alone - are assumed. What follows is what is SPECIFIC to this editor, including which apparent oddities are
intentional, so a change doesn't "fix" them and a review doesn't flag them.

## How the layers collaborate: stable layout (worked end-to-end)

The one behavior that spans both layers, and the easiest to get wrong: **editing a field must never shift the
column layout.**

- Value controls use fixed display-width tiers (render), so a longer value never widens its box.
- Labels are static EXCEPT in the effect detail, where the opcode overlay relabels `parameter1` / `parameter2`
  per opcode. ONLY those two fields mutate.
- **Schema side** (`binary/`): `effectBodyRows` emits `labelReserve` on the fields block naming those two
  fields, sized to the common longest label ("Statistic Modifier").
- **Render side** (`client/`): each label column is `max-content` (hugs its own labels); the reserved column is
  floored with `minmax(<reserveCh>ch, max-content)` so it can't jump, while static columns hug. There is NO
  blanket label min-width - a static label like "Opcode" sits tight to its value (the label->value gap must
  read tighter than the inter-column gap, or the value reads as belonging to the next column).
- This replaced an older blanket `labelWidthCh` (one fixed label track for the whole panel, longer labels
  wrapping within it). Guarded by the ITM render harness ("value columns stay put when labels change").

## Schema layer

Authoring conventions for the declarative layout. These are about how a parsed record is PRESENTED, not
about parsing it.

### One shared fragment per record - same record renders identically

A record that appears in more than one format renders through ONE shared layout fragment, never a per-site
generic auto-form, so it looks identical everywhere. Item and spell ABILITIES use per-format fragments
(`itmAbilityBodyRows` / `splAbilityBodyRows`). EVERY Infinity Engine effect renders through one shared builder,
`effectBodyRows` (`ie-common/effect-layout.ts`), via two fragments: the EFF v2 body (264B, `effV2BodyRows`) and
the 48-byte feature block (`featureBlockBodyRows`). The feature block is ONE record - the same 48 bytes IESDP
documents as both the ITM/SPL feature block and the EFF v1 record (`feature_block.yml` points to `eff_v1.htm`
for every field) - so ITM effects, SPL effects, AND a CRE's `effStructureVersion`-0 effects all render through
`featureBlockBodyRows`. Do NOT add a second 48-byte effect spec or fragment; that was a real duplication (a
CRE-local `creEffectV1Spec`), now collapsed into the shared `effectSpec`.

- **Parallel-not-identical is INTENTIONAL.** Where two records genuinely differ, their fragments share ordering
  and controls where the concepts align, and each adds only the fields its own record needs (an ITM ability has
  Damage / Charges panels a SPL ability lacks; SPL has a Casting panel instead). Don't flag as divergence.

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

### Stable layout: reserve only the column that is relabeled at runtime

The effect detail's opcode overlay rewrites a few labels per opcode: `parameter1` / `parameter2` ("Statistic
Modifier", "Slot Amount Modifier", ...) and the dual-purpose 0x1c/0x20 pair (Maximum/Minimum Level <-> Dice
Thrown/Dice Sides). Those are the ONLY fields that mutate. So emit `labelReserve` on the fields block (see the
`fields` block schema) listing each relabeled field a run holds with its OWN reserve width (params 18ch, the
level/dice pair 13ch). The renderer floors each column to the max width among ITS reserved fields - so when
parameters (col 1) and the level/dice pair (col 2) share a block, col 2 floors to 13 and does not inherit the
18ch parameter reserve. Every column without a relabeled field hugs its static labels.

- Do NOT reserve a width for static columns (they never change), and do NOT use a single blanket fixed label
  width across the whole panel - that strands short static labels far from their values.

### Flag boxing: box when sharing a panel, bare when sole

A flag block that SHARES a panel with other blocks gets its own titled inner box (fieldset + legend) so the
bitfield reads as one set (ITM General Flags in the Identity panel, an effect's Save Type / Resistance beside
its fields). A flag block that is the SOLE content of a titled panel takes NO inner border and leans on the
panel's chrome (CRE Flags, SPL Flags). Set the `boxed` prop accordingly (`boxed=false` for sole-in-panel). One
flag block with an inner border and another without is this share-vs-sole rule, not an inconsistency.

- **Category-grouped flags** (`flagGroups` block): when a field's meaningful groupings cross wire byte
  boundaries, regroup by SEMANTIC CATEGORY, not storage byte (ITM "Unusable By" -> Alignment / Class / Race;
  "Unusable By Kit" -> per base class). Each category is its own boxed subgroup; a large category splits into
  balanced sub-columns. Intentional, not divergence from the per-byte FlagColumns treatment.

### Hex display for type-encoded IDs

Declare hex (not decimal) for a numeric field that packs `(type << 24) | index` - hex makes the type nibble
legible and stops the master list showing indistinguishable big decimals: MAP `FID` / `PID`, PRO
Inventory/Head/Male/Female `FRM ID`. A plain index (the PRO header `frmId`) stays decimal.

### External references are declared on the spec, never inferred from a description

A field whose value points outside its file declares `ref: ExternalRef` (`spec/external-ref.ts`) - one union
covering every such source, so a new kind reaches every format by declaration rather than by new plumbing. The
declaration never changes storage, editing, or the byte round-trip; it only tells a consumer what the value can
be resolved against. ITM/SPL strrefs come from the generator (IESDP's own `type: strref`); the hand-written CRE
spec sets its own.

**Two axes, and a field commonly has both.** `ref` resolves a field's VALUE; an array's `slotRef` names its
SLOTS (emitted onto each child as `{ ref, index }`). A CRE sound slot carries each - a strref value and an
IDS-named label - so a consumer applies both in sequence. Handling them as exclusive branches is what silently
dropped the label on exactly the rows the feature exists for; `binary/test/external-refs.test.ts` pins a row
that carries both.

- **Never key display behaviour off description prose.** IESDP writes "(strref)" in some descriptions and not
  others, marks two SPL strrefs `unused` (still strrefs), and documents the same resref field differently
  across formats ("Ground icon (BAM)" in ITM, "Ground icon" in SPL). The declaration is the only reliable
  signal. `external-refs.test.ts` pins the marked set - including that the record's name strref stays at offset
  8, which the resource tree's hover tooltip reads raw.
- **`tables` is an ordered candidate list; a resource `type` is NOT.** The two look alike and are decided
  differently, so keep them apart. WHICH IDS/2DA names a value depends on what the install ships - the tables
  are data files editions differ on and mods add to - so `tables` is probed by presence, EVERY present candidate
  contributing and the earlier one winning a key they both name. BG1 and BG2 disagree on most sound slots (slot
  35 is SELECT_ACTION4 in one, SELECT_RARE in the other), a single install can ship both, so declare
  `["SNDSLOT", "SOUNDOFF"]` and let the install decide; Near Infinity resolves this same field the same way. Do
  NOT vendor a name table. Order ranks authority, it does not select one table: two coexisting tables are as
  often complementary as rival - a projectile field declares PROJECTL first (the game's own index) with MISSILE
  behind it (labels only, and the one table that can name a stored 1), and either alone leaves a chunk of a real
  install's values unnamed. Ordering decides only who wins a key both name, never how many values get named, so
  rank by which table is AUTHORITATIVE, not by which happens to be fuller. Nothing is invented either way -
  every option comes from a table the install holds.
  WHAT a resref points at is not like that: it follows from the record version and the game, both known before
  any lookup, so it is one `type` plus a `byFlavour` exception where a game genuinely differs. Probing types by
  presence picks whichever happens to exist and is wrong wherever both do.
- **The library resolves nothing.** Resolution needs a game and is per-install, so it stops at the declaration;
  a consumer holding the game resolves it (`Game.ids()`, `Game.tlk()`). This is also what keeps a parsed record
  and its JSON snapshot identical whether or not a game is open. `slotLabels` remains the game-agnostic
  fallback for a record opened outside a game.
- **A vendored `enum` and an `ids` ref coexist; the ref does not replace the table.** The vendored table is what
  a record opened OUTSIDE a game falls back to, so it stays; with a game open the install's own wins per value
  and the vendored one fills what it does not cover. The gap runs both ways - BG2's RACE.IDS carries 82 entries
  against 8 vendored, its SPECIFIC.IDS only 3 against 11. Keep such fields `enumOpen`: the declaration adds
  names, never a closed value set.
  This is also the one way a field whose value space must NOT be vendored can still name a value: vendor only
  the keys the tables structurally cannot reach. An ability's projectile leaves every projectile to the install
  (see the "do NOT vendor a name table" rule above) but vendors `AbilityProjectileNone`, the two values below
  both tables' key space - so they cannot go stale against an install or a mod, where a copied projectile list
  would. Keep such a table to exactly those keys; the moment it holds a value a table could name, it is the
  closed list the rule forbids. Which keys qualify follows from the DECLARATION, not from the concept, so two
  fields naming the same thing can need different tables and must not share one: the EFF impact projectile is
  keyed directly where the ability fields are offset by one, so `ImpactProjectileNone` holds only `0` - its `1`
  is a real projectile that the ability pair would mislabel.
- **A vendored table that mirrors an IDS carries the game's identifiers VERBATIM - never humanized.** `HALF_ELF`,
  `MAGESCHOOL_ABJURER`, and `ASSASIN` with the engine's own misspelling. Two reasons: the same field must read
  identically with and without a game (a humanized vendored table beside raw IDS entries mixes two vocabularies
  inside one dropdown), and the identifier is what a script author actually types. Source it from a real install
  or IESDP's IDS listings (`files/ids/<game>/*.htm`), never by inventing an identifier-looking name - where no
  IDS names a value (the `0` unset sentinels), keep a plain editor word so it does not pose as one.
- **Resref targets are hand-declared, never generated.** `{ kind: "resource", type }` names what a resref
  points at, and IESDP is not a usable source for it: the same ground-icon field reads "Ground icon (BAM)" in
  ITM and plain "Ground icon" in SPL, and others say only "Resource". Exactly two fields vary today, both only
  in PSTEE - ITM `replacement` (an ITEM, a drop SOUND there) and CRE `largePortrait` (a BMP, a BAM there) - so
  each declares `byFlavour: { pstee: ... }`. Check the WIDTH before declaring: a resref is `char[8]`, so a
  `char[2]` animation code and a `char[32]` script variable are not resrefs and get none.
- **A resref whose type another field selects is `{ kind: "deferred", reason }`, not left bare.** Bare and
  deferred look identical from outside, so the marker is what makes the absence a decision a completeness
  sweep can read rather than something nobody got to. The three effect resources are ones
  (`EFFECT_RESOURCE_REF`): the opcode picks the target, so no type fits the FIELD. The overlay still resolves
  them per RECORD, where the opcode is visible - the deferral is the spec-level answer, not the final one.
- **A ref the spec cannot know, but a SIBLING field can, is computed by the relationship overlay - not
  deferred.** `deferred` is for a ref nothing can resolve; where another field in the same record names the
  answer, the overlay reads that sibling and emits the ref on `FieldOverride.ref`, which overwrites the row's
  spec-declared one. Three cases live in `binary-editor`'s `ie-effects` overlay, all reading the same
  `OpcodeRelationships` table: `parameter1` is an entry in whichever table `parameter2` selects
  (`idsFileByParam2` -> `{ kind: "ids", tables }`); the effect's own `resource` is typed by the opcode
  (`resourceType` -> `{ kind: "resource", type }`); and `parentResource` is typed by the adjacent
  `parentResourceType`, which is why it is the one effect resref carrying no spec-level deferral. The host
  resolves all three through the SAME path as a declared ref - no second resolver. Each mapping is per opcode
  and transcribed per page (opcode 72 is 0-based where 55/100/175 are 2-based; 178's slot 2 is OBJECT, not
  EA), so never copy one opcode's list to another. Whatever computes such a ref must also list the sibling in
  `dependents`, or the dropdown goes stale the moment the sibling is edited.
- **An opcode number has no engine-neutral meaning, so the table holds one entry per engine reading.** Each
  engine makes a number mean what it likes - 238 is "Stat: Save vs. all" on Icewind Dale and "Death:
  Disintegrate" on BG2/EE - and IESDP writes one page per reading, each carrying the availability matrix that
  says which engines it covers. The unsuffixed `opNNN.html` filename is NOT authoritative (`op025.html` covers
  BG2 alone), so the generator groups pages by `opname` and orders the readings by `ENGINE_PREFERENCE`.
  Resolve with `opcodeReading(opcode, engine)`, never by indexing `OpcodeReadings` - it owns the engine match
  AND the fallback to the preferred reading (BG(2)EE), so the whole editor cannot disagree with itself about
  which reading a record gets. The engine is captured by the SESSION's relationship overlay at open, from the
  open game's flavour - deliberately not stored on the `Model`, which every structure op, undo and JSON load
  rebuilds and would therefore drop it from. A file opened off disk has no engine and takes the fallback.
- **Anything hand-transcribed records the reading it came from** (`ResourceDeclaration.reading`, an override's
  `reading`), because a type or parameter table read off another engine's page describes a different effect.
  The generator THROWS when a curated entry omits it for a multi-reading opcode, rather than attaching it to
  whichever sorted first. Where a reading gives a field no target - or names two at once ("the BAM/VVC") - it
  stays bare and is listed in `OPCODE_RESOURCE_UNRESOLVED` with the reason: resolving against the wrong
  namespace is worse than not resolving.
- **A bitfield whose BITS point outside the file declares `flagsRef`, and the relation may be many-to-one.**
  `ref` says what a field's VALUE means; `flagsRef` says what its BITS mean, and a bitfield can carry both. One
  case today: ITM kit usability, four bytes forming one 32-bit mask that KITLIST.2DA's `UNUSABLE` column is keyed
  by, each byte declaring which quarter it holds (byte 1 is the HIGH one, bits 24-31). Do NOT read it as
  bit-names-a-kit: stock BG2 fills all 32 bits with 31 kits plus a documented "no kit" bit, so the Enhanced
  Editions' extra kits REUSE masks - eight share `0x00004000` - and Blackguard's mask is two bits rather than
  one. A consumer therefore resolves a bit to EVERY kit it covers and must not reduce that to one; the vendored
  `flags` table stays as the no-game fallback, and on classic BG2 it is already the complete answer.
- **A field whose documentation names an IDS/2DA table must declare it or record why not.** Unlike a resref,
  an IDS-backed field is a plain number with no shape to spot, so `binary/test/ids-table-declarations.test.ts`
  sweeps the specs for a `*.IDS`/`*.2DA` mention in the description and requires a declaration or an entry in
  its exclusion map with a reason. Naming a table is not the same as indexing one: an ITM ability's launcher
  type names ITEMCAT.IDS for the WEAPON it requires, not for its own value.
- **A 2DA ref is keyed by ROW INDEX, and not every 2DA can name anything.** `{ kind: "2da" }` resolves the
  stored value as a row position whose row NAME is the identifier (MSCHOOL row 1 is ABJURER). Check the file
  first: `itemtype.2da` deliberately has NO ref, because its rows are numbered `0,1,2...` and its columns are
  TAKESOUND / DROPSOUND / SLOT - it is a sound-and-slot lookup that names nothing, and it ships only with the
  Enhanced Editions anyway. Where a pair of fields shares a table across formats (school / sectype on the SPL
  header, ITM ability and EFF body), declare the ref ONCE as a shared constant so the sites cannot drift.
- **Check the table's key space against real stored values before declaring, and use `keyEncoding` when they
  differ.** A table is not always keyed the way the field stores it: CRE `kit` holds the KIT.IDS key in the
  dword's other half (0x4003 KENSAI -> 0x40030000), so it declares `keyEncoding: { KIT: "swappedWords" }`.
  Keyed PER TABLE, because one declaration's candidates can disagree about it: an ability's projectile stores
  PROJECTL.IDS's key plus one and MISSILE.IDS's key outright, so `PROJECTILE_REF` encodes only PROJECTL
  (`keyEncoding: { PROJECTL: "keyPlusOne" }`) and leaves its co-candidate alone. A table absent from the map is keyed
  exactly as the field stores it. Establish
  this from a corpus, not from the vendored table - the vendored `CreKit` places Barbarian at 0x4000, a value
  no CRE in the 4020-record BG2 corpus holds, while 19 of the 20 values that DO occur are the key with its
  words swapped. Prefer an encoding that is a BIJECTION over one that only fits the common case: a left shift
  matches the swap for every key under 0x10000 and silently pushes the rest off the end of the field, which
  left EE BARBARIAN (0x40000000), WILDMAGE (0x80000000) and eight IWD2 cleric kits permanently unnamed. Near
  Infinity reads this field the same way. A consumer still drops any key that does not fit the field, because
  offering a value the field cannot hold is worse than leaving it unnamed.

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

Fields render through MULTIPLE components: `Field.svelte` (kv/detail forms), `blocks/FieldsBlock.svelte`
(packed titled boxes), `blocks/GridBlock.svelte` (label+control grids), `blocks/MatrixBlock.svelte` (2D
matrices), with `CellControl.svelte` as the shared control dispatcher underneath. A per-field presentation
property (a tooltip, a range hint, a diagnostic/advisory, a link affordance) added to ONE of these renderers
is a defect unless every other renderer either also gets it (via one shared helper/component, never per-block
copies) or is explicitly declared N/A with the reason. A field's presentation must not depend on which block
kind the layout schema happened to place it in.

### Resolved strrefs: idle text in roomy controls, tooltip in dense ones

A field whose spec declares `ref: { kind: "strref" }` (see External references, above) carries the host-resolved
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

### Resolvable resrefs get an open chip; unresolvable ones get nothing

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
it is given, so the cap is what keeps a ~12300-entry BAM list from mounting 12300 nodes; keep the notice if you
touch it - a silently truncated list reads as a complete one.

### A grid fits columns to the panel; the schema count is a maximum

`GridBlock` is multi-column (`column-count` from the schema as a cap, a measured `column-width` as the
minimum), so it sheds columns instead of overflowing. Sizing cannot be declared here: a cell is a label plus a
tier-sized control, and with a game open a CRE sound slot's label comes from the game's IDS table and runs
three times longer than the schema's generic "Sound 12". The measured `--nm-w` (widest label) is applied to
every cell so controls align down a column - the old subgrid cannot span multicol columns - and `--col-w` sums
the widest label and widest control separately, because those two rarely sit in the same cell.

Guarded at two viewports by `render-cre.mts`. The harness has no game, so it exercises the narrow-panel case
rather than the long-label one; both are "content wider than the panel".

### Field width: a small display-width tier scale

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

### A grid cell is sized by its tier, never by its content

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

### Keep columns aligned with fixed grid tracks

A tier sets only a control's right edge, never its left edge or the next column's position. Use fixed grid
tracks sized to the widest tier in each column; left-align every control in its track.

### Multi-column fill: column-major (top-down first)

A multi-column group fills column 1 top-to-bottom, then column 2, ... - NOT left-to-right across rows. Reading
order runs DOWN each column. Holds for the scalar fields grid (`FieldsBlock.svelte`, `grid-auto-flow:column` +
a fixed row count), the flat label/control grid (`GridBlock.svelte`), and flag grids
(`FlagColumns.svelte` / `FlagGroups.svelte`). Exception: `MatrixBlock.svelte` (CRE stats / proficiencies) is a
true 2D matrix - nothing to fill column-major. Guarded by the ITM/CRE render harnesses ("fills top-down first").

### Uniform spacing: one inter-column / inter-block gap

The gap between a multi-column grid's columns and the gap between adjacent blocks in a panel are the SAME
spacing, both driven by one CSS variable (`--bb-col-gap` on `.layout-root`, consumed by `.kv-multi` and
`.panel-blocks`). Reuse that variable for any new multi-column / multi-block layout; never mint a fresh gap
value. Guarded by the ITM harness ("inter-block gap equals inter-column gap").

### Stable layout: columns must not jump on edits

Editing a value (or anything that rewrites a label) must not shift the layout - column positions are fixed by
construction, never derived from runtime content. Value controls use fixed tiers (a longer value never widens
its box). Label columns are per-column `max-content` so each hugs its own labels; the ONE column whose label is
rewritten at runtime (the effect detail's parameter column) is floored with `minmax(<reserveCh>ch, max-content)`
so its value can't jump as the label changes. The schema marks that column via `labelReserve` (see Stable
layout under the schema layer); the renderer honors it in `FieldsBlock.svelte`.

- Do NOT add a blanket label min-width floor. A short static label ("Opcode") must hug its value: the
  label->value gap MUST read tighter than the inter-column gap, or the value visually binds to the NEXT
  column's label (Gestalt proximity). Verify by comparing the two adjacent gaps, not the absolute label gap.
- Guarded by the ITM harness ("value columns stay put when labels change").

### Flag groups (render)

A flag field renders full-width below the scalar key-value grid, not as a value-tier member. Boxed-vs-bare
follows the schema's `boxed` flag (`FlagColumns.svelte`): a flag block sharing a panel gets its own titled inner
box; a flag block that is the SOLE content of a titled panel takes no inner border and leans on the panel
chrome. Don't second-guess that in CSS - the share-vs-sole decision is the schema's (see Flag boxing,
above); render it as marked.

**A bit can be named by the install, and only a SHARED bit is relabelled.** Where the spec declares `flagsRef`
(see External references, above), the host resolves the kits the open game maps onto each bit into
`row.flagBitNames` - a LIST per bit, because the relation is many-to-one. `FlagGroups.svelte` leaves a bit the
install claims for one kit exactly as it was: the vendored label already names it, and more tersely than the
game's own string (a "Cleric" subgroup shows "Talos", not "Priest of Talos"). A bit several kits share cannot be
named after any one of them, so it takes a group label with the kits listed in its `title`. Do NOT "improve"
this into naming every bit from the game - it would undo the deliberate terse labels and, on a shared bit, pick
an arbitrary winner.

`FlagColumns.svelte` is the declared N/A for the shared-layer rule at the top: no field it renders declares
`flagsRef` (ITM kit usability is the only one, and it renders only through `flagGroups`), so there is nothing
for it to resolve. Wire it the same way if a second bitfield ever declares one.

### Nested-group detail uses stacked headed sections

An auto-form detail with sub-groups (e.g. a MAP object's Object Data / Subtype Data) renders each group as its
own titled section, stacked vertically (`.subgroup` + `<h4>` title) - not a tab strip. The scalar fields sit
above the sections. (The childList tab - a MAP object's Inventory - is separate; see `ListEntryDetail`.)

## Reviewing a rendered screenshot

Render with the harness (see `binary-editor/test/harness/README.md`), then check the screenshot against the
per-layer rules above PLUS:

- Read the actual text in every label / header / cell - text clipped to an ellipsis is a width defect to fix,
  not chrome.
- Scan the WHOLE surface (every panel / tab / variant), not just the area changed.
- The intentional patterns named above are NOT defects - do not flag a roomy dropdown, a
  control narrower than its track, a bare-vs-boxed flag difference, a folded Dice / Probability cell, mojibake
  in a raw-byte field, a lone-field PRO panel, or an effect with no semantic panel titles.

### Harness-render artifacts (NOT defects)

- The large empty area at the bottom of some screenshots is the harness's tall capture viewport.
- `shot-primitives.png` is a standalone primitives gallery (raw controls), not the dense field layout - the
  tier sizing does not apply there.
- Screenshots are captured at a reduced device scale (so tall forms stay under the readable image-size limit);
  minor softness is expected.
