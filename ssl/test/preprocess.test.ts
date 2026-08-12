import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preprocess, PreprocessError } from "../src/preprocess.ts";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-cpp-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Write `files` into the sandbox and preprocess `entry`, normalised to a single-spaced token stream. */
function run(files: Record<string, string>, entry = "main.ssl"): string {
    for (const [name, body] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
    }
    // `:=` is one SSL token; splitting it would make every expectation below read oddly.
    const tokens = preprocess(path.join(dir, entry)).match(/"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*|\d+|:=|[^\s]/g) ?? [];
    return tokens.join(" ");
}

describe("object-like macros", () => {
    it("expands a constant", () => {
        expect(run({ "main.ssl": "#define N 3\nx := N;" })).toBe("x := 3 ;");
    });

    it("expands transitively", () => {
        expect(run({ "main.ssl": "#define A B\n#define B 7\nx := A;" })).toBe("x := 7 ;");
    });

    it("does not recurse into itself", () => {
        expect(run({ "main.ssl": "#define A A + 1\nx := A;" })).toBe("x := A + 1 ;");
    });

    it("stops expanding after #undef", () => {
        expect(run({ "main.ssl": "#define N 3\n#undef N\nx := N;" })).toBe("x := N ;");
    });

    it("leaves macro names inside string literals alone", () => {
        expect(run({ "main.ssl": '#define N 3\nx := "N";' })).toBe('x := "N" ;');
    });
});

describe("function-like macros", () => {
    it("substitutes arguments", () => {
        expect(run({ "main.ssl": "#define ADD(a,b) ((a)+(b))\nx := ADD(1,2);" })).toBe("x := ( ( 1 ) + ( 2 ) ) ;");
    });

    it("handles arguments containing commas inside parentheses", () => {
        expect(run({ "main.ssl": "#define F(a) [a]\nx := F(g(1,2));" })).toBe("x := [ g ( 1 , 2 ) ] ;");
    });

    it("does not expand without an argument list", () => {
        expect(run({ "main.ssl": "#define F(a) [a]\nx := F;" })).toBe("x := F ;");
    });

    it("expands arguments before substituting them", () => {
        expect(run({ "main.ssl": "#define N 3\n#define F(a) [a]\nx := F(N);" })).toBe("x := [ 3 ] ;");
    });

    /**
     * The bug that a from-scratch expander gets wrong: an object-like macro aliasing a function-like one
     * must see the argument list that follows it in the SOURCE, which only happens if the replacement is
     * spliced back into the stream instead of expanded in isolation.
     */
    it("expands an object-like alias of a function-like macro", () => {
        const src = "#define box_mstr(x) (message_str(17,x))\n#define my_mstr box_mstr\ny := my_mstr(195);";
        expect(run({ "main.ssl": src })).toBe("y := ( message_str ( 17 , 195 ) ) ;");
    });
});

describe("# and ## operators", () => {
    it("stringifies a parameter", () => {
        expect(run({ "main.ssl": "#define S(x) #x\ny := S(abc);" })).toBe('y := "abc" ;');
    });

    it("pastes tokens", () => {
        expect(run({ "main.ssl": "#define CAT(a,b) a##b\n#define xy 9\ny := CAT(x,y);" })).toBe("y := 9 ;");
    });
});

describe("variadic macros", () => {
    it("binds surplus arguments to __VA_ARGS__", () => {
        expect(run({ "main.ssl": "#define F(...) g(__VA_ARGS__)\ny := F(1,2,3);" })).toBe("y := g ( 1 , 2 , 3 ) ;");
    });

    /** The argument-count-overload idiom sfall.h uses; 4 definitions there gate the whole corpus. */
    it("supports selecting an overload by argument count", () => {
        const src = [
            "#define PICK(_1,_2,_3,NAME,...) NAME",
            "#define box(...) PICK(__VA_ARGS__,box3,box2,box1)(__VA_ARGS__)",
            "y := box(7,8);",
        ].join("\n");
        expect(run({ "main.ssl": src })).toBe("y := box2 ( 7 , 8 ) ;");
    });
});

describe("conditionals", () => {
    it("honours #ifdef and #else", () => {
        expect(run({ "main.ssl": "#define A\n#ifdef A\nx := 1;\n#else\nx := 2;\n#endif" })).toBe("x := 1 ;");
    });

    it("honours #ifndef", () => {
        expect(run({ "main.ssl": "#ifndef A\nx := 1;\n#endif" })).toBe("x := 1 ;");
    });

    it("evaluates #if comparisons", () => {
        expect(run({ "main.ssl": "#define N 5\n#if N > 3\nx := 1;\n#else\nx := 2;\n#endif" })).toBe("x := 1 ;");
    });

    it("treats an undefined identifier in #if as zero", () => {
        expect(run({ "main.ssl": "#if UNSET\nx := 1;\n#else\nx := 2;\n#endif" })).toBe("x := 2 ;");
    });

    it("resolves defined()", () => {
        expect(run({ "main.ssl": "#define A\n#if defined(A)\nx := 1;\n#endif" })).toBe("x := 1 ;");
    });

    // The corpus only ever uses simple comparisons, but the evaluator implements the full constant
    // expression grammar, so every operator gets a case rather than being carried untested.
    it.each([
        ["2 * 3 == 6", true],
        ["7 / 2 == 3", true],
        ["7 % 2 == 1", true],
        ["1 + 2 == 3", true],
        ["5 - 4 == 1", true],
        ["1 << 3 == 8", true],
        ["8 >> 2 == 2", true],
        ["1 < 2", true],
        ["2 > 1", true],
        ["2 <= 2", true],
        ["2 >= 3", false],
        ["1 != 2", true],
        ["6 & 3", true],
        ["6 ^ 6", false],
        ["4 | 1", true],
        ["1 && 0", false],
        ["0 || 3", true],
        ["!0", true],
        ["~0", true],
        ["-1", true],
        ["+0", false],
        ["0x10 == 16", true],
        ["(1 + 2) * 3 == 9", true],
        ["1 / 0 == 0", true],
        ["1 % 0 == 0", true],
    ])("evaluates #if %s", (expression, taken) => {
        const src = `#if ${expression}\nx := 1;\n#else\nx := 2;\n#endif`;
        expect(run({ "main.ssl": src })).toBe(taken ? "x := 1 ;" : "x := 2 ;");
    });

    it("skips a dead branch without evaluating nested directives", () => {
        expect(run({ "main.ssl": "#ifdef NOPE\n#define BAD 1\n#endif\nx := BAD;" })).toBe("x := BAD ;");
    });

    it("rejects an unterminated conditional", () => {
        expect(() => run({ "main.ssl": "#ifdef A\nx := 1;" })).toThrow(PreprocessError);
    });
});

describe("includes", () => {
    it("resolves relative to the including file", () => {
        expect(run({ "main.ssl": '#include "headers/n.h"\nx := N;', "headers/n.h": "#define N 4" })).toBe("x := 4 ;");
    });

    it("resolves a computed include", () => {
        const files = { "main.ssl": '#define H "n.h"\n#include H\nx := N;', "n.h": "#define N 4" };
        expect(run(files)).toBe("x := 4 ;");
    });

    it("normalises Windows separators", () => {
        const files = { "main.ssl": '#include "headers\\n.h"\nx := N;', "headers/n.h": "#define N 4" };
        expect(run(files)).toBe("x := 4 ;");
    });

    it("reports a missing include with its file and line", () => {
        expect(() => run({ "main.ssl": '#include "nope.h"' })).toThrow(/cannot find include "nope.h"/);
    });

    it("include guards prevent redefinition loops", () => {
        const files = {
            "main.ssl": '#include "a.h"\n#include "a.h"\nx := N;',
            "a.h": '#ifndef A_H\n#define A_H\n#define N 4\n#include "b.h"\n#endif',
            "b.h": '#ifndef B_H\n#define B_H\n#include "a.h"\n#endif',
        };
        expect(run(files)).toBe("x := 4 ;");
    });
});

describe("comments and continuations", () => {
    it("strips both comment forms", () => {
        expect(run({ "main.ssl": "x := 1; // tail\n/* block */ y := 2;" })).toBe("x := 1 ; y := 2 ;");
    });

    it("keeps comment markers inside strings", () => {
        expect(run({ "main.ssl": 'x := "a // b";' })).toBe('x := "a // b" ;');
    });

    it("splices continued lines", () => {
        expect(run({ "main.ssl": "#define M a \\\n b\nx := M;" })).toBe("x := a b ;");
    });
});

describe("options", () => {
    function runWith(files: Record<string, string>, options: Parameters<typeof preprocess>[1]): string {
        for (const [name, body] of Object.entries(files)) {
            const target = path.join(dir, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, body);
        }
        const tokens = preprocess(path.join(dir, "main.ssl"), options).match(/[A-Za-z_]\w*|\d+|:=|[^\s]/g) ?? [];
        return tokens.join(" ");
    }

    it("predefines macros from `defines`", () => {
        expect(runWith({ "main.ssl": "x := N;" }, { defines: { N: "9" } })).toBe("x := 9 ;");
    });

    it("searches `includeDirs` after the including file's own directory", () => {
        const files = { "main.ssl": '#include "n.h"\nx := N;', "vendor/n.h": "#define N 4" };
        expect(runWith(files, { includeDirs: [path.join(dir, "vendor")] })).toBe("x := 4 ;");
    });

    it("prefers the including file's directory over `includeDirs`", () => {
        const files = { "main.ssl": '#include "n.h"\nx := N;', "n.h": "#define N 1", "vendor/n.h": "#define N 2" };
        expect(runWith(files, { includeDirs: [path.join(dir, "vendor")] })).toBe("x := 1 ;");
    });

    it("enforces maxIncludeDepth", () => {
        const files = { "main.ssl": '#include "a.h"', "a.h": '#include "a.h"' };
        expect(() => runWith(files, { maxIncludeDepth: 3 })).toThrow(/include nesting too deep/);
    });
});

describe("#pragma belongs to the compiler", () => {
    /**
     * sslc's own lexer reads `#pragma sce` and turns on short-circuit boolean evaluation, so a dropped
     * pragma silently changes how `and`/`or` compile. gcc -E passes pragmas through; so do we.
     */
    it("passes a pragma through to the output", () => {
        expect(run({ "main.ssl": "#pragma sce\nx := 1;" })).toBe("# pragma sce x := 1 ;");
    });

    it("drops a pragma inside a branch that is skipped", () => {
        expect(run({ "main.ssl": "#ifdef NOPE\n#pragma sce\n#endif\nx := 1;" })).toBe("x := 1 ;");
    });

    it("ignores a null directive", () => {
        expect(run({ "main.ssl": "#\nx := 1;" })).toBe("x := 1 ;");
    });
});

describe("errors carry their location", () => {
    it("reports #endif without #if", () => {
        expect(() => run({ "main.ssl": "#endif" })).toThrow(/main\.ssl:1: #endif without #if/);
    });

    it("reports #else without #if", () => {
        expect(() => run({ "main.ssl": "#else" })).toThrow(/#else without #if/);
    });

    it("exposes file and line on the error object", () => {
        try {
            run({ "main.ssl": "x := 1;\n#bogus" });
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(PreprocessError);
            expect((error as PreprocessError).line).toBe(2);
            expect((error as PreprocessError).file).toMatch(/main\.ssl$/);
        }
    });

    it("rejects a malformed #define", () => {
        expect(() => run({ "main.ssl": "#define 1BAD x" })).toThrow(/malformed #define/);
    });

    it("rejects a named variadic parameter", () => {
        expect(() => run({ "main.ssl": "#define F(args...) g(args)" })).toThrow(/named variadic/);
    });

    it("rejects a malformed #if expression", () => {
        expect(() => run({ "main.ssl": "#if (1\nx := 1;\n#endif" })).toThrow(PreprocessError);
    });
});

describe("unimplemented directives bail loudly", () => {
    it.each(["error nope", "line 5", "warning hm", "ident x", "sccs x", "assert x", "unassert x"])(
        "rejects #%s",
        (directive) => {
            expect(() => run({ "main.ssl": `#${directive}` })).toThrow(/is not supported/);
        },
    );

    it("rejects #elif", () => {
        expect(() => run({ "main.ssl": "#if 0\n#elif 1\n#endif" })).toThrow(/#elif is not supported/);
    });

    it("rejects an unknown directive", () => {
        expect(() => run({ "main.ssl": "#bogus" })).toThrow(/unknown directive #bogus/);
    });

    /**
     * A skipped branch is where a silently-ignored directive would hide: nothing downstream ever shows a
     * difference. A conforming preprocessor may ignore these, but we would rather reject a file we cannot
     * fully model than emit a translation unit that quietly omits something.
     */
    it.each(["error nope", "line 5", "bogus"])("rejects #%s even inside a skipped branch", (directive) => {
        expect(() => run({ "main.ssl": `#ifdef NOPE\n#${directive}\n#endif` })).toThrow(PreprocessError);
    });

    it("names the file and line of the offending directive", () => {
        expect(() => run({ "main.ssl": "x := 1;\n\n#error boom" })).toThrow(/main\.ssl:3: #error is not supported/);
    });
});
