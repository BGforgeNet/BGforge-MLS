import { describe, it, expect, beforeAll } from "vitest";
import { compileBafText } from "../../src/weidu-baf/compiler";
import { compileSymbolsFrom } from "../../../compilers/bcs/src/index";
import { getParser, initParser } from "../../../shared/parsers/weidu-baf";
import type { Parser } from "web-tree-sitter";

// One parser for the whole file: loading a grammar is the expensive part and no case mutates it. This is
// the same pattern compilers/bcs/test/compile.test.ts uses for this grammar - do not invent a second loader.
let parser: Parser;
beforeAll(async () => {
    await initParser();
    parser = getParser();
});

const URI = "file:///mod/test.baf";

// A minimal pair of tables, inline in the test so no fixture on disk can become a resolution source.
const SYMBOLS = compileSymbolsFrom({
    idsAll: (resref: string) =>
        resref === "TRIGGER"
            ? new Map([[16395, ["Global(S:Name*,S:Area*,I:Value*)"]]])
            : resref === "ACTION"
              ? new Map([[30, ["MoveToPoint(P:Point*)"]]])
              : undefined,
    ids: () => undefined,
});

function compile(text: string) {
    return compileBafText({ text, uri: URI, parser, symbols: SYMBOLS, engine: "bg" });
}

describe("compileBafText", () => {
    it("reports nothing for a script it can compile", () => {
        const result = compile(
            'IF\n  Global("x","GLOBAL",1)\nTHEN\n  RESPONSE #100\n    MoveToPoint([100.100])\nEND\n',
        );

        expect(result).toEqual({ errors: [], warnings: [] });
    });

    it("reports every problem at once rather than one per compile", () => {
        const result = compile("IF\n  NoSuchTrigger(1)\nTHEN\n  RESPONSE #100\n    NoSuchAction(2)\nEND\n");

        expect(result.errors).toHaveLength(2);
        expect(result.errors.map((e) => e.line)).toEqual([2, 5]);
        expect(result.errors[0]!.uri).toBe(URI);
    });

    // The codec counts columns from 1 as an editor prints them; LSP ranges count from 0. An off-by-one here
    // underlines the character before the problem, which is exactly the kind of wrongness nobody reports.
    it("converts the codec's 1-based column to the 0-based one diagnostics carry", () => {
        const result = compile("IF\n  NoSuchTrigger(1)\nTHEN\n  RESPONSE #100\nEND\n");

        expect(result.errors[0]!.columnStart).toBe(2);
    });
});

describe("compileBafText refusals", () => {
    /**
     * A tp2 assigns %px% during installation, so no compiler running at author time can know its value.
     * Compiling it as a literal name would assemble cleanly and behave wrongly in game.
     */
    it("refuses a tp2 variable, naming it and the setting that can compile it", () => {
        const result = compile(
            'IF\n  Global("x","GLOBAL",1)\nTHEN\n  RESPONSE #100\n    MoveToPoint([%px%.100])\nEND\n',
        );

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.line).toBe(5);
        expect(result.errors[0]!.message).toContain("%px%");
        expect(result.errors[0]!.message).toContain("bgforge.weidu.compiler");
    });

    it("refuses a tra reference rather than compiling it as its own number", () => {
        const result = compile(
            'IF\n  Global("x","GLOBAL",1)\nTHEN\n  RESPONSE #100\n    DisplayString(Myself,@123)\nEND\n',
        );

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.message).toContain("@123");
    });
});
