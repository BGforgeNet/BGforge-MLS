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
import { tokenizeBaf, initTokenizerFromBytes, type Span } from "../src/dialog-editor/webview/highlight/tokenize";

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

    it("emits non-overlapping spans so the renderer cannot double-paint a character", () => {
        // highlights.scm captures an object_ref ([PC]) as @constant while separately capturing its own "["
        // and "]" tokens as @punctuation.bracket. Those captures genuinely overlap, so the tokenizer must
        // arbitrate: without this the renderer paints the same characters twice and duplicates the text.
        const text = "See([PC])";
        const spans = tokenizeBaf(text, "condition");
        for (let i = 1; i < spans.length; i += 1) {
            expect(spans[i]!.start, `span ${i} must not overlap its predecessor`).toBeGreaterThanOrEqual(
                spans[i - 1]!.end,
            );
        }
        // Outermost wins: the whole [PC] reads as one constant, not a bracket/constant/bracket sandwich.
        expect(roleAt(text, "[PC]", spans)).toBe("constant");
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

describe("tokenizeBaf - points vs object refs", () => {
    // The BAF grammar disambiguates these structurally (numeric components are a point, named components an
    // object ref) because the engine itself needs the called function's signature to tell them apart. These
    // assert the distinction survives all the way to a paintable role.
    it("colours a numeric coordinate pair as a number, not an object ref", () => {
        const text = "MoveToPoint([10.10])";
        expect(roleAt(text, "[10.10]", tokenizeBaf(text, "action"))).toBe("number");
    });

    it("colours a mixed numeric and variable coordinate pair as a number", () => {
        const text = 'CreateCreature("x",[200.%py%],0)';
        expect(roleAt(text, "[200.%py%]", tokenizeBaf(text, "action"))).toBe("number");
    });

    it("colours a two-component EA.GENERAL specifier as a constant, not a number", () => {
        const text = "Kill([NOTGOOD.HUMANOID])";
        expect(roleAt(text, "[NOTGOOD.HUMANOID]", tokenizeBaf(text, "action"))).toBe("constant");
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

describe("tokenizeBaf before initialization", () => {
    it("returns no spans so the caller renders flat text instead of blank", async () => {
        vi.resetModules();
        const fresh = await import("../src/dialog-editor/webview/highlight/tokenize");
        expect(fresh.tokenizeBaf("General(Myself,NEUTRAL)", "condition")).toEqual([]);
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
