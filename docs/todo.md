# TODO

## `@bgforge/binary`: construction API (file creation from scratch)

Library-level support for building binary files from scratch in TypeScript, alongside the existing
parse / mutate / serialize flow. Built on top of the named-projection canonical-doc shape (see the flag-field,
unnamed-bit and numeric-enum rules under [Architectural rules](../binary/INTERNALS.md#architectural-rules)),
which makes the canonical shape ergonomic enough to serve as both the on-disk JSON form and the
construction-time API surface - no translation layer between them.

### Goal

```ts
import { Item, makeAbility } from "@bgforge/binary";

const item = new Item({ name: "Sulik's Chainsaw" });
item.header.flags.unidentified = true;
item.abilities.add(makeAbility({ type: "melee", damage: 5 }));
item.abilities.add(makeAbility({ type: "ranged", damage: 8, range: 12 }));
const bytes = item.toBytes();
```

Surfacing flags as typed members (`flags.unidentified = true`) is a thin accessor wrapper over the canonical flag-set shape. Sub-record factories
(`makeAbility`, `makeEffect`, `makeHeader`, ...) fill defaults from spec; constructors take a
sparse `Partial<Document>` and merge over defaults.

### Pieces

- **Per-format wrapper classes**: `Item`, `Spell`, `Effect`, `Creature`, `Dialog`, `Pro`, `Map`.
  Constructor takes `Partial<Document>`; defaults filled from `spec/derive-default.ts`. Methods:
  `toBytes()`, `toSnapshot()`, `validate()`. Static factories: `fromBytes(bytes)`, `fromSnapshot(json)`.
- **Sub-record factory functions**: `makeAbility(opts?)`, `makeEffect(opts?)`, `makeHeader(opts?)`.
  Plain typed objects with default-merging factories; class-wrapping every sub-record is heavier
  than it earns. Default sub-records already exist for what the binary editor can add - `defaultItmAbility`,
  `defaultSplAbility`, `defaultCreItem`, `defaultIeEffect`, `defaultMapObject` and their siblings, beside each
  format's entity and structure ops - and the factories share one source of defaults with them (see
  Prerequisites).
- **Collection helpers**: `item.abilities.add(opts?)`, `item.abilities.remove(idx)`,
  `item.abilities.move(from, to)`, etc. Backed by the same entity operations the binary editor uses:
  `EntryOpKind` and `applyEntryMutation` in `binary/src/spec/entity-ops.ts`, and each format's `entity-ops.ts`.
- **Validation timing**: construction is permissive (zero-default everything, allow free
  mutation); strict gate runs at `toBytes()` / `toSnapshot()`. Aligns with the existing
  read-permissive-write-strict architectural rule.
- **No Constructs library.** The shallow ownership tree (Item -> Ability -> Effect; Map -> Object
  -> Inventory) does not need scope traversal, aspects, or multi-stage synthesis. Plain
  class-per-format with factory functions for sub-records is the right weight.

### Test surface

`binary/test/construction.test.ts` exercising:

- Round-trip from scratch: `new Item({...}).toBytes()` produces parseable bytes that re-load to
  an equivalent doc.
- Permissive construction with derived-field mismatches getting caught at `toBytes()` time
  (`validateDerivedFields` shape).
- Defaults producing valid bytes for every format without user input beyond the format's
  required-by-engine fields.

### Prerequisites

The flat sorted-array projection for flag fields is in place across every format -
flag fields surface as `string[]` in canonical-doc. The construction API exposes
`item.header.flags.unidentified = true` as a typed-accessor wrapper over that shape, not as
direct inheritance of the canonical shape. For enums and PIDs,
canonical-doc carries raw ints; the construction API can either use the int form
directly (`item.header.frmType = 0`) or wrap a per-format helper that accepts the named string
and resolves it through the field's spec `enum` table. No enum name-to-int helper exists yet. Default-value
derivation (`spec/derive-default.ts`) is the missing piece: today each default sub-record is written by hand
beside its format's entity and structure ops, so the construction API needs one derivation from the spec as the
single source of truth for per-spec defaults.

## `@bgforge/binary`: stable JSON snapshot format specification

The on-disk shape of `*.pro.json`, `*.map.json`, `*.itm.json`, `*.spl.json`,
`*.eff.json`, `*.cre.json` and `*.dlg.json` is its own consumer-facing contract, separate from the
library API. Anyone committing snapshots to version control depends on it,
and the [`actions/binary`](../actions/binary/README.md) GitHub Action checks
parity against committed snapshots in CI. The schema is currently described
informally in [`binary/INTERNALS.md`](../binary/INTERNALS.md) and pinned only
by `createBinaryJsonSnapshot` / `parseBinaryJsonSnapshot` in the library
public-API test, neither of which guarantees the _output JSON shape_ itself.

The library API and the snapshot schema are independent contracts and should
move on independent cadences - a library addition (new exported helper) does
not break committed snapshots, but a snapshot-shape change (renamed field,
restructured groups, switched flag projection) silently breaks every
consumer with committed snapshots even if the library API is unchanged.

### Pieces

- A versioned schema document - `binary/SNAPSHOT-FORMAT.md` or similar - listing
  per-format JSON shape: top-level keys, group structure, flat sorted-array
  layout for flag fields, enum encoding (raw int), header
  fields, canonicalisation rules (key order, number formatting, whitespace).
- The schema version is already embedded: every canonical snapshot carries `schemaVersion: 1`, which each
  format's `canonical-schemas.ts` validates, and binary/INTERNALS.md's rule on unnamed bits says which spec
  changes bump it. What is missing is the reader side - nothing yet accepts a version other than 1.
- A migration policy: a snapshot-shape break is a major release of `@bgforge/binary`
  with a documented migration path; ideally `parseBinaryJsonSnapshot` reads older
  schema versions and upgrades on the fly.
- Golden snapshot fixtures under `binary/test/snapshot-format/` that fail if
  the JSON shape drifts unintentionally, complementing the existing parser
  round-trip tests.

Until this lands, any change to `createBinaryJsonSnapshot` output should be
treated as a breaking change to all snapshot consumers.

## Fallout SSL: argument declarations for signature help

Signature help is wired end to end for Fallout SSL and works, but the data behind it covers almost
nothing. `generateSignatures` (`scripts/utils/src/generate-data.ts`) emits an entry for every item
declaring an `args:` block and skips the rest, and almost no item in `server/data/fallout-ssl-base.yml` or
`fallout-ssl-sfall.yml` declares one - so `server/out/signature.fallout-ssl.json` stays nearly empty while the
completion file built from the same source in the same run covers every function. WeiDU TP2 declares far
more `args` blocks by comparison.

Nothing is broken: the generator, the loader (`server/src/fallout-ssl/provider.ts`) and the LSP
surface all behave correctly. The gap is that the data was never filled in, and because the
pipeline works exactly as written no test or gate reports it.

### Approach

Prefer deriving the argument lists from a source that already carries them - the engine-procedure
JSON the TSSL plugin consumes (`server/out/fallout-ssl-engine-procedures.json`) is the obvious
candidate - and hand-author only the prose. That turns authoring every function into a mapping
pass plus incremental documentation. Authoring `args` by hand, most-used functions first, is the
fallback if no existing source lines up; either way each entry improves the feature the moment it
lands, with no code change.

A coverage assertion over the generated signature file would keep this visible once it starts
moving - nothing reports the count today.
