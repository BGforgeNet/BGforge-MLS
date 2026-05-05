/**
 * End-to-end MAP decode of vanilla item / scenery records.
 *
 * Pre-resolver, `parseObjectAt` bailed at the first item/scenery on each
 * elevation and dumped the rest of the file as an `objects-tail` opaque range
 * (see `parse-objects.ts:193–214`). With the bundled pidtypes resolver wired
 * in, fully-resolvable vanilla maps decode every record and emit no
 * `objects-tail`. These tests gate that closure.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { resolvePidSubType } from "../src/pid-resolver";
import { composePidResolvers, loadProDirResolver } from "../src/pro-resolver-loader";
import type { ParsedField, ParsedGroup } from "../src/types";

function isGroup(x: unknown): x is ParsedGroup {
    return typeof x === "object" && x !== null && "fields" in x && Array.isArray((x as ParsedGroup).fields);
}

function findGroup(g: ParsedGroup, predicate: (g: ParsedGroup) => boolean): ParsedGroup | undefined {
    if (predicate(g)) return g;
    for (const f of g.fields) {
        if (isGroup(f)) {
            const r = findGroup(f, predicate);
            if (r) return r;
        }
    }
    return undefined;
}

function findField(g: ParsedGroup, name: string): ParsedField | undefined {
    for (const f of g.fields) {
        if (!isGroup(f) && f.name === name) return f;
        if (isGroup(f)) {
            const r = findField(f, name);
            if (r) return r;
        }
    }
    return undefined;
}

function loadFixture(name: string): ReturnType<typeof mapParser.parse> {
    const data = new Uint8Array(fs.readFileSync(path.resolve("client/testFixture/maps", `${name}.map`)));
    return mapParser.parse(data);
}

describe("vanilla MAP item/scenery decode via bundled pidtypes resolver", () => {
    it("artemple's first scenery (subType 5 / Generic) is no longer editingLocked", () => {
        const parsed = loadFixture("artemple");
        const obj = findGroup(parsed.root, (g) => g.name === "Object 0.0 (Scenery)");
        expect(obj, "Object 0.0 should exist").toBeDefined();
        expect(obj!.editingLocked).not.toBe(true);
    });

    it("artemple parses subsequent objects past the previously-bailing first scenery", () => {
        // Pre-fix the parser stopped at Object 0.0; a sibling Object 0.1 means
        // the cursor advanced past the scenery trailer.
        const parsed = loadFixture("artemple");
        const obj1 = findGroup(parsed.root, (g) => /^Object 0\.[1-9]\d* /.test(g.name));
        expect(obj1, "expected at least one sibling object after Object 0.0").toBeDefined();
    });

    it("artemple emits no objects-tail opaque range when every object resolves", () => {
        // The bundled fallout2-pidtypes.json is a snapshot — a few fixtures
        // reference pids that weren't in the source master.dat (RP-adjacent,
        // patched, or omitted at extraction time). To prove the pipeline does
        // close objects-tail when every pid is resolvable, supply a custom
        // resolver that maps every pid to scenery/item subType 5 (Generic /
        // Misc) — both produce zero trailer bytes, so pids of any type advance
        // cleanly to the next record. A real-world consumer would supply a
        // pids+protos table from their own data set.
        const data = new Uint8Array(fs.readFileSync(path.resolve("client/testFixture/maps/artemple.map")));
        const parsed = mapParser.parse(data, { pidResolver: () => 5 });
        const labels = (parsed.opaqueRanges ?? []).map((r) => r.label);
        expect(labels).not.toContain("objects-tail");
    });

    it("decodes named subtype-trailer fields when a vanilla door / elevator / weapon appears", () => {
        // Across the four fully-resolvable vanilla fixtures, at least one
        // record will exercise a non-zero subtype trailer (Door = 4 B,
        // Elevator = 8 B, Weapon = 8 B, etc.). Asserts named fields surfaced.
        const fixtures = ["arcaves", "artemple", "denbus1", "newr2"].map((name) => loadFixture(name));
        const seenNames = new Set<string>();
        // Names unique to the subtype trailer decoders. "Destination Map" /
        // "Destination Built Tile" are excluded because exit grids already
        // emit "Destination Map" pre-fix; "Quantity" / "Level" overlap with
        // unrelated fields. The remaining names appear only after the
        // resolver-driven decode lands.
        const trailerNames = /^(Open Flags|Elevator Type|Ammo Quantity|Ammo Type PID|Charges|Key Code)$/;
        for (const r of fixtures) {
            (function visit(g: ParsedGroup) {
                for (const f of g.fields) {
                    if (!isGroup(f) && trailerNames.test(f.name)) seenNames.add(f.name);
                    else if (isGroup(f)) visit(f);
                }
            })(r.root);
        }
        expect(seenNames.size).toBeGreaterThan(0);
    });

    it("bhrnddst still emits an objects-tail (its first scenery pid is unresolved)", () => {
        // Documents the graceful-fallback contract: when the resolver returns
        // undefined, the parser keeps the legacy opaque-tail behavior so
        // unknown pids do not crash the decode. bhrnddst pid 0x02000779 is
        // not present in the bundled Fallout 2 table.
        const parsed = loadFixture("bhrnddst");
        const labels = (parsed.opaqueRanges ?? []).map((r) => r.label);
        expect(labels).toContain("objects-tail");
    });

    it("newr2 keeps an objects-tail even with full proto coverage (engine-unloadable record)", () => {
        // newr2.map contains an object-array record fallout2-ce itself can't
        // load: a parent with pid=-1 (Type255) whose inventory references an
        // item with pid=0, which `protoGetProto` would fail on. The parser
        // bails at that record and captures the rest opaquely so the file
        // still round-trips byte-identically. This test pins that contract:
        // a future change that "fixes" the lock by silently advancing past
        // such records (e.g. by guessing a 0-byte trailer) would lose the
        // signal that the input is genuinely malformed and surface as a
        // regression here. See binary/INTERNALS.md "Known feature gaps".
        //
        // The resolver below covers every legitimate pid (bundled defaults +
        // sibling proto/ overrides — exactly what the CLI auto-applies) but
        // still returns undefined for pid=0, so what's left is the corrupt-
        // data path.
        const { resolver: protoResolver } = loadProDirResolver(path.resolve("client/testFixture/proto"));
        const data = new Uint8Array(fs.readFileSync(path.resolve("client/testFixture/maps/newr2.map")));
        const parsed = mapParser.parse(data, {
            pidResolver: composePidResolvers(protoResolver, resolvePidSubType),
        });
        const labels = (parsed.opaqueRanges ?? []).map((r) => r.label);
        expect(labels).toContain("objects-tail");
    });

    it("findField smoke check: artemple Object 0.0 still exposes its PID", () => {
        // Sanity that the parser didn't throw out the base record while
        // promoting the trailer. Used by the structural-mutation gate.
        const parsed = loadFixture("artemple");
        const obj = findGroup(parsed.root, (g) => g.name === "Object 0.0 (Scenery)")!;
        const pid = findField(obj, "PID");
        expect(pid?.value).toBe(0x02000158);
    });
});
