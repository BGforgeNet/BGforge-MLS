import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    appendTraEntries,
    rewriteMsgEntries,
    rewriteTraEntries,
    siblingTraCandidates,
} from "../../shared/dialog-tra-edit";

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

// Fallout .msg entries are `{id}{sound}{text}`, NOT the WeiDU `@N = ~text~` of a .tra. The two
// need separate rewriters: rewriteTraEntries never matches a .msg line, so a .msg write silently
// no-ops if it is used (the bug this fixes).
describe("rewriteMsgEntries", () => {
    const MSG = `# Coran's lines
{0}{}{Original zero.}
{1}{snd1}{Original one.}
{2}{}{Keep me.}
`;

    it("rewrites only the changed entries, preserving id, sound, and everything else byte-for-byte", () => {
        const out = rewriteMsgEntries(MSG, { "0": "Edited zero.", "1": "Edited one." });
        expect(out).toContain("{0}{}{Edited zero.}");
        // The sound field of entry 1 is preserved - only the text group changes.
        expect(out).toContain("{1}{snd1}{Edited one.}");
        expect(out).toContain("{2}{}{Keep me.}");
        expect(out).toContain("# Coran's lines");
    });

    it("leaves the file unchanged when no message matches an entry", () => {
        expect(rewriteMsgEntries(MSG, { "99": "nope" })).toBe(MSG);
    });

    it("rewriting an entry to its current value is a no-op", () => {
        expect(rewriteMsgEntries(MSG, { "2": "Keep me." })).toBe(MSG);
    });

    it("handles an empty text value", () => {
        expect(rewriteMsgEntries(`{5}{}{}\n`, { "5": "now has text" })).toBe(`{5}{}{now has text}\n`);
    });
});

// The D-family allocator mints a fresh `@N` for editor-authored text (a new option or state), so the
// save must be able to ADD that entry - a rewrite-only .tra write silently drops the typed text (the
// spliced .d references an `@N` that resolves nowhere on reopen).
describe("appendTraEntries", () => {
    const TRA = `@0 = ~Existing zero.~\n`;

    it("appends entries whose ids are absent, preserving existing bytes", () => {
        const out = appendTraEntries(TRA, { "0": "Existing zero.", "1": "Brand new line." });
        expect(out).toBe(`@0 = ~Existing zero.~\n@1 = ~Brand new line.~\n`);
    });

    it("is a no-op when every id already exists (idempotent with rewriteTraEntries)", () => {
        expect(appendTraEntries(TRA, { "0": "changed elsewhere" })).toBe(TRA);
    });

    it("newline-terminates the file before appending so entries stay one-per-line", () => {
        expect(appendTraEntries(`@0 = ~no trailing newline~`, { "1": "added" })).toBe(
            `@0 = ~no trailing newline~\n@1 = ~added~\n`,
        );
    });

    it("appends to an empty file without a leading blank line", () => {
        expect(appendTraEntries("", { "1": "first" })).toBe(`@1 = ~first~\n`);
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
