/**
 * TD through the compile-time evaluator: every value, trigger, text and statement compiles to what the TypeScript
 * means, or the transpile refuses, naming the construct. Each case was a silent miscompile of the text layer this
 * replaced (the table in the evaluator plan), so each asserts the intended output, not the old one.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../td/src/index";

async function t(src: string): Promise<string> {
    const result = await transpile("/virtual/foo.td", src);
    return result.output;
}

/** The D for a one-state dialog: `declarations` at the top, `body` after the state's `say(tra(1))`. */
async function state(body: string, declarations = ""): Promise<string> {
    return t(`${declarations}\nfunction start() {\n    say(tra(1));\n    ${body}\n}\nbegin("DLG", [start]);\n`);
}

/** The D a one-state dialog emits, as the emitter writes it. */
function stateBlock(lines: readonly string[], trigger = "", label = "start"): string {
    return [`IF ~${trigger}~ ${label}`, "    SAY @1", ...lines.map((line) => `    ${line}`), "END"].join("\n");
}

/** The emitted text after the one-line generated header. */
const body = (out: string) => out.split("\n").slice(1).join("\n").trim();

describe("values", () => {
    it("resolves a constant built from another constant", async () => {
        const out = await state(
            'reply(tra(2)).action(SetGlobal("x", "GLOBAL", b)).exit();',
            "const a = 10;\nconst b = a + 1;",
        );
        expect(out).toContain('    ++ @2 DO ~SetGlobal("x","GLOBAL",11)~ EXIT\n');
    });

    it("folds arithmetic next to a name ending in a digit without renaming it", async () => {
        const out = await state(
            'reply(tra(2)).action(SetGlobal("x", "GLOBAL", (x1 * 2) / 2)).exit();',
            "const x1 = 5;",
        );
        expect(out).toContain('DO ~SetGlobal("x","GLOBAL",5)~');
    });

    it("refuses a division with a remainder, and folds the integer-division form", async () => {
        const action = (expr: string) => `reply(tra(2)).action(SetGlobal("x", "GLOBAL", ${expr})).exit();`;
        await expect(state(action("a / 3"), "const a = 10;")).rejects.toThrow(
            /a \/ 3 is 3\.3+\d*, not an integer; write Math\.trunc\(a \/ 3\) or Math\.floor\(a \/ 3\)/,
        );
        expect(await state(action("Math.trunc(a / 3)"), "const a = 10;")).toContain('DO ~SetGlobal("x","GLOBAL",3)~');
    });

    it("computes indexes, fields, strings, ternaries and bit flags", async () => {
        const declarations = [
            "const a = 10;",
            "const arr = [100, 200];",
            "const cfg = { id: 7 };",
            "const tpl = `SPWI${a}`;",
        ].join("\n");
        const out = await state(
            [
                'reply(tra(2)).action(SetGlobal("i", "GLOBAL", arr[1])).exit();',
                'reply(tra(3)).action(SetGlobal("f", "GLOBAL", cfg.id)).exit();',
                'reply(tra(4)).action(SetGlobal("t", "GLOBAL", a > 5 ? 1 : 2)).exit();',
                'reply(tra(5)).action(SetGlobal("b", "GLOBAL", 1 | 4)).exit();',
                "reply(tra(6)).action(ApplySpellRES(tpl, Myself)).exit();",
            ].join("\n    "),
            declarations,
        );
        expect(body(out)).toBe(
            "BEGIN DLG\n\n" +
                stateBlock([
                    '++ @2 DO ~SetGlobal("i","GLOBAL",200)~ EXIT',
                    '++ @3 DO ~SetGlobal("f","GLOBAL",7)~ EXIT',
                    '++ @4 DO ~SetGlobal("t","GLOBAL",1)~ EXIT',
                    '++ @5 DO ~SetGlobal("b","GLOBAL",5)~ EXIT',
                    '++ @6 DO ~ApplySpellRES("SPWI10",Myself)~ EXIT',
                ]),
        );
    });

    it("refuses a float", async () => {
        await expect(state('reply(tra(2)).action(SetGlobal("x", "GLOBAL", 1.5)).exit();')).rejects.toThrow(
            /1\.5 is not an integer/,
        );
    });

    it("refuses let, which declares a value that can change", async () => {
        const src =
            'let mutable = 1;\nmutable = 2;\nfunction start() {\n    say(tra(1));\n    exit();\n}\nbegin("DLG", [start]);\n';
        await expect(t(src)).rejects.toThrow(/'let' declares a value that can change.*use const/);
    });

    it("leaves a string's contents as written", async () => {
        const out = await state('reply(tra(2)).action(DisplayStringHead(Myself, "[1, 2] tra(5)")).exit();');
        expect(out).toContain('DO ~DisplayStringHead(Myself,"[1, 2] tra(5)")~');
    });

    it("keeps each state function's local constant to that function", async () => {
        const src = [
            "function first() {",
            "    const local = 99;",
            "    say(tra(1));",
            '    reply(tra(2)).action(SetGlobal("a", "GLOBAL", local)).exit();',
            "}",
            "function second() {",
            "    const local = 42;",
            "    say(tra(1));",
            '    reply(tra(3)).action(SetGlobal("b", "GLOBAL", local)).exit();',
            "}",
            'begin("DLG", [first, second]);',
            "",
        ].join("\n");
        const out = await t(src);
        expect(out).toContain('++ @2 DO ~SetGlobal("a","GLOBAL",99)~ EXIT');
        expect(out).toContain('++ @3 DO ~SetGlobal("b","GLOBAL",42)~ EXIT');
    });

    it("binds a helper's arguments as values in a scope of its own", async () => {
        const src = [
            "function give(item: string, line: number) {",
            "    const count = 2;",
            "    reply(tra(line)).action(GiveItemCreate(item, Player1, count, 0, 0)).exit();",
            "}",
            "function start() {",
            "    say(tra(1));",
            '    give("POTN08", 10 + 1);',
            "}",
            'begin("DLG", [start]);',
            "",
        ].join("\n");
        expect(await t(src)).toContain('    ++ @11 DO ~GiveItemCreate("POTN08",Player1,2,0,0)~ EXIT\n');
    });

    it("formats a point, an object specifier, a scope constant and a tra() reference as WeiDU arguments", async () => {
        const out = await state(
            'reply(tra(2)).action(CreateCreature("guard", [-1, 831], 6), DisplayStringHead(obj("[PC]"), tra(5)), SetGlobal("g", GLOBAL, 1)).exit();',
        );
        expect(out).toContain(
            'DO ~CreateCreature("guard",[-1.831],6) DisplayStringHead([PC],@5) SetGlobal("g","GLOBAL",1)~',
        );
    });

    it("refuses an action argument that is not an action call", async () => {
        await expect(state('reply(tra(2)).action("SetGlobal").exit();')).rejects.toThrow(/is a value, not an action/);
    });
});

describe("triggers", () => {
    it("emits a compile-time true transition trigger as no trigger, and drops a compile-time false one", async () => {
        const out = await state(
            [
                "if (a > 5) {\n        reply(tra(2)).exit();\n    }",
                "if (enabled) {\n        reply(tra(3)).exit();\n    }",
                'if (Global("g", "GLOBAL", 1) && a === 3) {\n        reply(tra(4)).exit();\n    }',
                'if (Global("g", "GLOBAL", 1) && a === 10) {\n        reply(tra(5)).exit();\n    }',
            ].join("\n    "),
            "const a = 10;\nconst enabled = false;",
        );
        expect(body(out)).toBe("BEGIN DLG\n\n" + stateBlock(["++ @2 EXIT", '+~Global("g","GLOBAL",1)~+ @5 EXIT']));
    });

    it("keeps the then branch of a compile-time true condition and the else branch of a false one", async () => {
        const out = await state(
            "if (on) {\n        reply(tra(2)).exit();\n    } else {\n        reply(tra(3)).exit();\n    }\n    if (!on) {\n        reply(tra(4)).exit();\n    } else {\n        reply(tra(5)).exit();\n    }",
            "const on = true;",
        );
        expect(body(out)).toBe("BEGIN DLG\n\n" + stateBlock(["++ @2 EXIT", "++ @5 EXIT"]));
    });

    it("joins && with a space, groups || as OR(n), and pushes a negation down to the calls", async () => {
        const out = await state(
            [
                'if (See(Player1) && !Dead("x")) {\n        reply(tra(2)).exit();\n    }',
                "if (See(Player1) || See(Player2) || See(Player3)) {\n        reply(tra(3)).exit();\n    }",
                'if (!(See(Player1) || Dead("x"))) {\n        reply(tra(4)).exit();\n    }',
            ].join("\n    "),
        );
        expect(out).toContain('    +~See(Player1) !Dead("x")~+ @2 EXIT\n');
        expect(out).toContain("    +~OR(3) See(Player1) See(Player2) See(Player3)~+ @3 EXIT\n");
        expect(out).toContain('    +~!See(Player1) !Dead("x")~+ @4 EXIT\n');
    });

    it("refuses an || with an && group inside, which a D trigger has no grouping for", async () => {
        await expect(
            state('if (See(Player1) || (See(Player2) && Dead("x"))) {\n        reply(tra(2)).exit();\n    }'),
        ).rejects.toThrow(/OR\(n\) groups trigger calls/);
    });

    it("refuses a trigger that is neither a trigger call nor a compile-time boolean", async () => {
        await expect(state("if (flag) {\n        reply(tra(2)).exit();\n    }")).rejects.toThrow(
            /not the engine name 'flag'/,
        );
    });

    it("refuses a compile-time constant as a state's entry trigger", async () => {
        const src = (value: string) =>
            `const on = ${value};\nfunction s() {\n    if (on) {\n        say(tra(5));\n        exit();\n    }\n}\nbegin("DLG", [s]);\n`;
        await expect(t(src("false"))).rejects.toThrow(
            /entry trigger is false at compile time, so the state is never entered/,
        );
        await expect(t(src("true"))).rejects.toThrow(/entry trigger is true at compile time/);
    });

    it("refuses a compile-time constant as a module-level if's state entry trigger", async () => {
        const src =
            'const on = false;\ndeclare function s(): void;\nif (on) {\n    function s() {\n        say(tra(5));\n        exit();\n    }\n}\nbegin("DLG", [s]);\n';
        await expect(t(src)).rejects.toThrow(/entry trigger is false at compile time/);
    });

    it("refuses a compile-time constant as a chain, chain entry or interject entry trigger", async () => {
        await expect(
            t('const on = true;\nchain(on, "DLG", "c", () => {\n    say(tra(1));\n    exit();\n});\n'),
        ).rejects.toThrow(/chain's entry trigger is true at compile time/);
        await expect(
            t(
                'const on = false;\nchain("DLG", "c", () => {\n    say(tra(1));\n    fromWhen("EDWIN", on);\n    say(tra(2));\n    exit();\n});\n',
            ),
        ).rejects.toThrow(/entry trigger is false at compile time/);
        await expect(
            t(
                'const on = false;\ninterjectCopyTrans("DLG", "s", "V", () => {\n    if (on) {\n        say("EDWIN", tra(1));\n    }\n});\n',
            ),
        ).rejects.toThrow(/entry trigger is false at compile time/);
    });

    it("refuses a compile-time constant as a patch operation's trigger", async () => {
        await expect(t('const on = true;\naddStateTrigger("DLG", [1], on);\n')).rejects.toThrow(
            /ADD_STATE_TRIGGER trigger is true at compile time/,
        );
    });

    it("keeps alterTrans's documented trigger: false, which clears the trigger", async () => {
        expect(await t('alterTrans("DLG", [1], [0], { trigger: false });\n')).toContain('  "TRIGGER" ~~\n');
    });

    it("conjoins an if's trigger with the triggers of the transitions a helper adds, for each of them", async () => {
        const src = [
            "function pair(v: number) {",
            '    if (Global("a", "GLOBAL", v)) {',
            "        reply(tra(2)).exit();",
            "    }",
            "    reply(tra(3)).exit();",
            "}",
            "function start() {",
            "    say(tra(1));",
            "    if (See(Player1)) {",
            "        pair(4);",
            "    }",
            "}",
            'begin("DLG", [start]);',
            "",
        ].join("\n");
        expect(body(await t(src))).toBe(
            "BEGIN DLG\n\n" +
                stateBlock(['+~See(Player1) Global("a","GLOBAL",4)~+ @2 EXIT', "+~See(Player1)~+ @3 EXIT"]),
        );
    });

    it("joins a nested if's trigger to the enclosing one", async () => {
        const out = await state(
            'if (See(Player1)) {\n        if (Dead("x")) {\n            reply(tra(2)).exit();\n        }\n    }',
        );
        expect(body(out)).toBe("BEGIN DLG\n\n" + stateBlock(['+~See(Player1) Dead("x")~+ @2 EXIT']));
    });

    it("refuses say() in a nested if, which is no state entry trigger", async () => {
        const src =
            'function s() {\n    if (See(Player1)) {\n        if (Dead("x")) {\n            say(tra(2));\n        }\n    }\n}\nbegin("DLG", [s]);\n';
        await expect(t(src)).rejects.toThrow(/'say\(\)' is not a TD transition statement/);
    });

    it("gives each transition an if body builds its trigger", async () => {
        const out = await state(
            "if (See(Player1)) {\n        reply(tra(2)).exit();\n        reply(tra(3)).exit();\n    }",
        );
        expect(body(out)).toBe("BEGIN DLG\n\n" + stateBlock(["+~See(Player1)~+ @2 EXIT", "+~See(Player1)~+ @3 EXIT"]));
    });
});

describe("text", () => {
    it("writes tlkForced() as the strref and the text WeiDU forces into it", async () => {
        expect(await state('reply(tlkForced(12, "Hello")).exit();')).toContain("    ++ !12 ~Hello~ EXIT\n");
    });

    it("writes a sound, and the male and female forms with their sounds", async () => {
        const out = await state(
            'reply(tra(2, { sound: "SND" })).exit();\n    reply({ male: tra(3), female: tlk(4), maleSound: "M", femaleSound: "F" }).exit();',
        );
        expect(out).toContain("    ++ @2 [SND] EXIT\n");
        expect(out).toContain("    ++ @3 [M] #4 [F] EXIT\n");
    });

    it("reads text from a constant", async () => {
        const out = await state("reply(GREETING).exit();", "const GREETING = tra(7);");
        expect(out).toContain("    ++ @7 EXIT\n");
    });

    it("refuses a value that is no dialog text", async () => {
        await expect(state("reply(5).exit();")).rejects.toThrow(
            /dialog text is tra\(\), tlk\(\), tlkForced\(\) or a string, not an integer/,
        );
    });
});

describe("names", () => {
    it("resolves constants used as extern file and target, chain speaker and chain action argument", async () => {
        const src = [
            'const OTHER = "OTHERDLG";',
            'const SPEAKER = "EDWIN";',
            'const QVAR = "quest";',
            "function start() {",
            "    say(tra(1));",
            '    reply(tra(2)).extern(OTHER, "5");',
            "}",
            'begin("BYPASS", [start]);',
            "chain(function talk() {",
            "    say(SPEAKER, tra(10));",
            '    action(SetGlobal(QVAR, "GLOBAL", 1));',
            "    exit();",
            "});",
            "",
        ].join("\n");
        const out = await t(src);
        expect(out).toContain("    ++ @2 EXTERN OTHERDLG 5\n");
        expect(out).toContain('CHAIN\nEDWIN talk\n@10\nDO ~SetGlobal("quest","GLOBAL",1)~\nEXIT');
    });

    it("resolves constants used as statement-form extern, chain goTo, copyTrans, setWeight and extendBottom position", async () => {
        const src = [
            'const OTHER = "OTHERDLG";',
            'const TARGET = "s5";',
            "const W = 2 + 1;",
            "const POS = 1;",
            "function start() {",
            "    say(tra(1));",
            "    reply(tra(2));",
            "    extern(OTHER, TARGET);",
            "    copyTrans(OTHER, TARGET);",
            "}",
            'begin("DLG", [start]);',
            "chain(function talk() {",
            '    say("EDWIN", tra(10));',
            "    goTo(TARGET);",
            "});",
            "setWeight(OTHER, TARGET, W);",
            "extendBottom(OTHER, TARGET, { position: POS }, () => {\n    reply(tra(3)).exit();\n});",
            "",
        ].join("\n");
        const out = await t(src);
        expect(out).toContain("    ++ @2 EXTERN OTHERDLG s5\n    COPY_TRANS OTHERDLG s5\n");
        expect(out).toContain("END EDWIN s5");
        expect(out).toContain("SET_WEIGHT OTHERDLG s5 #3");
        expect(out).toContain("EXTEND_BOTTOM OTHERDLG s5 #1\n");
    });

    it("uses the name of a declared function, and of a body-less declare function, as the state label", async () => {
        const src = [
            "declare function later(): void;",
            "const next = middle;",
            "function middle() {",
            "    say(tra(2));",
            "    goTo(later);",
            "}",
            "function start() {",
            "    say(tra(1));",
            "    goTo(next);",
            "}",
            'begin("DLG", [start]);',
            "",
        ].join("\n");
        const out = await t(src);
        expect(out).toContain("IF ~~ start\n    SAY @1\n    IF ~~ GOTO middle\nEND");
        expect(out).toContain("IF ~~ middle\n    SAY @2\n    IF ~~ GOTO later\nEND");
    });

    it("refuses a value that names no state", async () => {
        await expect(state("goTo([1, 2]);")).rejects.toThrow(
            /a state is named by a function, a label string or a state number, not an array/,
        );
    });
});

describe("patch operations", () => {
    it("emits REPLACE_* search and replacement text as written", async () => {
        const out = await t(
            'replaceTransTrigger("DLG", [1], [0], "Foo([1, 2])", "tra(5) 1 * 2");\nreplaceActionText("DLG", "A([3, 4])", "B(tra(6))");\n',
        );
        expect(out).toContain("REPLACE_TRANS_TRIGGER DLG BEGIN 1 END BEGIN 0 END ~Foo([1, 2])~ ~tra(5) 1 * 2~");
        expect(out).toContain("REPLACE_ACTION_TEXT DLG ~A([3, 4])~ ~B(tra(6))~");
    });

    it("reads state lists, transition lists and actions from constants", async () => {
        const out = await t(
            'const STATES = ["a", 2];\nconst TRANS = [0, 1];\naddTransAction("DLG", STATES, TRANS, SetGlobal("x", "GLOBAL", 1 + 1));\n',
        );
        expect(out).toContain('ADD_TRANS_ACTION DLG BEGIN a 2 END BEGIN 0 1 END ~SetGlobal("x","GLOBAL",2)~');
    });
});

describe("loops", () => {
    it("unrolls a for...of in a state, destructuring each element", async () => {
        const out = await state(
            "for (const [item, line] of ITEMS) {\n        reply(tra(line)).action(GiveItemCreate(item, Player1, 1, 0, 0)).exit();\n    }",
            'const ITEMS: [string, number][] = [["a", 2], ["b", 3]];',
        );
        expect(out).toContain(
            '    ++ @2 DO ~GiveItemCreate("a",Player1,1,0,0)~ EXIT\n    ++ @3 DO ~GiveItemCreate("b",Player1,1,0,0)~ EXIT\n',
        );
    });

    it("unrolls a module-level for...of over constructs, as writing-td.md documents", async () => {
        const src =
            'const npcs = ["IMOEN2J", "MINSC"];\nfor (const npc of npcs) {\n    extendBottom("MYDLG", "greeting", () => {\n        if (InParty(npc)) {\n            reply(tra(10)).extern(npc, 0);\n        }\n    });\n}\n';
        const out = await t(src);
        expect(out).toContain('EXTEND_BOTTOM MYDLG greeting\n    +~InParty("IMOEN2J")~+ @10 EXTERN IMOEN2J 0\nEND');
        expect(out).toContain('EXTEND_BOTTOM MYDLG greeting\n    +~InParty("MINSC")~+ @10 EXTERN MINSC 0\nEND');
    });

    it("refuses a for loop with more than one counter", async () => {
        await expect(state("for (let i = 0, j = 0; i < 3; i++) {\n        exit();\n    }")).rejects.toThrow(
            /a compile-time for loop declares one counter/,
        );
    });
});

describe("statements", () => {
    it.each([
        [
            "an action call outside action()",
            'SetGlobal("x", "GLOBAL", 1);',
            /'SetGlobal\(\)' is not a TD state statement/,
        ],
        [
            "a while loop",
            "while (See(Player1)) {\n        exit();\n    }",
            /WhileStatement is not supported in a state/,
        ],
        ["a return", "return;", /ReturnStatement is not supported in a state/],
    ])("refuses %s in a state rather than dropping it", async (_name, statement, message) => {
        await expect(state(statement)).rejects.toThrow(message);
    });

    it("refuses a module-level call that is no TD construct", async () => {
        await expect(t('Foo("x");\n')).rejects.toThrow(/'Foo\(\)' is not a TD construct/);
    });

    it("refuses a statement an extend block does not handle", async () => {
        await expect(t('extendTop("DLG", "s", () => {\n    SetGlobal("x", "GLOBAL", 1);\n});\n')).rejects.toThrow(
            /'SetGlobal\(\)' is not a TD transition statement/,
        );
    });

    it("refuses a statement a chain body does not handle", async () => {
        await expect(
            t(
                'chain("DLG", "c", () => {\n    say(tra(1));\n    if (See(Player1)) {\n        say(tra(2));\n    }\n    exit();\n});\n',
            ),
        ).rejects.toThrow(/IfStatement is not supported in a chain body/);
    });
});
