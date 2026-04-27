/**
 * Byte-identity round-trip across every registered binary format.
 *
 * Invariant: for any fixture the parser accepts (no fatal errors),
 * `parser.serialize(parser.parse(bytes))` must equal the original bytes.
 *
 * This is the contract the canonical-document pipeline must satisfy
 * to support write-side editing without corrupting downstream sections.
 * A fixture that violates it is one where some part of the on-disk
 * layout the parser consumed is dropped on the path through the
 * canonical doc back to bytes — i.e. the parser/canonical-reader pair
 * is not lossless.
 *
 * PRO already has a focused round-trip test in `pro-roundtrip.test.ts`
 * via the schema layer; this suite covers every parser uniformly via
 * the public `serialize` method, so any newly-registered format inherits
 * the gate.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import "../src/index";
import { parserRegistry } from "../src/registry";
import type { BinaryParser } from "../src/types";

interface FixtureCase {
    name: string;
    fullPath: string;
}

function listFiles(dir: string, ext: string): FixtureCase[] {
    if (!fs.existsSync(dir)) return [];
    const entries: FixtureCase[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // Skip intentionally-malformed fixture trees: their purpose is to exercise
        // parser error paths, not to assert lossless write-back.
        if (entry.isDirectory()) {
            if (entry.name === "bad") continue;
            entries.push(...listFiles(full, ext));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
            entries.push({ name: path.relative(path.resolve("client/testFixture"), full), fullPath: full });
        }
    }
    return entries;
}

const FIXTURE_DIRS_BY_PARSER: Record<string, string[]> = {
    map: ["client/testFixture/maps"],
    pro: ["client/testFixture/proto"],
};

function fixturesFor(parser: BinaryParser): FixtureCase[] {
    const dirs = FIXTURE_DIRS_BY_PARSER[parser.id] ?? [];
    const cases: FixtureCase[] = [];
    for (const ext of parser.extensions) {
        for (const dir of dirs) {
            cases.push(...listFiles(path.resolve(dir), `.${ext.toLowerCase()}`));
        }
    }
    // Deterministic order across machines.
    cases.sort((a, b) => a.name.localeCompare(b.name));
    return cases;
}

function firstDifferingOffset(a: Uint8Array, b: Uint8Array): number {
    const limit = Math.min(a.length, b.length);
    for (let i = 0; i < limit; i++) {
        if (a[i] !== b[i]) return i;
    }
    return a.length === b.length ? -1 : limit;
}

const parsers = parserRegistry.getAllParsers();

for (const parser of parsers) {
    const cases = fixturesFor(parser);

    describe(`${parser.id}: parse → serialize is byte-identity`, () => {
        if (cases.length === 0) {
            it.skip(`${parser.id} has no fixtures registered for round-trip`, () => {});
            return;
        }

        if (typeof parser.serialize !== "function") {
            it.skip(`${parser.id} parser does not implement serialize()`, () => {});
            return;
        }

        for (const fixture of cases) {
            it(fixture.name, () => {
                const original = new Uint8Array(fs.readFileSync(fixture.fullPath));
                const parsed = parser.parse(original);
                const reserialized = parser.serialize!(parsed);

                const diffAt = firstDifferingOffset(original, reserialized);
                if (diffAt !== -1) {
                    throw new Error(
                        `Round-trip not byte-identical: original=${original.length} bytes, ` +
                            `reserialized=${reserialized.length} bytes, first differing offset=0x${diffAt.toString(16)}`,
                    );
                }
                expect(reserialized.length).toBe(original.length);
            });
        }
    });
}
