import { describe, expect, it } from "vitest";
import { appendMsgEntries } from "../../shared/dialog-tra-edit";

describe("appendMsgEntries", () => {
    it("appends new entries as {id}{}{text}, leaving existing bytes untouched", () => {
        const msg = `{100}{}{hello}\n`;
        const out = appendMsgEntries(msg, { "200": "new line" });
        expect(out).toBe(`{100}{}{hello}\n{200}{}{new line}\n`);
    });

    it("never duplicates an id that already exists", () => {
        const msg = `{100}{}{hello}\n`;
        expect(appendMsgEntries(msg, { "100": "changed" })).toBe(msg);
    });

    it("ensures a trailing newline before appending to a file that lacks one", () => {
        expect(appendMsgEntries(`{100}{}{hi}`, { "200": "x" })).toBe(`{100}{}{hi}\n{200}{}{x}\n`);
    });
});
