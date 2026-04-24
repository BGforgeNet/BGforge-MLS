/**
 * Unit tests for shared/references-index.ts - ReferencesIndex class.
 * Tests cross-file reference storage and lookup.
 */

import { describe, expect, it } from "vitest";
import { Location, Range, Position } from "vscode-languageserver/node";
import { ReferencesIndex } from "../../src/shared/references-index";
import { normalizeUri } from "../../src/core/normalized-uri";

function makeLoc(uri: string, line: number, char: number): Location {
    return Location.create(uri, Range.create(Position.create(line, char), Position.create(line, char + 5)));
}

describe("ReferencesIndex", () => {
    it("returns empty for unknown symbol", () => {
        const index = new ReferencesIndex();
        expect(index.lookup("unknown")).toEqual([]);
    });

    it("stores and retrieves references for a single file", () => {
        const index = new ReferencesIndex();
        const refs = new Map<string, readonly Location[]>([
            ["my_func", [makeLoc("file:///a.ssl", 1, 0), makeLoc("file:///a.ssl", 5, 0)]],
        ]);
        index.updateFile(normalizeUri("file:///a.ssl"), refs);

        const result = index.lookup("my_func");
        expect(result).toHaveLength(2);
        expect(result[0]!.uri).toBe("file:///a.ssl");
    });

    it("aggregates references across multiple files", () => {
        const index = new ReferencesIndex();
        index.updateFile(normalizeUri("file:///a.ssl"), new Map([["helper", [makeLoc("file:///a.ssl", 1, 0)]]]));
        index.updateFile(
            normalizeUri("file:///b.ssl"),
            new Map([["helper", [makeLoc("file:///b.ssl", 3, 0), makeLoc("file:///b.ssl", 7, 0)]]]),
        );

        const result = index.lookup("helper");
        expect(result).toHaveLength(3);
    });

    it("replaces references when file is updated", () => {
        const index = new ReferencesIndex();
        index.updateFile(normalizeUri("file:///a.ssl"), new Map([["old_func", [makeLoc("file:///a.ssl", 1, 0)]]]));
        // Update replaces old data
        index.updateFile(normalizeUri("file:///a.ssl"), new Map([["new_func", [makeLoc("file:///a.ssl", 2, 0)]]]));

        expect(index.lookup("old_func")).toHaveLength(0);
        expect(index.lookup("new_func")).toHaveLength(1);
    });

    it("removes file data", () => {
        const index = new ReferencesIndex();
        index.updateFile(normalizeUri("file:///a.ssl"), new Map([["my_func", [makeLoc("file:///a.ssl", 1, 0)]]]));
        index.removeFile(normalizeUri("file:///a.ssl"));

        expect(index.lookup("my_func")).toHaveLength(0);
    });

    describe("lookupUris()", () => {
        it("returns empty set for unknown symbol", () => {
            const index = new ReferencesIndex();
            expect(index.lookupUris("unknown")).toEqual(new Set());
        });

        it("returns URIs of files that reference the symbol", () => {
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri("file:///a.ssl"), new Map([["helper", [makeLoc("file:///a.ssl", 1, 0)]]]));
            index.updateFile(normalizeUri("file:///b.ssl"), new Map([["helper", [makeLoc("file:///b.ssl", 3, 0)]]]));
            index.updateFile(normalizeUri("file:///c.ssl"), new Map([["other", [makeLoc("file:///c.ssl", 5, 0)]]]));

            const uris = index.lookupUris("helper");
            expect(uris).toEqual(new Set(["file:///a.ssl", "file:///b.ssl"]));
        });

        it("does not include files that were removed", () => {
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri("file:///a.ssl"), new Map([["helper", [makeLoc("file:///a.ssl", 1, 0)]]]));
            index.updateFile(normalizeUri("file:///b.ssl"), new Map([["helper", [makeLoc("file:///b.ssl", 3, 0)]]]));
            index.removeFile(normalizeUri("file:///b.ssl"));

            const uris = index.lookupUris("helper");
            expect(uris).toEqual(new Set(["file:///a.ssl"]));
        });
    });

    describe("case-sensitive keys", () => {
        it("treats different cases as distinct symbols", () => {
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri("file:///a.tp2"), new Map([["my_func", [makeLoc("file:///a.tp2", 1, 0)]]]));
            index.updateFile(normalizeUri("file:///b.tp2"), new Map([["MY_FUNC", [makeLoc("file:///b.tp2", 2, 0)]]]));

            expect(index.lookup("my_func")).toHaveLength(1);
            expect(index.lookup("MY_FUNC")).toHaveLength(1);
        });
    });
});
