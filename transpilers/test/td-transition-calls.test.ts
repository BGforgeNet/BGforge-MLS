/**
 * TD transition-call tests (td/src/transition-calls.ts): the non-chained,
 * separate-statement form of reply/goTo/action/journal/flags/extern used
 * inside extendTop()/extendBottom() bodies.
 *
 * Method-chained transitions (reply(x).goTo(y)) route through
 * chain-parsing.ts and are already covered by td-expression-eval.test.ts;
 * these tests target the statement-by-statement path in
 * processTransitionStatement/processTransitionCall/processExtendStatements,
 * which a chained call never reaches.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../td/src/index";

async function emit(src: string): Promise<string> {
    const r = await transpile("/virtual/foo.td", src);
    return r.output;
}

describe("extendBottom(): separate-statement transitions (no method chain)", () => {
    it("reply() then goTo() as separate statements builds one transition", async () => {
        const out = await emit('extendBottom("MYDLG", "greeting", () => {\n  reply(tra(20));\n  goTo(quest);\n});\n');
        expect(out).toContain("EXTEND_BOTTOM MYDLG greeting");
        expect(out).toContain("++ @20 + quest");
    });

    it("exit() with no preceding transition adds a bare EXIT transition", async () => {
        const out = await emit('extendBottom("MYDLG", "greeting", () => {\n  exit();\n});\n');
        expect(out).toContain("IF ~~ EXIT");
    });

    it("action() after reply() attaches a DO action to the same transition", async () => {
        const out = await emit(
            'extendBottom("MYDLG", "greeting", () => {\n  reply(tra(21));\n  action(SetGlobal("x","GLOBAL",1));\n  goTo(quest);\n});\n',
        );
        expect(out).toContain('DO ~SetGlobal("x","GLOBAL",1)~ + quest');
    });

    it("journal() after reply() attaches a JOURNAL field", async () => {
        const out = await emit(
            'extendBottom("MYDLG", "greeting", () => {\n  reply(tra(22));\n  journal(tra(23));\n  exit();\n});\n',
        );
        expect(out).toContain("JOURNAL @23");
    });

    it("journal() with no preceding transition throws", async () => {
        await expect(
            emit('extendBottom("MYDLG", "greeting", () => {\n  journal(tra(23));\n});\n'),
        ).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("journal() must come after a transition"),
        });
    });

    it("flags() sets a numeric transition flag", async () => {
        const out = await emit(
            'extendBottom("MYDLG", "greeting", () => {\n  reply(tra(24));\n  flags(1);\n  exit();\n});\n',
        );
        expect(out).toContain("FLAGS 1");
    });

    it("extern() sets a cross-file EXTERN target", async () => {
        const out = await emit(
            'extendBottom("MYDLG", "greeting", () => {\n  reply(tra(25));\n  extern("OTHERDLG", "otherState");\n});\n',
        );
        expect(out).toContain("EXTERN OTHERDLG otherState");
    });

    it("a multi-statement if-block builds one triggered transition via processTransitionStatement", async () => {
        const out = await emit(
            'extendBottom("MYDLG", "greeting", () => {\n  if (PartyHasItem("SWORD01")) {\n    reply(tra(26));\n    goTo(quest);\n  }\n});\n',
        );
        expect(out).toContain('+~PartyHasItem("SWORD01")~+ @26 + quest');
    });
});
