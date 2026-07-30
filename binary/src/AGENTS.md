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
- **Declare an opcode-derived target only where every IESDP page for the opcode agrees on one.** Numbers were
  reused between editions (283 is Float Text canonically and Use EFF File (Cursed) on the EE), and some pages
  name two targets at once ("the BAM/VVC"). Resolving against the wrong namespace is worse than leaving the
  field bare, so those stay out of the table and are listed in `OPCODE_RESOURCE_UNRESOLVED` with the reason.
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
