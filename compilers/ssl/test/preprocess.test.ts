import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preprocess, preprocessText, preprocessWithOrigins, PreprocessError } from "../src/preprocess.ts";

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

    /**
     * An argument list may span lines: the collection runs to the closing parenthesis, wherever it falls.
     * Headers rely on it for the long concatenated strings a debug macro takes, and without it the name is
     * left alone and surfaces much later as "not an engine function" - naming a macro that no longer looks
     * like one, at a line nowhere near the definition.
     */
    it("collects an argument list that spans several lines", () => {
        const src = '#define NOTE(m) debug_msg(m)\nNOTE("a"\n + "b");';
        expect(run({ "main.ssl": src })).toBe('debug_msg ( "a" + "b" ) ;');
    });

    /**
     * The limit on how far a list is drawn exists to stop an unclosed parenthesis - an editor buffer
     * mid-keystroke, most of the time - walking to the end of the file, so it has to sit far above any
     * list a person would actually write. Ten lines is already unusual and must still expand.
     */
    it("collects a list far longer than anything a script writes", () => {
        const parts = Array.from({ length: 10 }, (_, i) => ` + "${i}"`).join("\n");
        expect(run({ "main.ssl": `#define NOTE(m) debug_msg(m)\nNOTE("a"\n${parts});` })).toBe(
            `debug_msg ( "a" ${Array.from({ length: 10 }, (_, i) => `+ "${i}"`).join(" ")} ) ;`,
        );
    });

    /**
     * Splitting a call across lines must not move the lines after it. Compile errors are reported in
     * preprocessed coordinates, so a swallowed newline puts every later diagnostic one line off - and the
     * two sources here differ in nothing else, which is what makes the comparison the whole assertion.
     */
    it("leaves what follows a split call on the line it started on", () => {
        const markerLine = (call: string) => {
            fs.writeFileSync(path.join(dir, "main.ssl"), `#define NOTE(m) debug_msg(m)\n${call}\nmarker;\n`);
            return preprocess(path.join(dir, "main.ssl"))
                .split("\n")
                .findIndex((line) => line.includes("marker"));
        };
        // Both calls occupy two source lines, so `marker` starts from the same place in each; the split
        // one must not pull it up by swallowing the newline inside its argument list.
        expect(markerLine('NOTE("a"\n + "b");')).toBe(markerLine('NOTE("a" + "b");\n'));
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
     * `#pragma sce` turns on short-circuit evaluation of boolean operators, so a dropped pragma silently
     * changes how `and`/`or` compile. gcc -E passes pragmas through; so do we.
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
        // Captured rather than asserted inside the catch: an expect in a catch never runs once the call
        // stops throwing, and the test would go green having checked nothing. A null here fails the
        // instanceof below, so the no-throw case is still a failure.
        let thrown: unknown = null;
        try {
            run({ "main.ssl": "x := 1;\n#bogus" });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(PreprocessError);
        expect((thrown as PreprocessError).line).toBe(2);
        expect((thrown as PreprocessError).file).toMatch(/main\.ssl$/);
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

/**
 * `#elif` selects at most one arm, and a dead arm's condition is never evaluated - the guard clause of a
 * `defined`-style chain depends on that, since its operands may be meaningless once an earlier arm won.
 */
describe("#elif", () => {
    it("takes the elif arm when the leading if is false", () => {
        expect(run({ "main.ssl": "#if 0\nfirst\n#elif 1\nsecond\n#else\nthird\n#endif" }).trim()).toBe("second");
    });

    it("keeps the first true arm and skips a later true one", () => {
        expect(run({ "main.ssl": "#if 1\nfirst\n#elif 1\nsecond\n#endif" }).trim()).toBe("first");
    });

    it("walks a chain to the first true arm", () => {
        expect(run({ "main.ssl": "#if 0\none\n#elif 0\ntwo\n#elif 1\nthree\n#else\nfour\n#endif" }).trim()).toBe(
            "three",
        );
    });

    it("falls through to else when no arm is true", () => {
        expect(run({ "main.ssl": "#if 0\none\n#elif 0\ntwo\n#else\nfallback\n#endif" }).trim()).toBe("fallback");
    });

    it("does not evaluate the condition of an arm that cannot be taken", () => {
        // `undefined_thing` would not survive evaluation; a taken earlier arm means it is never read.
        expect(run({ "main.ssl": "#if 1\ntaken\n#elif undefined_thing(\n#endif" }).trim()).toBe("taken");
    });

    it("stays dead inside a skipped parent", () => {
        expect(run({ "main.ssl": "#ifdef NOPE\n#if 0\na\n#elif 1\nb\n#endif\n#endif" }).trim()).toBe("");
    });

    it("rejects an elif with no if", () => {
        expect(() => run({ "main.ssl": "#elif 1\n" })).toThrow(/#elif without #if/);
    });
});

describe("#error and #line", () => {
    it("stops the build with the author's message", () => {
        expect(() => run({ "main.ssl": "x := 1;\n\n#error boom" })).toThrow(/main\.ssl:3: #error boom/);
    });

    it("ignores an error in a branch that is not taken", () => {
        expect(run({ "main.ssl": "#ifdef NOPE\n#error boom\n#endif\nkept" }).trim()).toBe("kept");
    });

    it("drops a line directive without disturbing the text", () => {
        // Honouring it would renumber our diagnostics away from the file the reader can actually open.
        expect(run({ "main.ssl": "#line 100\nkept" }).trim()).toBe("kept");
    });
});

/**
 * Each of these is rejected by the toolchain's own preprocessor as an unknown directive, so accepting it
 * here would build a script that then fails to build there. Verified against it rather than assumed.
 */
describe("directives the toolchain itself rejects bail loudly", () => {
    it.each(["warning hm", "ident x", "sccs x", "assert x", "unassert x"])("rejects #%s", (directive) => {
        expect(() => run({ "main.ssl": `#${directive}` })).toThrow(/is not supported/);
    });

    it("rejects a GNU named variadic parameter", () => {
        expect(() => run({ "main.ssl": "#define LOG(fmt, args...) f(fmt)\n" })).toThrow(
            /named variadic parameters are not supported/,
        );
    });

    it("rejects an unknown directive", () => {
        expect(() => run({ "main.ssl": "#bogus" })).toThrow(/unknown directive #bogus/);
    });

    /**
     * A skipped branch is where a silently-ignored directive would hide: nothing downstream ever shows a
     * difference. A conforming preprocessor may ignore these, but we would rather reject a file we cannot
     * fully model than emit a translation unit that quietly omits something.
     */
    it.each(["warning hm", "bogus"])("rejects #%s even inside a skipped branch", (directive) => {
        expect(() => run({ "main.ssl": `#ifdef NOPE\n#${directive}\n#endif` })).toThrow(PreprocessError);
    });
});

/**
 * Every directive problem in one pass, rather than one per build.
 *
 * The preprocessor is the one stage where collecting is unambiguously right: its errors are independent
 * of each other - an unknown directive on line 3 tells you nothing about a missing header on line 20 -
 * and the compile stops before lowering either way, so a skipped `#include` never gets the chance to
 * turn into a hundred unknown-name errors downstream.
 */
describe("reporting more than one problem", () => {
    /** The whole list a refused run carries. */
    function errorsOf(files: Record<string, string>, entry = "main.ssl"): readonly PreprocessError[] {
        for (const [name, body] of Object.entries(files)) {
            const target = path.join(dir, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, body);
        }
        try {
            preprocess(path.join(dir, entry));
        } catch (error) {
            if (error instanceof PreprocessError) return error.all;
            throw error;
        }
        throw new Error("expected preprocessing to be refused");
    }

    it("names every bad directive, not just the first", () => {
        const errors = errorsOf({ "main.ssl": "#bogus\nx := 1;\n#warning hm\n#alsobogus\n" });

        expect(errors.map((e) => e.line)).toEqual([1, 3, 4]);
        expect(errors.map((e) => e.detail)).toEqual([
            "unknown directive #bogus",
            "#warning is not supported",
            "unknown directive #alsobogus",
        ]);
    });

    it("keeps scanning past a header it cannot find", () => {
        const errors = errorsOf({ "main.ssl": '#include "nope.h"\n#bogus\n' });

        expect(errors.map((e) => e.detail)).toEqual(['cannot find include "nope.h"', "unknown directive #bogus"]);
    });

    it("reports problems in an included header against the header", () => {
        const errors = errorsOf({ "main.ssl": '#include "bad.h"\n#bogus\n', "bad.h": "#nonsense\n" });

        expect(errors[0]).toMatchObject({ line: 1, detail: "unknown directive #nonsense" });
        expect(errors[0]!.file).toMatch(/bad\.h$/);
        expect(errors[1]!.file).toMatch(/main\.ssl$/);
    });

    it("takes an unevaluable condition as false and carries on", () => {
        const errors = errorsOf({ "main.ssl": "#if (1\n#endif\n#bogus\n" });

        expect(errors.map((e) => e.detail)).toEqual(["unbalanced ( in #if", "unknown directive #bogus"]);
    });

    it("reports an unbalanced conditional at the end of the file", () => {
        const errors = errorsOf({ "main.ssl": "#endif\n#ifdef A\nx := 1;\n" });

        expect(errors.map((e) => e.detail)).toEqual(["#endif without #if", "unterminated #if"]);
    });

    it("folds a header's errors when two files include it unguarded", () => {
        // Otherwise every error in a widely-included header is repeated once per includer, which buries
        // the one mistake that is actually in the file the user is editing.
        const errors = errorsOf({
            "main.ssl": '#include "a.h"\n#include "b.h"\n',
            "a.h": '#include "bad.h"\n',
            "b.h": '#include "bad.h"\n',
            "bad.h": "#nonsense\n",
        });

        expect(errors).toHaveLength(1);
    });

    it("keeps the first error's message and position exactly as a single-error run had them", () => {
        // The language server places the diagnostic from these, and a caller that shows one error still
        // shows this one, so the aggregate may not change how the first one reads.
        expect(() => run({ "main.ssl": "x := 1;\n#bogus\n#alsobogus\n" })).toThrow(/main\.ssl:2: unknown directive/);
        expect(errorsOf({ "main.ssl": "x := 1;\n#bogus\n#alsobogus\n" })[0]).toMatchObject({
            line: 2,
            detail: "unknown directive #bogus",
        });
    });
});

/**
 * `preprocessText` is what an editor compiles a buffer with: the file it names may hold older text, or
 * may not exist at all, so the path is used for resolution and attribution but never read.
 */
describe("preprocessing text that is not on disk", () => {
    /** Write `files` into the sandbox, then preprocess `text` as if it were `dir/main.ssl`. */
    function runText(text: string, files: Record<string, string> = {}, options = {}): string {
        for (const [name, body] of Object.entries(files)) {
            const target = path.join(dir, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, body);
        }
        const out = preprocessText(text, path.join(dir, "main.ssl"), options);
        return (out.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*|\d+|:=|[^\s]/g) ?? []).join(" ");
    }

    it("expands macros in text with no file behind it", () => {
        expect(runText("#define N 3\nx := N;")).toBe("x := 3 ;");
    });

    it("resolves a quoted include against the directory the text claims to be in", () => {
        expect(runText('#include "inc/h.h"\nx := N;', { "inc/h.h": "#define N 9\n" })).toBe("x := 9 ;");
    });

    it("compiles the text given rather than the file of the same name on disk", () => {
        // The case the editor is in constantly: the buffer has moved on from what was last saved.
        expect(runText("x := 2;", { "main.ssl": "x := 1;" })).toBe("x := 2 ;");
    });

    it("attributes an error in the text to the path it was given", () => {
        expect(() => runText("x := 1;\n#bogus\n")).toThrow(/main\.ssl:2: unknown directive/);
    });

    it("still reports an error inside an include against the header", () => {
        expect(() => runText('#include "inc/h.h"\n', { "inc/h.h": "#bogus\n" })).toThrow(/h\.h:1: unknown directive/);
    });
});

/**
 * Per-line origins: which file and line each line of the preprocessed output came from.
 *
 * The compiler positions its diagnostics in the PREPROCESSED text, and directives vanish from it while
 * includes splice whole files into it - so without this map, every error below the first directive is
 * reported on a line the author never wrote. The map is what lets the file layer put them back.
 */
describe("line origins", () => {
    function preprocessed(files: Record<string, string>, entry = "main.ssl") {
        for (const [name, body] of Object.entries(files)) {
            const target = path.join(dir, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, body);
        }
        return { result: preprocessWithOrigins(path.join(dir, entry)), path: (name: string) => path.join(dir, name) };
    }

    it("keeps one origin per output line", () => {
        const { result } = preprocessed({ "main.ssl": "#define X 9\nx := X;\n/* a\nb */ y := 2;\n" });
        expect(result.origins.length).toBe(result.text.split("\n").length);
    });

    it("matches the text the string-returning form produces, byte for byte", () => {
        const source = '#define X 9\n#include "h.h"\nx := X;\n';
        const { result, path: at } = preprocessed({ "main.ssl": source, "h.h": "variable hv := N;\n#define N 3\n" });
        expect(result.text).toBe(preprocess(at("main.ssl")));
    });

    it("names the source line a directive pushed out of place", () => {
        // Lines 1-2 vanish with their directives, so `x := 9;` is output line 1 - and its origin must
        // say it was written on line 3.
        const { result, path: at } = preprocessed({ "main.ssl": "#define X 9\n#define Y 8\nx := X;\ny := Y;\n" });
        expect(result.origins[0]).toEqual({ file: at("main.ssl"), line: 3 });
        expect(result.origins[1]).toEqual({ file: at("main.ssl"), line: 4 });
    });

    it("attributes an included file's lines to that file", () => {
        const { result, path: at } = preprocessed({
            "main.ssl": '#include "hdr.h"\nx := 1;\n',
            "hdr.h": "variable hv := 3;\n",
        });
        expect(result.origins[0]).toEqual({ file: at("hdr.h"), line: 1 });
        // The header contributed two output lines (its content and its trailing line), so the entry's
        // own line 2 sits at output line 3.
        expect(result.origins[2]).toEqual({ file: at("main.ssl"), line: 2 });
    });

    it("keeps origins straight past a skipped conditional branch", () => {
        const { result, path: at } = preprocessed({ "main.ssl": "#ifdef NOPE\nskipped\n#endif\nafter := 1;\n" });
        expect(result.origins[0]).toEqual({ file: at("main.ssl"), line: 4 });
    });

    it("attributes the blank filler of a multi-line call to the lines it consumed", () => {
        const { result, path: at } = preprocessed({
            "main.ssl": "#define M(a,b) a + b\nx := M(1,\n2);\nnext := 3;\n",
        });
        expect(result.origins[0]).toEqual({ file: at("main.ssl"), line: 2 });
        expect(result.origins[1]).toEqual({ file: at("main.ssl"), line: 3 });
        expect(result.origins[2]).toEqual({ file: at("main.ssl"), line: 4 });
    });
});
