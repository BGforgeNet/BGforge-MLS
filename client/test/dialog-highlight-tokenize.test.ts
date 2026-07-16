/**
 * Tests for the dialog editor's tree-sitter BAF tokenizer.
 *
 * Initialises from the real grammar wasm and the real highlights.scm rather than a stub: the tokenizer's whole
 * job is to turn that query's captures into paintable spans, so a stubbed query would only re-assert the test's
 * own fixture. Both wasm files are gitignored build outputs of `pnpm build:grammar`.
 *
 * Every fixture below is a BARE fragment, matching what the inspector's fields actually hold (state.trigger,
 * c.condition, c.action) - never a whole IF/THEN/END script. That is the case the tokenizer exists to serve.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
    tokenizeBaf,
    initTokenizerFromBytes,
    toParts,
    type Span,
} from "../src/dialog-editor/webview/highlight/tokenize";

const REPO_ROOT = path.resolve(__dirname, "../..");
// The grammar artefact is `tree-sitter-baf.wasm`, not `weidu-baf.wasm` - the name comes from the grammar's
// internal name in tree-sitter.json, not its directory. Source of truth: shared/parsers/weidu-baf.ts:8.
const GRAMMAR_WASM = path.join(REPO_ROOT, "grammars/weidu-baf/tree-sitter-baf.wasm");
const RUNTIME_WASM = path.join(REPO_ROOT, "node_modules/web-tree-sitter/web-tree-sitter.wasm");
const HIGHLIGHTS_SCM = path.join(REPO_ROOT, "grammars/weidu-baf/queries/highlights.scm");

/** The role covering a substring, or undefined if no span covers it. */
function roleAt(text: string, target: string, spans: Span[]): string | undefined {
    const at = text.indexOf(target);
    expect(at, `fixture must contain ${target}`).toBeGreaterThanOrEqual(0);
    return spans.find((s) => s.start <= at && s.end >= at + target.length)?.role;
}

beforeAll(async () => {
    await initTokenizerFromBytes(
        new Uint8Array(readFileSync(RUNTIME_WASM)),
        new Uint8Array(readFileSync(GRAMMAR_WASM)),
        readFileSync(HIGHLIGHTS_SCM, "utf-8"),
    );
});

describe("tokenizeBaf - condition fragments", () => {
    it("assigns trigger and constant roles to a bare condition", () => {
        // The field holds exactly this - no IF/THEN wrapper. Parsed alone it does not even produce a
        // call_expr, so this asserts the synthetic context is doing its job.
        const text = "General(Myself,NEUTRAL)";
        const spans = tokenizeBaf(text, "condition");
        expect(roleAt(text, "General", spans)).toBe("trigger");
        expect(roleAt(text, "Myself", spans)).toBe("constant");
        expect(roleAt(text, "NEUTRAL", spans)).toBe("constant");
    });

    it("assigns string and number roles inside a condition", () => {
        const text = 'Global("foo","GLOBAL",1)';
        const spans = tokenizeBaf(text, "condition");
        expect(roleAt(text, "Global", spans)).toBe("trigger");
        expect(roleAt(text, '"foo"', spans)).toBe("string");
        expect(roleAt(text, "1", spans)).toBe("number");
    });

    it("returns spans in the fragment's own coordinates, with no wrapper text leaking in", () => {
        // The tokenizer parses inside a synthetic IF/THEN block; if the offset rebase were wrong, every span
        // would be shifted by the prefix length and the overlay would paint the wrong characters.
        const text = "General(Myself,NEUTRAL)";
        const spans = tokenizeBaf(text, "condition");
        expect(spans[0]).toEqual({ start: 0, end: 7, role: "trigger" });
        for (const span of spans) {
            expect(span.start).toBeGreaterThanOrEqual(0);
            expect(span.end).toBeLessThanOrEqual(text.length);
        }
        // No keyword span: IF/THEN belong to the wrapper, not the field.
        expect(spans.some((s) => s.role === "keyword")).toBe(false);
    });

    it("scopes an object specifier per component, leaving its brackets punctuation", () => {
        // The bracket is not part of the value: the component is the constant, the brackets and dots are
        // punctuation. This mirrors the TextMate grammar, which scopes the same form via #object-specifiers.
        const text = "See([PC])";
        const spans = tokenizeBaf(text, "condition");
        expect(roleAt(text, "PC", spans)).toBe("constant");
        expect(roleAt(text, "[", spans)).toBe("punctuation");
        expect(roleAt(text, "]", spans)).toBe("punctuation");
    });

    it("emits ordered spans that never cover the same character twice", () => {
        // The renderer walks spans in order and would duplicate text if two covered one character.
        const text = "See([NOTGOOD.HUMANOID])";
        const spans = tokenizeBaf(text, "condition");
        expect(spans.length).toBeGreaterThan(0);
        for (let i = 1; i < spans.length; i += 1) {
            expect(spans[i]!.start, `span ${i} must start at or after its predecessor's end`).toBeGreaterThanOrEqual(
                spans[i - 1]!.end,
            );
        }
    });
});

describe("tokenizeBaf - action fragments", () => {
    it("assigns the action role to a bare action, distinguishing it from a trigger", () => {
        // Same call syntax as a condition; only the surrounding context makes it an action. This is the
        // assertion that catches the two wrappers being swapped.
        const text = 'SetGlobal("x","GLOBAL",1)';
        const spans = tokenizeBaf(text, "action");
        expect(roleAt(text, "SetGlobal", spans)).toBe("action");
        expect(tokenizeBaf(text, "condition").find((s) => s.start === 0)?.role).toBe("trigger");
    });

    it("assigns constant to a CamelCase object-id, which casing could not reach", () => {
        // The TextMate side matches constants by casing and cannot reach these; tree-sitter matches by
        // position (call_expr args:), so it can. This asserts the capability difference actually pays off.
        const text = "Kill(NearestEnemyOf)";
        const spans = tokenizeBaf(text, "action");
        expect(roleAt(text, "NearestEnemyOf", spans)).toBe("constant");
    });
});

describe("tokenizeBaf - points vs object specifiers", () => {
    // The grammar tells these apart structurally (two numeric/variable components is a point, anything else a
    // specifier) because the engine itself needs the called function's signature to know. These assert the
    // distinction survives to a paintable role, and that each token keeps its own - a coordinate is a number,
    // a specifier component is a constant, and neither swallows its brackets.
    it("colours a coordinate as a number, not as part of an object specifier", () => {
        const text = "MoveToPoint([10.10])";
        const spans = tokenizeBaf(text, "action");
        expect(roleAt(text, "10", spans)).toBe("number");
        expect(roleAt(text, ".", spans)).toBe("punctuation");
    });

    it("keeps a variable coordinate a variable - neither a number nor a constant", () => {
        // The whole point used to be captured as one @number, which painted %py% - a variable - as a number.
        // Its role is `variable`, not `constant`: the TextMate grammar scopes it variable.parameter, a
        // separate colour from constant.* in any theme that styles both, so folding the two here would undo
        // the distinction on the webview side only.
        const text = 'CreateCreature("x",[200.%py%],0)';
        const spans = tokenizeBaf(text, "action");
        expect(roleAt(text, "200", spans)).toBe("number");
        expect(roleAt(text, "%py%", spans)).toBe("variable");
    });

    it("colours a named specifier component as a constant and a numeric one as a number", () => {
        // Both are IDS values, and the TextMate side scopes them constant.other and constant.numeric - two
        // constant.* scopes a theme is free to paint alike (bgforge-monokai does) or apart. The role split
        // here carries the same information.
        const named = "Kill([NOTGOOD.HUMANOID])";
        expect(roleAt(named, "NOTGOOD", tokenizeBaf(named, "action"))).toBe("constant");
        const numeric = "Kill([0.0.0.MAGE_ALL])";
        const spans = tokenizeBaf(numeric, "action");
        expect(roleAt(numeric, "0", spans)).toBe("number");
        expect(roleAt(numeric, "MAGE_ALL", spans)).toBe("constant");
    });
});

describe("tokenizeBaf - degradation", () => {
    it("returns the spans it can for a half-typed call rather than throwing", () => {
        // tree-sitter is error-tolerant: a call whose paren is not yet closed keeps its own names under an
        // ERROR node, so they stay uncoloured until it closes. Partial, never wrong, never blank.
        const spans = tokenizeBaf("General(Myself,", "condition");
        expect(() => tokenizeBaf("General(Myself,", "condition")).not.toThrow();
        expect(spans.every((s) => s.start >= 0 && s.end <= "General(Myself,".length)).toBe(true);
    });

    it("returns no spans for empty input", () => {
        expect(tokenizeBaf("", "condition")).toEqual([]);
        expect(tokenizeBaf("", "action")).toEqual([]);
    });
});

describe("tokenizeBaf - the synthetic wrapper must survive the fragment", () => {
    // A BAF comment runs to end of line, so a wrapper whose suffix shares the fragment's last line gets
    // commented out and stops closing the block. Both kinds are asserted because only the condition wrapper
    // ever had the bug - the action one always put its `END` on a new line - so a one-kind test would have
    // gone green against the broken wrapper.
    it.each([
        ["condition", 'Global("a","GLOBAL",1) // why'],
        ["action", 'SetGlobal("a","GLOBAL",1) // why'],
    ] as const)("colours a trailing comment in a %s without losing the rest of the line", (kind, text) => {
        const spans = tokenizeBaf(text, kind);
        expect(roleAt(text, "// why", spans)).toBe("comment");
        // The call itself must still be recognised: if the comment ate the wrapper, the fragment lands under
        // an ERROR node and the call name loses its role while the comment keeps one.
        expect(spans[0]!.role).toBe(kind === "condition" ? "trigger" : "action");
    });
});

describe("toParts", () => {
    // The overlay paints these runs in a layer sitting exactly on top of the textarea's own text, so the
    // runs must reconstruct the field's text character-for-character. Any drop or duplication shifts every
    // following character out from under the caret.
    it("reconstructs the text exactly, whatever the spans", () => {
        const text = 'Global("foo","GLOBAL",1)';
        expect(
            toParts(text, tokenizeBaf(text, "condition"))
                .map((p) => p.text)
                .join(""),
        ).toBe(text);
    });

    it("keeps the gaps between spans as unroled runs", () => {
        // Punctuation and whitespace between captures still has to be emitted, or the overlay loses it.
        expect(toParts("ab", [{ start: 1, end: 2, role: "number" }])).toEqual([
            { text: "a" },
            { text: "b", role: "number" },
        ]);
    });

    it("emits a trailing run after the last span", () => {
        expect(toParts("ab", [{ start: 0, end: 1, role: "number" }])).toEqual([
            { text: "a", role: "number" },
            { text: "b" },
        ]);
    });

    it("renders text with no spans as a single plain run", () => {
        // The degraded path: an uninitialised or failed tokenizer must still render the field's text.
        expect(toParts("General(Myself)", [])).toEqual([{ text: "General(Myself)" }]);
    });

    it("returns nothing for empty text", () => {
        expect(toParts("", [])).toEqual([]);
    });
});

describe("tokenizeBaf before initialization", () => {
    it("returns no spans so the caller renders flat text instead of blank", async () => {
        vi.resetModules();
        const fresh = await import("../src/dialog-editor/webview/highlight/tokenize");
        expect(fresh.tokenizeBaf("General(Myself,NEUTRAL)", "condition")).toEqual([]);
    });

    it("leaves tokenizerReady pending until init completes, then resolves it", async () => {
        // The renderer mounts before the host can supply the wasm, so this promise is what re-renders a
        // field from flat to coloured. If it resolved eagerly, the fields would never re-render and the
        // feature would be invisible in the live panel while every test here still passed.
        vi.resetModules();
        const fresh = await import("../src/dialog-editor/webview/highlight/tokenize");
        const pending = Symbol("pending");
        expect(await Promise.race([fresh.tokenizerReady(), Promise.resolve(pending)])).toBe(pending);

        await fresh.initTokenizerFromBytes(
            new Uint8Array(readFileSync(RUNTIME_WASM)),
            new Uint8Array(readFileSync(GRAMMAR_WASM)),
            readFileSync(HIGHLIGHTS_SCM, "utf-8"),
        );
        await expect(fresh.tokenizerReady()).resolves.toBeUndefined();
    });
});

describe("initTokenizer", () => {
    it("fetches each wasm from the URI it was given and tokenizes with the result", async () => {
        // The webview path: the host resolves both URIs via asWebviewUri and the webview fetches them. The
        // two wasms are not interchangeable - handing the grammar to Parser.init, or the runtime to
        // Language.load, fails only in the live webview, where nothing else here would catch it.
        const bytes: Record<string, Buffer> = {
            "https://example/web-tree-sitter.wasm": readFileSync(RUNTIME_WASM),
            "https://example/tree-sitter-baf.wasm": readFileSync(GRAMMAR_WASM),
        };
        const fetched: string[] = [];
        vi.stubGlobal("fetch", (uri: string) => {
            fetched.push(uri);
            const body = bytes[uri];
            if (!body) {
                throw new Error(`unexpected fetch: ${uri}`);
            }
            // Copy out of the Buffer rather than handing over `.buffer`: readFileSync returns a view into a
            // shared pool, so the raw ArrayBuffer is not the file's bytes.
            return Promise.resolve({ arrayBuffer: () => Promise.resolve(Uint8Array.from(body).buffer) });
        });

        vi.resetModules();
        const fresh = await import("../src/dialog-editor/webview/highlight/tokenize");
        await fresh.initTokenizer(
            "https://example/web-tree-sitter.wasm",
            "https://example/tree-sitter-baf.wasm",
            readFileSync(HIGHLIGHTS_SCM, "utf-8"),
        );

        expect(fetched).toEqual(["https://example/web-tree-sitter.wasm", "https://example/tree-sitter-baf.wasm"]);
        const text = "General(Myself,NEUTRAL)";
        expect(roleAt(text, "General", fresh.tokenizeBaf(text, "condition"))).toBe("trigger");
        vi.unstubAllGlobals();
    });
});
