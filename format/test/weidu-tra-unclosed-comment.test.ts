/**
 * A .tra file with a block comment that never closes (a comment being typed) formats to the same text on every pass:
 * format-on-save must not grow the file.
 */

import { describe, expect, it } from "vitest";
import { formatTra } from "@bgforge/format";

describe("formatTra with an unclosed block comment", () => {
    it.each([
        ["after an entry", "@1 = ~a~\n/* unclosed\n@2 = ~x~\n"],
        ["at the end without a line break", "@1 = ~a~\n/* unclosed"],
        ["on the first line", "/* unclosed\n@1 = ~a~\n"],
        ["with trailing blank lines", "@1 = ~a~\n/* unclosed\n\n\n"],
    ])("is stable under a second pass: %s", (_name, text) => {
        const first = formatTra(text);
        expect(first.warning).toBeUndefined();
        const second = formatTra(first.text);
        expect(second.text).toBe(first.text);
    });

    it("keeps the comment and the text after it, and ends with one line break", () => {
        const result = formatTra("@1 = ~a~\n/* unclosed\n@2 = ~x~\n");
        expect(result.text).toBe("@1 = ~a~\n/* unclosed\n@2 = ~x~\n");
    });
});
