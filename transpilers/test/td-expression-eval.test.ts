/**
 * TD expression-evaluation tests: trigger composition (&&/||/!/OR(n)) and the
 * text-value forms (tra/tlk/string literal) that td/src/expression-eval.ts
 * converts into WeiDU D trigger and text syntax.
 *
 * These drive the real transpile() entry point so the assertions keep holding
 * across internal refactors - same convention as loop-unroll.test.ts.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../td/src/index";

/** Wrap one state body into a minimal dialog and return the emitted D text. */
async function emit(body: string): Promise<string> {
    const src = [
        "function start() {",
        "    say(tra(1));",
        `    ${body}`,
        "}",
        "",
        'export default begin("MYDLG", [start]);',
        "",
    ].join("\n");
    const r = await transpile("/virtual/foo.td", src);
    return r.output;
}

describe("trigger composition", () => {
    it("&& joins trigger conditions with a space", async () => {
        const out = await emit('if (Global("X","GLOBAL",1) && Global("Y","GLOBAL",0)) { reply(tra(2)).goTo(start); }');
        expect(out).toContain('~Global("X","GLOBAL",1) Global("Y","GLOBAL",0)~');
    });

    it("|| collects the chain into OR(n)", async () => {
        const out = await emit(
            'if (Global("X","GLOBAL",1) || Global("Y","GLOBAL",1) || Global("Z","GLOBAL",1)) { reply(tra(2)).goTo(start); }',
        );
        expect(out).toContain('~OR(3) Global("X","GLOBAL",1) Global("Y","GLOBAL",1) Global("Z","GLOBAL",1)~');
    });

    it("the OR(n, ...) call form emits the same OR(n) trigger", async () => {
        const out = await emit(
            'if (OR(2, Global("X","GLOBAL",1), Global("Y","GLOBAL",1))) { reply(tra(2)).goTo(start); }',
        );
        expect(out).toContain('~OR(2) Global("X","GLOBAL",1) Global("Y","GLOBAL",1)~');
    });

    it("! prefixes the trigger with WeiDU negation", async () => {
        const out = await emit('if (!Dead("mymonster")) { reply(tra(2)).goTo(start); }');
        expect(out).toContain('~!Dead("mymonster")~');
    });

    it("(a || b) && c nests the OR group inside the AND chain", async () => {
        const out = await emit(
            'if ((Global("X","GLOBAL",1) || Global("Y","GLOBAL",1)) && Dead("mymonster")) { reply(tra(2)).goTo(start); }',
        );
        expect(out).toContain('~OR(2) Global("X","GLOBAL",1) Global("Y","GLOBAL",1) Dead("mymonster")~');
    });
});

describe("text values", () => {
    it("tra(n) emits the @n translation reference", async () => {
        const out = await emit("reply(tra(42)).goTo(start);");
        expect(out).toContain("@42");
    });

    it("a string literal emits inline tilde-quoted text", async () => {
        const out = await emit('reply("plain text").goTo(start);');
        expect(out).toContain("~plain text~");
    });

    it("tlk(n) emits the #strref form", async () => {
        const out = await emit("reply(tlk(1234)).goTo(start);");
        expect(out).toContain("#1234");
    });
});
