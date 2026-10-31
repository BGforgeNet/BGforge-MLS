import { describe, expect, it } from "vitest";
import { appendMsgEntries } from "@bgforge/shared/dialog-tra-edit";

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

    // The game reads a field up to the next `}`, so an appended entry would become part of the open one.
    it("refuses to append after a field that never closes, naming its line", () => {
        expect(() => appendMsgEntries(`{100}{}{Closed.}\n{101}{}{Never closed\n`, { "102": "New." })).toThrow(
            "line 2 opens a field that never closes; close it before adding entries",
        );
    });

    it("leaves a file with an unclosed field as it is when there is nothing to append", () => {
        const msg = `{100}{}{Closed.}\n{101}{}{Never closed\n`;
        expect(appendMsgEntries(msg, { "100": "Closed." })).toBe(msg);
    });
});
