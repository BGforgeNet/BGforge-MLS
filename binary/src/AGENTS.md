# @bgforge/binary - declarative layout authoring conventions

Applies when authoring the DECLARATIVE LAYOUT for a binary format - the `*/layout-schema.ts` files,
`ie-common/effect-layout.ts` / `feature-block-layout.ts`, the per-format ability fragments, and the
presentation schema. **Skip this for parser / codec / spec-data work** - it is only about how a parsed record
is _presented_. The _render_ conventions (width tiers, spacing, column-major fill) live in
`client/src/binary-editor/webview/AGENTS.md`; the holistic review brief + fuller rationale in
`docs/binary-editor-ui-guidelines.md`.

## One shared fragment per record - same record renders identically

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

## Effect layout = wire byte order, no semantic panel titles

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

## Stable layout: reserve only the column that is relabeled at runtime

The effect detail's opcode overlay rewrites a few labels per opcode: `parameter1` / `parameter2` ("Statistic
Modifier", "Slot Amount Modifier", ...) and the dual-purpose 0x1c/0x20 pair (Maximum/Minimum Level <-> Dice
Thrown/Dice Sides). Those are the ONLY fields that mutate. So emit `labelReserve` on the fields block (see the
`fields` block schema) listing each relabeled field a run holds with its OWN reserve width (params 18ch, the
level/dice pair 13ch). The renderer floors each column to the max width among ITS reserved fields - so when
parameters (col 1) and the level/dice pair (col 2) share a block, col 2 floors to 13 and does not inherit the
18ch parameter reserve. Every column without a relabeled field hugs its static labels.

- Do NOT reserve a width for static columns (they never change), and do NOT use a single blanket fixed label
  width across the whole panel - that strands short static labels far from their values.

## Flag boxing: box when sharing a panel, bare when sole

A flag block that SHARES a panel with other blocks gets its own titled inner box (fieldset + legend) so the
bitfield reads as one set (ITM General Flags in the Identity panel, an effect's Save Type / Resistance beside
its fields). A flag block that is the SOLE content of a titled panel takes NO inner border and leans on the
panel's chrome (CRE Flags, SPL Flags). Set the `boxed` prop accordingly (`boxed=false` for sole-in-panel). One
flag block with an inner border and another without is this share-vs-sole rule, not an inconsistency.

- **Category-grouped flags** (`flagGroups` block): when a field's meaningful groupings cross wire byte
  boundaries, regroup by SEMANTIC CATEGORY, not storage byte (ITM "Unusable By" -> Alignment / Class / Race;
  "Unusable By Kit" -> per base class). Each category is its own boxed subgroup; a large category splits into
  balanced sub-columns. Intentional, not divergence from the per-byte FlagColumns treatment.

## Hex display for type-encoded IDs

Declare hex (not decimal) for a numeric field that packs `(type << 24) | index` - hex makes the type nibble
legible and stops the master list showing indistinguishable big decimals: MAP `FID` / `PID`, PRO
Inventory/Head/Male/Female `FRM ID`. A plain index (the PRO header `frmId`) stays decimal.

## External references are declared on the spec, never inferred from a description

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
- **`tables` is an ordered candidate list, and the order does real work.** It is not only preference ranking:
  it is how one declaration resolves across editions that disagree, since only one candidate exists in a given
  install. BG1 and BG2 disagree on most sound slots (slot 35 is SELECT_ACTION4 in one, SELECT_RARE in the
  other), a single install can ship both, and mods extend them - so declare `["SNDSLOT", "SOUNDOFF"]` and let
  the install decide. Do NOT vendor a name table.
- **The library resolves nothing.** Resolution needs a game and is per-install, so it stops at the declaration;
  a consumer holding the game resolves it (`Game.ids()`, `Game.tlk()`). This is also what keeps a parsed record
  and its JSON snapshot identical whether or not a game is open. `slotLabels` remains the game-agnostic
  fallback for a record opened outside a game.
- **A vendored `enum` and an `ids` ref coexist; the ref does not replace the table.** The vendored table is what
  a record opened OUTSIDE a game falls back to, so it stays; with a game open the install's own wins per value
  and the vendored one fills what it does not cover. The gap runs both ways - BG2's RACE.IDS carries 82 entries
  against 8 vendored, its SPECIFIC.IDS only 3 against 11. Keep such fields `enumOpen`: the declaration adds
  names, never a closed value set.
- **A vendored table that mirrors an IDS carries the game's identifiers VERBATIM - never humanized.** `HALF_ELF`,
  `MAGESCHOOL_ABJURER`, and `ASSASIN` with the engine's own misspelling. Two reasons: the same field must read
  identically with and without a game (a humanized vendored table beside raw IDS entries mixes two vocabularies
  inside one dropdown), and the identifier is what a script author actually types. Source it from a real install
  or IESDP's IDS listings (`files/ids/<game>/*.htm`), never by inventing an identifier-looking name - where no
  IDS names a value (the `0` unset sentinels), keep a plain editor word so it does not pose as one.
- **Check the table's key space against real stored values before declaring, and use `keyShift` when they
  differ.** A table is not always keyed the way the field stores it: CRE `kit` holds the KIT.IDS key in the
  dword's high word (0x4003 KENSAI -> 0x40030000), so it declares `keyShift: 16`. Establish this from a corpus,
  not from the vendored table - the vendored `CreKit` places Barbarian at 0x4000, a value no CRE in the
  4020-record BG2 corpus holds, while 19 of the 20 values that DO occur are exactly `key << 16`. A consumer
  drops any key that overflows the field once shifted (KIT.IDS carries two PC-only kits in already-stored form
  that no CRE uses), because offering a value the field cannot hold is worse than leaving it unnamed.

## Faithful raw bytes; faithful labels

- **Raw bytes verbatim.** Resref / string fields show their stored bytes; a field holding non-printable bytes
  renders as mojibake (SPL Completion Sound, some EFF Parent Resource). Faithful display is preferred over
  prettifying; the model round-trips the raw bytes. Consistent across formats, not a per-field codec bug.
- **Generic indexed labels for game-specific slots.** The format is game-agnostic, so a slot whose name differs
  across games (CRE proficiencies 9-20) shows "Proficiency N", not one game's guess. Faithful to the format,
  not an unfinished label.
- **PRO single-field property panels.** Every PRO object type gets its own titled `<Type> Properties` panel for
  cross-subtype consistency even when it holds a single field (tile -> Material). The panel is `fit` so it
  shares the Header row; a lone-field panel is this parallel-subtype rule, not a stranded panel.
