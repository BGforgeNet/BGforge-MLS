/**
 * TD chain() tests: both syntax forms (parse-chain.ts's transformChainCall)
 * and the entry/epilogue processing they delegate to (chain-processing.ts's
 * transformFunctionToChain and processChainBody).
 *
 * These drive the real transpile() entry point so the assertions keep holding
 * across internal refactors - same convention as td-expression-eval.test.ts.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../td/src/index";

async function emit(src: string): Promise<string> {
    const r = await transpile("/virtual/foo.td", src);
    return r.output;
}

describe("chain(): new form (dialog, label, body)", () => {
    it("emits the CHAIN header and switches speaker on from()", async () => {
        const out = await emit(
            'chain("SPEAKER1", "chainLabel", () => {\n  say(tra(1));\n  from("SPEAKER2");\n  say(tra(2));\n  exit();\n});\n',
        );
        expect(out).toContain("CHAIN\nSPEAKER1 chainLabel\n@1\n== SPEAKER2\n@2\nEXIT");
    });

    it("chain(trigger, dialog, label, body) emits an IF...THEN header", async () => {
        const out = await emit(
            'chain(Global("quest","GLOBAL",1), "BJKLSY", "myChain", () => {\n  say(tra(1));\n  exit();\n});\n',
        );
        expect(out).toContain('IF ~Global("quest","GLOBAL",1)~ THEN BJKLSY myChain');
    });

    it("fromWhen() attaches a condition to the speaker-switch line", async () => {
        const out = await emit(
            'chain("BJKLSY", "pizzaChain", () => {\n  say(tra(100));\n  fromWhen("IMOEN2J", PartyHasItem("pepperoni"));\n  say(tra(101));\n  exit();\n});\n',
        );
        expect(out).toContain('== IMOEN2J IF ~PartyHasItem("pepperoni")~ THEN\n@101');
    });

    it("goTo() sets an END filename target epilogue", async () => {
        const out = await emit('chain("SPEAKER1", "chainLabel", () => {\n  say(tra(1));\n  goTo(otherState);\n});\n');
        expect(out).toContain("END SPEAKER1 otherState");
    });

    it("action() attaches a DO line after the current entry", async () => {
        const out = await emit(
            'chain("SPEAKER1", "chainLabel", () => {\n  say(tra(1));\n  action(SetGlobal("x","GLOBAL",1));\n  exit();\n});\n',
        );
        expect(out).toContain('DO ~SetGlobal("x","GLOBAL",1)~');
    });

    it("action() with no preceding say() throws", async () => {
        await expect(
            emit('chain("S", "label", () => {\n  action(SetGlobal("x","GLOBAL",1));\n  exit();\n});\n'),
        ).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("action() must come after say()"),
        });
    });
});

describe("chain(): old form (function reference)", () => {
    it("say(speaker, text) switches speaker and derives the chain filename from the first speaker", async () => {
        const out = await emit(
            "chain(function myChain() {\n" +
                '  say("SPEAKER1", tra(1));\n' +
                '  say("SPEAKER2", tra(2));\n' +
                '  say("SPEAKER1", tra(3));\n' +
                "  exit();\n" +
                "});\n",
        );
        expect(out).toContain("CHAIN\nSPEAKER1 myChain\n@1\n== SPEAKER2\n@2\n== SPEAKER1\n@3\nEXIT");
    });

    it("chain(trigger, functionIdentifier) resolves the named function from ctx.funcs", async () => {
        const src =
            "function myChain2() {\n" +
            '  say("SPEAKER1", tra(1));\n' +
            "  exit();\n" +
            '}\nchain(Global("x","GLOBAL",1), myChain2);\n';
        const out = await emit(src);
        expect(out).toContain('IF ~Global("x","GLOBAL",1)~ THEN SPEAKER1 myChain2');
    });

    it("a conditional block inside the function body emits a nested IF/THEN speaker entry", async () => {
        const out = await emit(
            "chain(function myChain() {\n" +
                '  say("SPEAKER1", tra(1));\n' +
                '  if (PartyHasItem("SWORD01")) {\n' +
                '    say("SPEAKER2", tra(2));\n' +
                "  }\n" +
                "  exit();\n" +
                "});\n",
        );
        expect(out).toContain('== SPEAKER2 IF ~PartyHasItem("SWORD01")~ THEN\n@2');
    });

    it("say(text) with no preceding say(speaker, text) throws", async () => {
        await expect(emit("chain(function myChain() {\n  say(tra(1));\n  exit();\n});\n")).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("say(text) without speaker"),
        });
    });
});

describe("chain(): argument validation", () => {
    it("rejects a call with no arguments", async () => {
        await expect(emit("chain();\n")).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("chain() requires at least 1 argument"),
        });
    });

    it("rejects an identifier that is not a declared function", async () => {
        await expect(emit("chain(unknownFunc);\n")).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining('Function "unknownFunc" not found in chain()'),
        });
    });

    it("rejects an argument that is neither a function nor an identifier", async () => {
        await expect(emit("chain(42);\n")).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("chain() argument must be a function reference or expression"),
        });
    });
});
