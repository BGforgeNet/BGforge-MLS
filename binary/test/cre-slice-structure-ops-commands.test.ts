/**
 * Model-based (fc.commands) test for the owner+slice structure ops (ie-common/slice-structure-ops.ts),
 * driven through their only binding: CRE spell memorization.
 *
 * The per-operation cases in cre-entity-ops.test.ts each start from a pristine document. The editor does
 * not: it applies a sequence of structure ops, re-parsing its own output each time. This drives random
 * sequences of the owner and slice ops and re-checks, after EVERY command, the invariants a save depends
 * on:
 *
 *   1. Round-trip - the emitted bytes re-parse without error, and the owners with the slices their ranges
 *      cover equal the nested model the sequence predicted, in order.
 *   2. No dangling reference - every owner range stays inside the slice array, no two ranges overlap, and
 *      no slice is left uncovered.
 *
 * The ops relink surgically because owner order and physical slice order are not guaranteed to agree
 * (the module header names the two real fixtures that diverge), which is exactly what a sequence of edits
 * against one accumulating document can break and a single-op test cannot see.
 */

import fs from "node:fs";
import path from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../src/cre/canonical-reader";
import {
    buildCreDuplicateEntryBytes,
    buildCreInsertEntryBytes,
    buildCreMemorizeBytes,
    buildCreMoveEntryBytes,
    buildCreRemoveEntryBytes,
} from "../src/cre/entity-ops";
import { CRE_GROUP_LABELS } from "../src/cre/types";
import type { ParseResult } from "../src/types";
import { REPO_ROOT } from "./repo-root";

// A real BG2 mage with memorized spells at several levels and capacity-only rows at others, so both the
// populated and the empty owner range are exercised. Same fixture as cre-memorize.test.ts.
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const hasFixture = fs.existsSync(FIXTURE);

const OWNER_SECTION = [CRE_GROUP_LABELS.spellMemInfo];
const SLICE_SECTION = [CRE_GROUP_LABELS.memorizedSpells];

type CreDoc = NonNullable<ReturnType<typeof getCreCanonicalDocument>>;

function docOf(pr: ParseResult): CreDoc {
    const doc = getCreCanonicalDocument(pr) ?? rebuildCreCanonicalDocument(pr);
    if (!doc) throw new Error("no CRE document");
    return doc;
}

const ownersOf = (doc: CreDoc) => doc.spellMemInfo;
const slicesOf = (doc: CreDoc) => doc.memorizedSpells;

const NUL = String.fromCodePoint(0);

/** A resref is a fixed-width field, so an empty one round-trips as trailing padding rather than as "". */
const resref = (value: string): string => value.split(NUL)[0]!.trimEnd();

/** Owners with the slices their range covers: what a save must preserve, whatever the physical order. */
function project(doc: CreDoc): string[][] {
    const slices = slicesOf(doc);
    return ownersOf(doc).map((o) =>
        slices
            .slice(o.firstMemorizedSpellIndex, o.firstMemorizedSpellIndex + o.memorizedSpellCount)
            .map((s) => resref(s.spell)),
    );
}

function checkInvariants(doc: CreDoc): void {
    const total = slicesOf(doc).length;
    const covered = new Set<number>();
    for (const owner of ownersOf(doc)) {
        const start = owner.firstMemorizedSpellIndex;
        const end = start + owner.memorizedSpellCount;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(total);
        for (let i = start; i < end; i += 1) {
            expect(covered.has(i)).toBe(false);
            covered.add(i);
        }
    }
    expect(covered.size).toBe(total);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Real system under test: the parse result the editor re-derives from its own emitted bytes. */
interface Real {
    pr: ParseResult;
    doc: CreDoc;
}

/** Abstract state: the nested owner -> slice view, which is also what preconditions gate on. */
interface Abstract {
    owners: string[][];
}

type Cmd = fc.Command<Abstract, Real>;

/** The default slice `buildCreMemorizeBytes` appends carries an empty resref. */
const NEW_SLICE = "";

function sync(m: Abstract, r: Real): void {
    m.owners = project(r.doc);
}

/** A command whose `run` applies one op, re-parses, then re-checks both invariants against the prediction. */
function command(
    label: string,
    check: (m: Abstract) => boolean,
    build: (r: Real) => Uint8Array | undefined,
    predict: (before: string[][], r: Real) => string[][],
): Cmd {
    return {
        check,
        run(m: Abstract, r: Real): void {
            const expected = predict(project(r.doc), r);
            const bytes = build(r);
            expect(bytes).toBeDefined();
            const next = creParser.parse(bytes!);
            expect(next.errors ?? []).toEqual([]);
            r.pr = next;
            r.doc = docOf(next);
            checkInvariants(r.doc);
            expect(project(r.doc)).toEqual(expected);
            sync(m, r);
        },
        toString: () => label,
    };
}

const pick = (length: number, at: number): number => at % length;

/** Flat index of an owner's slice `offset`, which is what the slice ops address. */
function flatIndex(r: Real, owner: number, offset: number): number {
    return ownersOf(r.doc)[owner]!.firstMemorizedSpellIndex + offset;
}

/** Owners that hold at least one slice - the ones the slice ops can act on. */
const populated = (owners: string[][]): number[] => owners.flatMap((o, i) => (o.length > 0 ? [i] : []));

function addOwner(): Cmd {
    return command(
        "addOwner()",
        () => true,
        (r) => buildCreInsertEntryBytes(r.pr, OWNER_SECTION, ownersOf(r.doc).length - 1, "after"),
        (before) => [...before, []],
    );
}

function removeOwner(at: number): Cmd {
    return command(
        `removeOwner(${at})`,
        (m) => m.owners.length > 1,
        (r) => buildCreRemoveEntryBytes(r.pr, OWNER_SECTION, pick(ownersOf(r.doc).length, at)),
        (before) => before.filter((_, i) => i !== pick(before.length, at)),
    );
}

function moveOwner(at: number, direction: "up" | "down"): Cmd {
    const indexIn = (length: number): number => (direction === "up" ? 1 + (at % (length - 1)) : at % (length - 1));
    return command(
        `moveOwner(${at}, ${direction})`,
        (m) => m.owners.length > 1,
        // Anchored away from the boundary the direction cannot cross: a boundary move is a documented
        // no-op returning undefined, which `command` reads as a failure.
        (r) => buildCreMoveEntryBytes(r.pr, OWNER_SECTION, indexIn(ownersOf(r.doc).length), direction),
        (before) => {
            const index = indexIn(before.length);
            const other = direction === "up" ? index - 1 : index + 1;
            const next = [...before];
            [next[index], next[other]] = [next[other]!, next[index]!];
            return next;
        },
    );
}

function duplicateOwner(at: number): Cmd {
    return command(
        `duplicateOwner(${at})`,
        (m) => m.owners.length > 0,
        (r) => buildCreDuplicateEntryBytes(r.pr, OWNER_SECTION, pick(ownersOf(r.doc).length, at)),
        (before) => {
            const index = pick(before.length, at);
            return [...before.slice(0, index + 1), [...before[index]!], ...before.slice(index + 1)];
        },
    );
}

function memorize(at: number): Cmd {
    return command(
        `memorize(${at})`,
        (m) => m.owners.length > 0,
        (r) => buildCreMemorizeBytes(r.pr, pick(ownersOf(r.doc).length, at)),
        (before) => {
            const index = pick(before.length, at);
            return before.map((o, i) => (i === index ? [...o, NEW_SLICE] : o));
        },
    );
}

function removeSlice(at: number, offset: number): Cmd {
    return command(
        `removeSlice(${at}, ${offset})`,
        (m) => populated(m.owners).length > 0,
        (r) => {
            const owners = project(r.doc);
            const index = populated(owners)[pick(populated(owners).length, at)]!;
            return buildCreRemoveEntryBytes(
                r.pr,
                SLICE_SECTION,
                flatIndex(r, index, pick(owners[index]!.length, offset)),
            );
        },
        (before) => {
            const index = populated(before)[pick(populated(before).length, at)]!;
            const inner = pick(before[index]!.length, offset);
            return before.map((o, i) => (i === index ? o.filter((_, j) => j !== inner) : o));
        },
    );
}

function duplicateSlice(at: number, offset: number): Cmd {
    return command(
        `duplicateSlice(${at}, ${offset})`,
        (m) => populated(m.owners).length > 0,
        (r) => {
            const owners = project(r.doc);
            const index = populated(owners)[pick(populated(owners).length, at)]!;
            return buildCreDuplicateEntryBytes(
                r.pr,
                SLICE_SECTION,
                flatIndex(r, index, pick(owners[index]!.length, offset)),
            );
        },
        (before) => {
            const index = populated(before)[pick(populated(before).length, at)]!;
            const inner = pick(before[index]!.length, offset);
            const o = before[index]!;
            return before.map((entry, i) =>
                i === index ? [...o.slice(0, inner + 1), o[inner]!, ...o.slice(inner + 1)] : entry,
            );
        },
    );
}

function moveSlice(at: number, offset: number, direction: "up" | "down"): Cmd {
    const innerIn = (length: number): number =>
        direction === "up" ? 1 + (offset % (length - 1)) : offset % (length - 1);
    const ownerIn = (owners: string[][]): number => {
        const candidates = owners.flatMap((o, i) => (o.length > 1 ? [i] : []));
        return candidates[at % candidates.length]!;
    };
    return command(
        `moveSlice(${at}, ${offset}, ${direction})`,
        (m) => m.owners.some((o) => o.length > 1),
        (r) => {
            const owners = project(r.doc);
            const index = ownerIn(owners);
            return buildCreMoveEntryBytes(
                r.pr,
                SLICE_SECTION,
                flatIndex(r, index, innerIn(owners[index]!.length)),
                direction,
            );
        },
        (before) => {
            const index = ownerIn(before);
            const o = [...before[index]!];
            const inner = innerIn(o.length);
            const other = direction === "up" ? inner - 1 : inner + 1;
            [o[inner], o[other]] = [o[other]!, o[inner]!];
            return before.map((entry, i) => (i === index ? o : entry));
        },
    );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!hasFixture)("CRE memorization slice ops under sequences of edits", () => {
    const bytes = hasFixture ? new Uint8Array(fs.readFileSync(FIXTURE)) : new Uint8Array();
    const baseDoc = hasFixture ? docOf(creParser.parse(bytes)) : undefined;

    it("starts from a fixture with a consistent, populated partition", () => {
        // Positive control: the sequences below prove nothing if the base has no owner holding slices.
        checkInvariants(baseDoc!);
        expect(populated(project(baseDoc!)).length).toBeGreaterThan(0);
        expect(project(baseDoc!).some((o) => o.length > 1)).toBe(true);
    });

    it("keeps every edit sequence partition-consistent and round-trippable", () => {
        const index = fc.nat({ max: 8 });
        const direction = fc.constantFrom<"up" | "down">("up", "down");
        const commands: fc.Arbitrary<Cmd>[] = [
            fc.constant(addOwner()),
            index.map((at) => removeOwner(at)),
            fc.tuple(index, direction).map(([at, d]) => moveOwner(at, d)),
            index.map((at) => duplicateOwner(at)),
            index.map((at) => memorize(at)),
            fc.tuple(index, index).map(([at, off]) => removeSlice(at, off)),
            fc.tuple(index, index).map(([at, off]) => duplicateSlice(at, off)),
            fc.tuple(index, index, direction).map(([at, off, d]) => moveSlice(at, off, d)),
        ];

        fc.assert(
            fc.property(fc.commands(commands, { maxCommands: 8 }), (cmds) => {
                fc.modelRun(() => {
                    const pr = creParser.parse(bytes);
                    const real: Real = { pr, doc: docOf(pr) };
                    const model: Abstract = { owners: [] };
                    sync(model, real);
                    return { model, real };
                }, cmds);
            }),
            // Each command re-serializes and re-parses the whole record, so the sequences stay short.
            { numRuns: 25 },
        );
    });
});
