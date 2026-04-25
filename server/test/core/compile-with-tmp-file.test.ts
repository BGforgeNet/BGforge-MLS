import { describe, expect, it } from "vitest";
import { abortAllCompiles } from "../../src/core/compile-with-tmp-file";
import type { NormalizedUri } from "../../src/core/normalized-uri";

describe("abortAllCompiles", () => {
    it("aborts every controller in the map and empties it", () => {
        const map = new Map<NormalizedUri, AbortController>();
        const a = new AbortController();
        const b = new AbortController();
        map.set("file:///a" as NormalizedUri, a);
        map.set("file:///b" as NormalizedUri, b);

        abortAllCompiles(map);

        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(true);
        expect(map.size).toBe(0);
    });

    it("is a no-op on an empty map", () => {
        const map = new Map<NormalizedUri, AbortController>();
        expect(() => abortAllCompiles(map)).not.toThrow();
        expect(map.size).toBe(0);
    });
});
