import { describe, expect, it } from "vitest";
import { escapeRegex, wholeIdentifier } from "../regex-utils";

describe("escapeRegex", () => {
    it.each([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"])("matches %j literally", (char) => {
        expect(new RegExp(`^${escapeRegex(char)}$`).test(char)).toBe(true);
    });

    it("leaves a name without metacharacters as it is", () => {
        expect(escapeRegex("Node_998")).toBe("Node_998");
    });

    it("turns a dot into a literal dot", () => {
        expect(new RegExp(escapeRegex("a.b")).test("axb")).toBe(false);
    });
});

describe("wholeIdentifier", () => {
    const find = (name: string, text: string): string[] => text.match(new RegExp(wholeIdentifier(name), "g")) ?? [];

    it("matches a plain name between non-identifier characters", () => {
        expect(find("count", "count + (count) - .count, count;")).toEqual(["count", "count", "count", "count"]);
    });

    it("refuses a name glued to a word character or $", () => {
        expect(find("x", "ax xa $x x$ _x x_ 1x x1")).toEqual([]);
    });

    it("matches a name that starts or ends with $", () => {
        expect(find("$x", "$x + a$x + $xy")).toEqual(["$x"]);
        expect(find("x$", "x$ + x$y + ax$")).toEqual(["x$"]);
    });
});
