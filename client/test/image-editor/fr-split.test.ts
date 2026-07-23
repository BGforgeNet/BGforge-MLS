import { describe, expect, it } from "vitest";
import * as path from "path";
import { frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "../../src/image-editor/fr-split";

describe("isFrSplitPath", () => {
    it("accepts the six split-direction extensions, case-insensitively", () => {
        for (let d = 0; d < 6; d++) {
            expect(isFrSplitPath(`/art/critters/haenrobd.fr${d}`)).toBe(true);
        }
        expect(isFrSplitPath("/art/critters/HAENROBD.FR3")).toBe(true);
    });

    it("rejects a combined .frm, out-of-range .fr6, and unrelated extensions", () => {
        expect(isFrSplitPath("/art/critters/haenrobd.frm")).toBe(false);
        expect(isFrSplitPath("/art/critters/haenrobd.fr6")).toBe(false);
        expect(isFrSplitPath("/art/critters/haenrobd.bam")).toBe(false);
        expect(isFrSplitPath("/art/critters/haenrobd")).toBe(false);
    });
});

describe("frSplitSiblingPaths", () => {
    it("derives the six .fr0-.fr5 siblings from any member, in facing order", () => {
        const dir = path.join("/art", "critters");
        const paths = frSplitSiblingPaths(path.join(dir, "haenrobd.fr3"));
        expect(paths).toEqual(Array.from({ length: 6 }, (_, d) => path.join(dir, `haenrobd.fr${d}`)));
    });
});

describe("frSplitCombinedPath", () => {
    it("maps a split member to its combined <base>.frm", () => {
        const dir = path.join("/art", "critters");
        expect(frSplitCombinedPath(path.join(dir, "haenrobd.fr0"))).toBe(path.join(dir, "haenrobd.frm"));
        expect(frSplitCombinedPath(path.join(dir, "haenrobd.fr5"))).toBe(path.join(dir, "haenrobd.frm"));
    });
});
