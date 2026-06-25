import path from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteTraEntries, siblingTraCandidates } from "../../shared/dialog-tra-edit";

describe("rewriteTraEntries", () => {
    const TRA = `// Coran's lines
@0 = ~Original zero.~
@1   =   ~Original one.~
@2 = ~Keep me.~
`;

    it("rewrites only the changed entries, preserving everything else byte-for-byte", () => {
        const out = rewriteTraEntries(TRA, { "0": "Edited zero.", "1": "Edited one." });
        expect(out).toContain("@0 = ~Edited zero.~");
        // The exact `   =   ~` spacing of @1 is preserved (only the value changes).
        expect(out).toContain("@1   =   ~Edited one.~");
        // Untouched entry and the comment are unchanged.
        expect(out).toContain("@2 = ~Keep me.~");
        expect(out).toContain("// Coran's lines");
    });

    it("leaves the file unchanged when no message matches an entry", () => {
        expect(rewriteTraEntries(TRA, { "99": "nope" })).toBe(TRA);
    });

    it("rewriting an entry to its current value is a no-op", () => {
        expect(rewriteTraEntries(TRA, { "2": "Keep me." })).toBe(TRA);
    });

    it("handles a multiline value", () => {
        const tra = `@5 = ~line one\nline two~\n`;
        const out = rewriteTraEntries(tra, { "5": "new single line" });
        expect(out).toBe(`@5 = ~new single line~\n`);
    });
});

describe("siblingTraCandidates", () => {
    it("lists the same-named .tra in other language dirs, excluding the active language", () => {
        const active = path.join("/proj", "tra", "english", "setup.tra");
        expect(siblingTraCandidates(active, ["english", "french", "german"])).toEqual([
            path.join("/proj", "tra", "french", "setup.tra"),
            path.join("/proj", "tra", "german", "setup.tra"),
        ]);
    });

    it("returns [] when the active language is the only language dir", () => {
        const active = path.join("/proj", "tra", "english", "setup.tra");
        expect(siblingTraCandidates(active, ["english"])).toEqual([]);
    });
});
