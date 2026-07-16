/**
 * Tests for the dialog editor's TextMate SSL tokenizer.
 *
 * Initialises from the REAL grammar (syntaxes/fallout-ssl.tmLanguage.json + its bgforge-mls-docstring include)
 * and the real oniguruma wasm - the same pipeline the editor tokenizes with - so these assert editor parity,
 * not a stub's own fixture. The fields it serves hold BARE SSL condition expressions (c.condition), which
 * TextMate tokenizes directly with no synthetic wrapper.
 *
 * The point of the whole approach is that SSL constants are isolated by CASING, not position: an all-caps name
 * is a constant, a CamelCase or lowercase one is not - exactly what the editor does, and what a position-based
 * parse could not express without mislabelling a variable. The CamelCase-stays-plain assertions guard that.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRawGrammar } from "vscode-textmate";
import {
    initSslTokenizer,
    sslTokenizerReady,
    tokenizeSsl,
    type GrammarSource,
} from "../src/dialog-editor/webview/highlight/textmate";
import type { Span } from "../src/dialog-editor/webview/highlight/types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const ONIG_WASM = path.join(REPO_ROOT, "node_modules/vscode-oniguruma/release/onig.wasm");

function grammarSource(scopeName: string, file: string): GrammarSource {
    const full = path.join(REPO_ROOT, "syntaxes", file);
    return { scopeName, grammar: parseRawGrammar(readFileSync(full, "utf-8"), full) };
}

/** The role covering a substring, or undefined if no span covers it. */
function roleAt(text: string, target: string, spans: Span[]): string | undefined {
    const at = text.indexOf(target);
    expect(at, `fixture must contain ${target}`).toBeGreaterThanOrEqual(0);
    return spans.find((s) => s.start <= at && s.end >= at + target.length)?.role;
}

beforeAll(async () => {
    const onig = readFileSync(ONIG_WASM);
    await initSslTokenizer(new Uint8Array(onig.buffer, onig.byteOffset, onig.byteLength), [
        grammarSource("source.fallout-ssl", "fallout-ssl.tmLanguage.json"),
        grammarSource("source.bgforge-mls-docstring", "bgforge-mls-docstring.tmLanguage.json"),
    ]);
    await sslTokenizerReady();
});

describe("tokenizeSsl - condition fragments", () => {
    it("colours a builtin call, an all-caps constant, and a number", () => {
        const text = "global_var(GVAR_Y) == 2";
        const spans = tokenizeSsl(text);
        // support.function -> action (a builtin engine call), matching how a BAF action colours.
        expect(roleAt(text, "global_var", spans)).toBe("action");
        // GVAR_Y is all-caps: the casing rule claims it as a constant.
        expect(roleAt(text, "GVAR_Y", spans)).toBe("constant");
        expect(roleAt(text, "2", spans)).toBe("number");
    });

    it("colours word operators and a user procedure, keeps a CamelCase name plain", () => {
        const text = "has_item(dude_obj, PID_KNIFE) and not is_dead(Marcus)";
        const spans = tokenizeSsl(text);
        // entity.name.function -> trigger (a user/engine procedure), like a BAF trigger.
        expect(roleAt(text, "has_item", spans)).toBe("trigger");
        expect(roleAt(text, "PID_KNIFE", spans)).toBe("constant");
        // `and`/`not` carry keyword.control in this grammar, same as an operator - both are keyword.
        expect(roleAt(text, "and", spans)).toBe("keyword");
        expect(roleAt(text, "not", spans)).toBe("keyword");
        // Marcus is CamelCase: the casing rule does NOT claim it, so it stays plain - exactly the editor.
        // This is the assertion a position-based tokenizer (which would colour every argument) fails.
        expect(roleAt(text, "Marcus", spans)).toBeUndefined();
    });

    it("colours the > operator and a numeric, leaves a CamelCase global plain", () => {
        const text = "global_var(GVAR_X) == 1 and local_var(LVAR_z) > 0";
        const spans = tokenizeSsl(text);
        expect(roleAt(text, ">", spans)).toBe("keyword");
        expect(roleAt(text, "LVAR_z", spans)).toBe("constant");
        expect(roleAt(text, "0", spans)).toBe("number");
    });

    it("leaves a bare CamelCase identifier plain (casing, not position)", () => {
        const text = "(EvalUGlobal==0)";
        const spans = tokenizeSsl(text);
        expect(roleAt(text, "EvalUGlobal", spans)).toBeUndefined();
        expect(roleAt(text, "0", spans)).toBe("number");
    });

    it("returns spans that exactly tile the input for a coloured overlay", () => {
        // toParts relies on non-overlapping, in-bounds spans; assert the tokenizer's contract directly.
        const text = "global_var(GVAR_Y) == 2";
        const spans = tokenizeSsl(text);
        let prevEnd = 0;
        for (const s of spans) {
            expect(s.start).toBeGreaterThanOrEqual(prevEnd);
            expect(s.end).toBeGreaterThan(s.start);
            expect(s.end).toBeLessThanOrEqual(text.length);
            prevEnd = s.end;
        }
    });
});
