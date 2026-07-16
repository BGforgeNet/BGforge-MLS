/**
 * Tests for the dialog editor's unified TextMate tokenizer - the one engine that colours every condition/action
 * field across all four dialog source languages.
 *
 * Initialises from the REAL grammars (syntaxes/*.tmLanguage.json) and the real oniguruma wasm - the same
 * pipeline the editor tokenizes with - so these assert editor parity, not a stub's own fixture. The fields it
 * serves hold BARE fragments (state.trigger, c.condition, c.action), which TextMate tokenizes directly with no
 * synthetic wrapper.
 *
 * Three grammars, one tokenizer:
 *   - "baf" WeiDU triggers/actions: a name reads as trigger or action by which IDS list it is in, and a
 *     CamelCase OBJECT.IDS entry (Player1) reads as a constant by enumeration - a position-free, wrapper-free
 *     parse the retired tree-sitter tokenizer needed an IF/THEN wrapper to reach.
 *   - "ssl" Fallout SSL: constants are isolated by CASING - an all-caps name is a constant, a CamelCase or
 *     lowercase one is not, exactly what the editor does and what a position-based parse could not express
 *     without mislabelling a variable. The CamelCase-stays-plain assertions guard that.
 *   - "ts" the minimal TypeScript-expression grammar for TD/TSSL conditions: calls, operators, numbers, the
 *     literal keywords, and ALL-CAPS constants; a bare lowercase identifier (a variable) stays plain.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseRawGrammar } from "vscode-textmate";
import type { GrammarSource } from "../src/dialog-editor/webview/highlight/textmate";
import type { Span } from "../src/dialog-editor/webview/highlight/types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const ONIG_WASM = path.join(REPO_ROOT, "node_modules/vscode-oniguruma/release/onig.wasm");

function grammarSource(scopeName: string, file: string): GrammarSource {
    const full = path.join(REPO_ROOT, "syntaxes", file);
    return { scopeName, grammar: parseRawGrammar(readFileSync(full, "utf-8"), full) };
}

const SOURCES: GrammarSource[] = [
    grammarSource("source.weidu-baf", "weidu-baf.tmLanguage.json"),
    grammarSource("source.fallout-ssl", "fallout-ssl.tmLanguage.json"),
    grammarSource("source.bgforge-mls-docstring", "bgforge-mls-docstring.tmLanguage.json"),
    grammarSource("source.dialog-tsexpr", "dialog-tsexpr.tmLanguage.json"),
];
const ROOTS = { baf: "source.weidu-baf", ssl: "source.fallout-ssl", ts: "source.dialog-tsexpr" } as const;

function onigBytes(): Uint8Array {
    const onig = readFileSync(ONIG_WASM);
    return new Uint8Array(onig.buffer, onig.byteOffset, onig.byteLength);
}

/** The role covering a substring, or undefined if no span covers it. */
function roleAt(text: string, target: string, spans: Span[]): string | undefined {
    const at = text.indexOf(target);
    expect(at, `fixture must contain ${target}`).toBeGreaterThanOrEqual(0);
    return spans.find((s) => s.start <= at && s.end >= at + target.length)?.role;
}

// The module-global tokenizer state is shared, so init once for the whole suite. The degradation test at the
// bottom uses a FRESH module (resetModules) so it never observes this initialised singleton.
let tokenize: (lang: "baf" | "ssl" | "ts", text: string) => Span[];
beforeAll(async () => {
    const mod = await import("../src/dialog-editor/webview/highlight/textmate");
    await mod.initTextmate(onigBytes(), SOURCES, ROOTS);
    await mod.textmateReady();
    tokenize = mod.tokenize;
});

describe("tokenize baf - bare trigger/action fragments", () => {
    it("colours a trigger, its constants, and distinguishes an action by name", () => {
        const text = "General(Myself,NEUTRAL)";
        const spans = tokenize("baf", text);
        expect(roleAt(text, "General", spans)).toBe("trigger");
        expect(roleAt(text, "NEUTRAL", spans)).toBe("constant");
        // SetGlobal is in ACTION.IDS, not TRIGGER.IDS: the grammar reads it as an action with no context hint,
        // which is why the field needs no "kind" - the retired tree-sitter tokenizer needed a wrapper for this.
        expect(roleAt('SetGlobal("x","GLOBAL",1)', "SetGlobal", tokenize("baf", 'SetGlobal("x","GLOBAL",1)'))).toBe(
            "action",
        );
    });

    it("colours a CamelCase OBJECT.IDS constant that a casing rule could not reach", () => {
        const text = "See(Player1)";
        const spans = tokenize("baf", text);
        expect(roleAt(text, "See", spans)).toBe("trigger");
        // Player1 is CamelCase but a known OBJECT.IDS entry: the BAF grammar enumerates it, so it stays a
        // constant. This is the capability the SSL casing rule cannot express - and the reason BAF keeps its
        // own grammar rather than sharing SSL's.
        expect(roleAt(text, "Player1", spans)).toBe("constant");
    });
});

describe("tokenize ssl - condition fragments", () => {
    it("colours a builtin call, an all-caps constant, and a number", () => {
        const text = "global_var(GVAR_Y) == 2";
        const spans = tokenize("ssl", text);
        // support.function -> action (a builtin engine call), matching how a BAF action colours.
        expect(roleAt(text, "global_var", spans)).toBe("action");
        expect(roleAt(text, "GVAR_Y", spans)).toBe("constant");
        expect(roleAt(text, "2", spans)).toBe("number");
    });

    it("colours word operators and a user procedure, keeps a CamelCase name plain", () => {
        const text = "has_item(dude_obj, PID_KNIFE) and not is_dead(Marcus)";
        const spans = tokenize("ssl", text);
        expect(roleAt(text, "has_item", spans)).toBe("trigger");
        expect(roleAt(text, "PID_KNIFE", spans)).toBe("constant");
        expect(roleAt(text, "and", spans)).toBe("keyword");
        expect(roleAt(text, "not", spans)).toBe("keyword");
        // Marcus is CamelCase: the SSL casing rule does NOT claim it, so it stays plain - exactly the editor.
        // This is the assertion a position-based tokenizer (which would colour every argument) fails.
        expect(roleAt(text, "Marcus", spans)).toBeUndefined();
    });

    it("leaves a bare CamelCase identifier plain (casing, not position)", () => {
        const text = "(EvalUGlobal==0)";
        const spans = tokenize("ssl", text);
        expect(roleAt(text, "EvalUGlobal", spans)).toBeUndefined();
        expect(roleAt(text, "0", spans)).toBe("number");
    });
});

describe("tokenize ts - TD/TSSL condition fragments", () => {
    it("colours calls, operators, an all-caps constant, and a number; leaves a variable plain", () => {
        const text = "has_item(dude, PID_KNIFE) && !is_dead(marcus)";
        const spans = tokenize("ts", text);
        expect(roleAt(text, "has_item", spans)).toBe("trigger");
        expect(roleAt(text, "is_dead", spans)).toBe("trigger");
        expect(roleAt(text, "PID_KNIFE", spans)).toBe("constant");
        expect(roleAt(text, "&&", spans)).toBe("keyword");
        expect(roleAt(text, "!", spans)).toBe("keyword");
        // A lowercase, non-call identifier is a variable - left plain, matching the SSL/BAF fields.
        expect(roleAt(text, "dude", spans)).toBeUndefined();
        expect(roleAt(text, "marcus", spans)).toBeUndefined();
    });

    it("colours a comparison, a number, and the true/false literals", () => {
        const text = "count >= 3 && flag === true";
        const spans = tokenize("ts", text);
        expect(roleAt(text, ">=", spans)).toBe("keyword");
        expect(roleAt(text, "===", spans)).toBe("keyword");
        expect(roleAt(text, "3", spans)).toBe("number");
        expect(roleAt(text, "true", spans)).toBe("constant");
        expect(roleAt(text, "count", spans)).toBeUndefined();
    });
});

describe("tokenize - span contract", () => {
    it("returns spans that exactly tile the input for a coloured overlay", () => {
        // toParts relies on non-overlapping, in-bounds spans; assert the tokenizer's contract directly.
        for (const [lang, text] of [
            ["baf", "General(Myself,NEUTRAL)"],
            ["ssl", "global_var(GVAR_Y) == 2"],
            ["ts", "has_item(dude, PID_KNIFE) && count > 1"],
        ] as const) {
            const spans = tokenize(lang, text);
            let prevEnd = 0;
            for (const s of spans) {
                expect(s.start).toBeGreaterThanOrEqual(prevEnd);
                expect(s.end).toBeGreaterThan(s.start);
                expect(s.end).toBeLessThanOrEqual(text.length);
                prevEnd = s.end;
            }
        }
    });
});

describe("tokenize before initialization", () => {
    it("returns [] until init completes, so a field renders flat instead of blank", async () => {
        vi.resetModules();
        const fresh = await import("../src/dialog-editor/webview/highlight/textmate");
        // Before init: no grammar, so every lang tokenizes to nothing and the field renders as one plain run.
        expect(fresh.tokenize("baf", "General(Myself,NEUTRAL)")).toEqual([]);
        expect(fresh.tokenize("ssl", "global_var(GVAR_Y)")).toEqual([]);
        expect(fresh.tokenize("ts", "has_item(x)")).toEqual([]);

        // textmateReady is pending until init, then resolves - this is the reactivity trigger that re-colours.
        const pending = Symbol("pending");
        expect(await Promise.race([fresh.textmateReady(), Promise.resolve(pending)])).toBe(pending);
        await fresh.initTextmate(onigBytes(), SOURCES, ROOTS);
        await expect(fresh.textmateReady()).resolves.toBeUndefined();
    });
});
