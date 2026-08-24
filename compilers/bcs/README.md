# @bgforge/bcs

A codec for Infinity Engine compiled scripts (`.bcs`, and the `.bs` AI-selection scripts, which are the same
format). Reads one into a tree and writes it back byte for byte.

Workspace-internal and unpublished: it exists to be built on, by the script view and by a BAF back end.

## BCS is not bytecode

A `.bcs` is plain ASCII. Nested two-letter block markers with numeric and quoted fields between them:

```
SC
CR
CO
TR
16399 0 0 0 0 "GLOBALAerieTransform" "" OB
0 0 0 0 0 0 0 0 0 0 0 0 ""OB
TR
CO
RS
RE
100AC
29OB
0 0 0 0 0 0 0 0 0 0 0 0 ""OB
OB
0 0 0 0 0 0 0 0 0 0 0 0 ""OB
OB
0 0 0 0 0 0 0 0 0 0 0 0 ""OB
50 0 0 0 69AC
RE
RS
CR
SC
```

There is no separator between a run of fields and the marker that follows it, which is why `100AC` is a
response weight of 100 followed by its first action's opening marker, and `160OB` is an action id followed by
its first object's. A response with no actions writes `100RE` for the same reason.

## Usage

```ts
import { readBcs, writeBcs } from "@bgforge/bcs";

// BCS is ASCII; latin1 is the byte-preserving decoding of it.
const script = readBcs(readFileSync("aerie.bcs", "latin1"));
script.blocks[0].responses[0].weight = 50;
writeFileSync("aerie.bcs", writeBcs(script), "latin1");
```

## What it deliberately does not do

- **It does not resolve names.** A trigger or action is stored as a number, and which name that number has
  depends on the `TRIGGER.IDS` and `ACTION.IDS` the player's install ships - editions and mods both change
  them. Resolution belongs to a layer that holds a game; keeping it out is what lets this read a file with
  no install present.
- **It does not name fields.** A record's field count is engine-dependent: an object carries 12 numbers on
  one engine, 13 or 14 on another, and triggers and actions carry between two and eight. So a record holds
  its numbers as a list. Naming them needs to know the engine, which the file does not say.

## The round trip

`writeBcs(readBcs(text)) === text` for every script in a stock BG:EE plus BG2:ToB pair (4939 files, plus the
mod scripts under `external/`). The spacing is not uniform - an object writes a space before its quoted field
and none after, a trigger writes one on both sides of its pair, an action writes none before the first - so
it is reproduced from each record's kind rather than carried on the tree, and an edited script comes back out
looking like one the game wrote.

Two things the sweep found that a hand-built fixture would not: a script that is present but empty
(`SC`/`SC`) is not the same as a file with no bytes in it, and the BG1-era writer omits a record's quoted
fields entirely rather than writing a pair of empty ones.

## Tests

```bash
pnpm exec vitest run --config compilers/bcs/vitest.config.ts

# The install sweep, which needs a game to point at - see test/corpus.test.ts
BGFORGE_BCS_CORPUS=/path/to/game pnpm exec vitest run --config compilers/bcs/vitest.config.ts corpus
```
