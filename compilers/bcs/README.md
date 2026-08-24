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
- **It does not name fields.** The argument lists are fixed - a trigger takes 7 arguments and an action 10,
  and an object is EA plus six enumerated fields plus a five-slot identifier chain - but which field a given
  number is depends on the engine: Torment gives an object two more, and the spec places a coordinate pair
  on every engine but BG1. So a record holds its numbers as a list, and naming them is left to a layer that
  knows the engine, which the file itself does not say.

## The round trip

`writeBcs(readBcs(text)) === text` for every script in a stock BG:EE plus BG2:ToB pair (4939 files, plus the
mod scripts under `external/`). The spacing is not uniform - an object writes a space before its quoted field
and none after, a trigger writes one on both sides of its pair, an action writes none before the first - so
it is reproduced from each record's kind rather than carried on the tree, and an edited script comes back out
looking like one the game wrote.

Two things the sweep found that a hand-built fixture would not: a script that is present but empty
(`SC`/`SC`) is not the same as a file with no bytes in it, and an older writer omits a record's quoted fields
entirely rather than writing a pair of empty ones.

## Where a real install disagrees with the spec

The format reference is [IESDP's bcs.htm](https://iesdp.bgforge.net/file_formats/ie_formats/bcs). Four places
where a stock BG:EE plus BG2:ToB pair does not match what it says, each measured over the whole corpus:

| Spec says                                                                            | The corpus has                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trigger's seven arguments are "always specified ... even if they are not all used" | 59 triggers across 20 files stop after two numbers and write no strings; 51 actions across 22 files write their numbers and no strings. All are BG1-era generic AI scripts (`MONSTER`, `NPC`, `GANIMAL`, `R*`, `G*`, `D*`) that ship in BG2:ToB |
| Object coordinates are present on every engine but BG1                               | No object carries any. All 393991 of them are exactly twelve numbers - EA, six enumerated fields, five identifier slots - with no `[x.y]` anywhere and not one negative value, where an unused coordinate is documented as `-1`                 |
| A response is "the concatenation of a probability and an ACTION"                     | Responses hold 0 to 162 actions. Only 15402 of 35681 hold exactly one, and 28 files have a response with none                                                                                                                                   |
| The response set block is written `RS`, responses, end                               | It closes with a second `RS`, which the spec's listing omits. Every file in the corpus does this                                                                                                                                                |

Where the spec is right and the reader relies on it: the fixed argument lists, the block nesting, the
string-concatenation rule for actions taking more than two strings (an `Area` of exactly six characters
followed by a `Name`), and Torment's two extra object fields.

## Known gap

An object's coordinate field is written as a point - `[x.y]`, brackets and a dot, unlike the point inside an
action which is two plain numbers. The reader refuses such a line by name rather than guessing at it, because
nothing in a BG-family install has one to verify a reading against. If a Torment or Icewind Dale corpus turns
up, that is the first thing to check.

## Tests

```bash
pnpm exec vitest run --config compilers/bcs/vitest.config.ts

# The install sweep, which needs a game to point at - see test/corpus.test.ts
BGFORGE_BCS_CORPUS=/path/to/game pnpm exec vitest run --config compilers/bcs/vitest.config.ts corpus
```
