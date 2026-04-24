/**
 * Unit tests for TD transpiler.
 * Tests the parse and emit stages of TypeScript to WeiDU D transpilation.
 */

import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { parse } from "../../transpilers/td/src/parse";
import { emitD } from "../../transpilers/td/src/emit";
import { extractTraTag } from "../../transpilers/common/transpiler-utils";
import { transformEnums } from "../../transpilers/common/enum-transform";
import type { TDScript } from "../../transpilers/td/src/types";

describe("TD Transpiler", () => {
    function parseIR(code: string): TDScript {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("test.td", code);
        return { ...parse(sourceFile), traTag: extractTraTag(code) };
    }

    function transpile(code: string): string {
        return emitD(parseIR(code));
    }

    /** Transpile with enum pre-transform (simulates what bundle() does) */
    function transpileWithEnums(code: string): string {
        const { code: transformed } = transformEnums(code);
        return transpile(transformed);
    }

    describe("BEGIN with states", () => {
        it("transpiles simple begin with state", () => {
            const code = `
function start() {
    say(tra(100));
    exit();
}

begin("MYDLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN MYDLG");
            expect(result).toContain("IF ~~ start");
            expect(result).toContain("SAY @100");
            expect(result).toContain("EXIT");
        });

        it("emits SAY ~~ for state with transitions but no say()", () => {
            const code = `
function assassin() {
    action(AddSpecialAbility("SPCL916")).exit();
}

begin("TEST", [assassin]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ assassin");
            expect(result).toContain("SAY ~~");
            expect(result).toContain('DO ~AddSpecialAbility("SPCL916")~ EXIT');
        });

        it("converts point tuple in action to BAF point notation", () => {
            const code = `
function spawn() {
    action(CreateCreature("ccguard2", [2791, 831], 6)).exit();
}

begin("TEST", [spawn]);
`;
            const result = transpile(code);
            expect(result).toContain('DO ~CreateCreature("ccguard2",[2791.831],6)~ EXIT');
        });

        it("converts negative point coordinates in action", () => {
            const code = `
function spawn() {
    action(CreateCreature("g_spy1", [-1, -1], 0)).exit();
}

begin("TEST", [spawn]);
`;
            const result = transpile(code);
            expect(result).toContain('DO ~CreateCreature("g_spy1",[-1.-1],0)~ EXIT');
        });

        it("transpiles state with multiple say (multisay)", () => {
            const code = `
function greeting() {
    say(tra(100));
    say(tra(101));
    say(tra(102));
    exit();
}

begin("NPC", [greeting]);
`;
            const result = transpile(code);
            expect(result).toContain("SAY @100 = @101 = @102");
        });

        it("transpiles state with transitions", () => {
            const code = `
function shop() {
    say(tra(100));
    reply(tra(101));
    goTo(buyItem);
}

function buyItem() {
    say(tra(200));
    exit();
}

begin("SHOP", [shop, buyItem]);
`;
            const result = transpile(code);
            expect(result).toContain("++ @101 + buyItem");
        });
    });

    describe("State entry triggers", () => {
        it("transpiles if-wrapped function as state with trigger", () => {
            const code = `
if (Global("talked", "GLOBAL", 1)) {
    function returning() {
        say(tra(200));
        exit();
    }
}

begin("NPC", [returning]);
`;
            const result = transpile(code);
            expect(result).toContain('IF ~Global("talked","GLOBAL",1)~ returning');
            expect(result).toContain("SAY @200");
        });

        it("handles multiple states with different triggers", () => {
            const code = `
function start() {
    say(tra(100));
    exit();
}

if (NumTimesTalkedTo(1)) {
    function returning() {
        say(tra(200));
        exit();
    }
}

begin("NPC", [start, returning]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ start");
            expect(result).toContain("IF ~NumTimesTalkedTo(1)~ returning");
        });
    });

    describe("Transition triggers", () => {
        it("transpiles if inside state as transition with trigger", () => {
            const code = `
function shop() {
    say(tra(100));
    if (PartyGoldGT(500)) {
        reply(tra(101));
        goTo(buyExpensive);
    }
    reply(tra(102));
    exit();
}

function buyExpensive() {
    say(tra(200));
    exit();
}

begin("SHOP", [shop, buyExpensive]);
`;
            const result = transpile(code);
            expect(result).toContain("+~PartyGoldGT(500)~+ @101 + buyExpensive");
            expect(result).toContain("++ @102 EXIT");
        });
    });

    describe("CHAIN", () => {
        it("transpiles chain with speaker switches", () => {
            const code = `
chain(function banter() {
    say("NPC1", tra(100));
    say("NPC2", tra(101));
    say("NPC1", tra(102));
    exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("CHAIN");
            expect(result).toContain("NPC1");
            expect(result).toContain("== NPC2");
            expect(result).toContain("@100");
            expect(result).toContain("@101");
        });
    });

    describe("Text references", () => {
        it("emits tra() as @number", () => {
            const code = `
function test() {
    say(tra(123));
    exit();
}

begin("TEST", [test]);
`;
            const result = transpile(code);
            expect(result).toContain("@123");
        });

        it("emits tlk() as #number", () => {
            const code = `
function test() {
    say(tlk(456));
    exit();
}

begin("TEST", [test]);
`;
            const result = transpile(code);
            expect(result).toContain("#456");
        });

        it("emits tlk() as bare number in action context", () => {
            const code = `
function test() {
    say(tra(100));
    reply(tra(101)).action(DisplayString(Myself, tlk(46150))).exit();
}

begin("TEST", [test]);
`;
            const result = transpile(code);
            // In D action strings, tlk emits bare number (no # prefix)
            expect(result).toContain("DisplayString(Myself,46150)");
            expect(result).not.toContain("#46150");
        });

        it("emits string literals as ~text~", () => {
            const code = `
function test() {
    say("Hello World");
    exit();
}

begin("TEST", [test]);
`;
            const result = transpile(code);
            expect(result).toContain("~Hello World~");
        });
    });

    describe("Compile-time loop unrolling", () => {
        it("unrolls for-of loop over const array", () => {
            const code = `
const items = ["SWORD", "SHIELD", "HELM"];

function shop() {
    say(tra(100));
    for (const item of items) {
        if (PartyHasItem(item)) {
            reply(tra(101));
            exit();
        }
    }
    exit();
}

begin("SHOP", [shop]);
`;
            const result = transpile(code);
            // Should have 3 transitions, one for each item
            expect(result).toContain('+~PartyHasItem("SWORD")~+');
            expect(result).toContain('+~PartyHasItem("SHIELD")~+');
            expect(result).toContain('+~PartyHasItem("HELM")~+');
        });

        it("unrolls for loop with numeric range", () => {
            const code = `
function countdown() {
    say(tra(100));
    for (let i = 1; i <= 3; i++) {
        reply(tra(i));
        exit();
    }
}

begin("TEST", [countdown]);
`;
            const result = transpile(code);
            expect(result).toContain("@1");
            expect(result).toContain("@2");
            expect(result).toContain("@3");
        });
    });

    describe("Macro inlining", () => {
        it("inlines user function calls", () => {
            const code = `
function buyItem(price: number, item: string) {
    if (PartyGoldGT(price)) {
        reply(tra(100));
        exit();
    }
}

function shop() {
    say(tra(50));
    buyItem(500, "SWORD");
    buyItem(300, "SHIELD");
    exit();
}

begin("SHOP", [shop]);
`;
            const result = transpile(code);
            expect(result).toContain("+~PartyGoldGT(500)~+");
            expect(result).toContain("+~PartyGoldGT(300)~+");
        });

        it("inlines user function called from inside an if block", () => {
            const code = `
function doReply(replyTra: number) {
    reply(tra(replyTra))
        .action(SetGlobal("done", "GLOBAL", 1))
        .goTo(nextState);
}

function myState() {
    say(tra(1));
    if (PartyHasItem("SWORD")) {
        doReply(100);
    }
    if (PartyHasItem("SHIELD")) {
        doReply(200);
    }
    exit();
}

begin("TEST", [myState]);
`;
            const result = transpile(code);
            // Both if blocks should produce transitions with trigger + reply + action + goTo
            expect(result).toContain('+~PartyHasItem("SWORD")~+ @100 DO ~SetGlobal("done","GLOBAL",1)~ + nextState');
            expect(result).toContain('+~PartyHasItem("SHIELD")~+ @200 DO ~SetGlobal("done","GLOBAL",1)~ + nextState');
            // The standalone exit() should produce a bare EXIT fallback
            expect(result).toContain("IF ~~ EXIT");
        });

        it("exit() at state level does not overwrite inlined function goTo", () => {
            const code = `
function doReply(replyTra: number) {
    reply(tra(replyTra));
    goTo(target);
}

function myState() {
    say(tra(1));
    doReply(100);
    exit();
}

begin("DLG", [myState]);
`;
            const result = transpile(code);
            // The inlined function's goTo should be preserved
            expect(result).toContain("++ @100 + target");
            // The standalone exit() should create its own EXIT transition
            expect(result).toContain("IF ~~ EXIT");
        });

        it("inlines user function with chain from inside an if block", () => {
            const code = `
function givePotion(potion: string, replyTra: number) {
    reply(tra(replyTra))
        .action(CreateItem(potion, 1, 0, 0))
        .goTo(confirm);
}

function potionState() {
    say(tra(1));
    if (PartyHasItem("POTN1")) {
        givePotion("POTN1", 10);
    }
    if (PartyHasItem("POTN2")) {
        givePotion("POTN2", 20);
    }
    exit();
}

begin("DLG", [potionState]);
`;
            const result = transpile(code);
            expect(result).toContain('+~PartyHasItem("POTN1")~+ @10 DO ~CreateItem("POTN1",1,0,0)~ + confirm');
            expect(result).toContain('+~PartyHasItem("POTN2")~+ @20 DO ~CreateItem("POTN2",1,0,0)~ + confirm');
            // The standalone exit() should produce a bare EXIT fallback
            expect(result).toContain("IF ~~ EXIT");
        });
    });

    describe("APPEND", () => {
        it("transpiles append with new state", () => {
            const code = `
function newState() {
    say(tra(100));
    exit();
}

append("EXISTING", newState);
`;
            const result = transpile(code);
            expect(result).toContain("APPEND EXISTING");
            expect(result).toContain("IF ~~ newState");
            expect(result).toContain("END");
        });
    });

    describe("EXTEND", () => {
        it("transpiles extendTop with transition", () => {
            const code = `
extendTop("DLG", "state1", () => {
    reply(tra(100));
    goTo(newState);
});
`;
            const result = transpile(code);
            expect(result).toContain("EXTEND_TOP DLG state1");
        });

        it("transpiles extendBottom with transition", () => {
            const code = `
extendBottom("DLG", "state2", () => {
    reply(tra(200));
    exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("EXTEND_BOTTOM DLG state2");
        });
    });

    // =========================================================================
    // Method chain transitions (builder syntax)
    // =========================================================================

    describe("Method chain transitions", () => {
        it("transpiles reply().goTo() chain", () => {
            const code = `
function shop() {
    say(tra(100));
    reply(tra(101)).goTo(buyItem);
    reply(tra(102)).goTo(sellItem);
}
function buyItem() { say(tra(200)); exit(); }
function sellItem() { say(tra(300)); exit(); }
begin("SHOP", [shop, buyItem, sellItem]);
`;
            const result = transpile(code);
            expect(result).toContain("++ @101 + buyItem");
            expect(result).toContain("++ @102 + sellItem");
        });

        it("transpiles reply().action().goTo() chain", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("x","GLOBAL",1)).goTo(next);
}
function next() { say(tra(200)); exit(); }
begin("DLG", [state, next]);
`;
            const result = transpile(code);
            expect(result).toContain('++ @101 DO ~SetGlobal("x","GLOBAL",1)~ + next');
        });

        it("transpiles reply().action().exit() chain", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("x","GLOBAL",1)).exit();
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain('++ @101 DO ~SetGlobal("x","GLOBAL",1)~ EXIT');
        });

        it("transpiles action().exit() chain (no reply)", () => {
            const code = `
function state() {
    say(tra(100));
    action(SetGlobal("x","GLOBAL",1), EscapeArea()).exit();
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain('DO ~SetGlobal("x","GLOBAL",1) EscapeArea()~');
            expect(result).toContain("EXIT");
        });

        it("transpiles chain with journal", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("x","GLOBAL",1)).journal(tra(200)).goTo(next);
}
function next() { say(tra(300)); exit(); }
begin("DLG", [state, next]);
`;
            const result = transpile(code);
            expect(result).toContain("JOURNAL @200");
        });

        it("transpiles chain with extern", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).extern("OTHER", "state5");
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("EXTERN OTHER state5");
        });

        it("transpiles chain with conditional trigger", () => {
            const code = `
function state() {
    say(tra(100));
    if (Global("quest","GLOBAL",1)) {
        reply(tra(101)).action(SetGlobal("quest","GLOBAL",2)).goTo(next);
    }
    reply(tra(102)).exit();
}
function next() { say(tra(200)); exit(); }
begin("DLG", [state, next]);
`;
            const result = transpile(code);
            expect(result).toContain('+~Global("quest","GLOBAL",1)~+ @101 DO ~SetGlobal("quest","GLOBAL",2)~ + next');
            expect(result).toContain("++ @102 EXIT");
        });

        it("transpiles reply().action() with multiple actions", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("a","GLOBAL",1), SetGlobal("b","GLOBAL",2)).goTo(next);
}
function next() { say(tra(200)); exit(); }
begin("DLG", [state, next]);
`;
            const result = transpile(code);
            expect(result).toContain('DO ~SetGlobal("a","GLOBAL",1) SetGlobal("b","GLOBAL",2)~');
        });
    });

    // =========================================================================
    // Rest-args and object overloads
    // =========================================================================

    describe("Rest-args begin/append", () => {
        it("transpiles begin with rest-args", () => {
            const code = `
function s1() { say(tra(100)); exit(); }
function s2() { say(tra(200)); exit(); }
begin("DLG", s1, s2);
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN DLG");
            expect(result).toContain("IF ~~ s1");
            expect(result).toContain("IF ~~ s2");
        });

        it("transpiles append with rest-args", () => {
            const code = `
function s1() { say(tra(100)); exit(); }
function s2() { say(tra(200)); exit(); }
append("DLG", s1, s2);
`;
            const result = transpile(code);
            expect(result).toContain("APPEND DLG");
            expect(result).toContain("IF ~~ s1");
            expect(result).toContain("IF ~~ s2");
        });

        it("transpiles append with single rest-arg", () => {
            const code = `
function myState() { say(tra(100)); exit(); }
append("DLG", myState);
`;
            const result = transpile(code);
            expect(result).toContain("APPEND DLG");
            expect(result).toContain("IF ~~ myState");
        });
    });

    // =========================================================================
    // State-level wrapping if as trigger
    // =========================================================================

    describe("State-level wrapping if", () => {
        it("detects wrapping if as state trigger", () => {
            const code = `
function myState() {
    if (Global("quest","GLOBAL",1)) {
        say(tra(100));
        reply(tra(101)).goTo(next);
    }
}
function next() { say(tra(200)); exit(); }
begin("DLG", [myState, next]);
`;
            const result = transpile(code);
            expect(result).toContain('IF ~Global("quest","GLOBAL",1)~ myState');
            expect(result).toContain("SAY @100");
            expect(result).toContain("++ @101 + next");
        });

        it("treats if after say as transition trigger (not state trigger)", () => {
            const code = `
function myState() {
    say(tra(100));
    if (Global("quest","GLOBAL",1)) {
        reply(tra(101)).goTo(next);
    }
    reply(tra(102)).exit();
}
function next() { say(tra(200)); exit(); }
begin("DLG", [myState, next]);
`;
            const result = transpile(code);
            // State should have no trigger (IF ~~)
            expect(result).toContain("IF ~~ myState");
            expect(result).toContain('+~Global("quest","GLOBAL",1)~+ @101 + next');
        });
    });

    // =========================================================================
    // copyTrans at state level
    // =========================================================================

    describe("copyTrans", () => {
        it("emits COPY_TRANS at state level", () => {
            const code = `
function myState() {
    say(tra(100));
    copyTrans("OTHER", 54);
}
append("DLG", myState);
`;
            const result = transpile(code);
            expect(result).toContain("COPY_TRANS OTHER 54");
        });
    });

    // =========================================================================
    // Variadic say
    // =========================================================================

    describe("Variadic say", () => {
        it("transpiles say with multiple args as multisay", () => {
            const code = `
function state() {
    say(tra(100), tra(101), tra(102));
    exit();
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("SAY @100 = @101 = @102");
        });
    });

    // =========================================================================
    // Chain with from/fromWhen (new form)
    // =========================================================================

    describe("Chain with from/fromWhen", () => {
        it("transpiles new-form chain with from() speaker switches", () => {
            const code = `
chain("NPC1", "banter", () => {
    say("Hello there");
    from("NPC2");
    say("Hey!");
    from("NPC1");
    say("How are you?");
    exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("CHAIN");
            expect(result).toContain("NPC1 banter");
            expect(result).toContain("== NPC2");
            expect(result).toContain("== NPC1");
            expect(result).toContain("EXIT");
        });

        it("transpiles new-form chain with fromWhen() conditional speakers", () => {
            const code = `
chain("NPC1", "condchain", () => {
    say("Main text");
    fromWhen("NPC2", PartyHasItem("pepperoni"));
    say("I have pepperoni!");
    exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("CHAIN");
            expect(result).toContain('== NPC2 IF ~PartyHasItem("pepperoni")~ THEN');
        });

        it("transpiles new-form chain with entry trigger", () => {
            const code = `
chain(
    Global("x","GLOBAL",0),
    "NPC1", "triggered",
    () => {
        say("Hello");
        exit();
    }
);
`;
            const result = transpile(code);
            expect(result).toContain("CHAIN");
            expect(result).toContain('IF ~Global("x","GLOBAL",0)~');
            expect(result).toContain("NPC1 triggered");
        });
    });

    // =========================================================================
    // Extend with chain transitions
    // =========================================================================

    describe("Extend with chain transitions", () => {
        it("transpiles extendTop with chain transitions", () => {
            const code = `
extendTop("DLG", "state1", () => {
    reply(tra(100)).goTo(next);
});
`;
            const result = transpile(code);
            expect(result).toContain("EXTEND_TOP DLG state1");
            expect(result).toContain("++ @100 + next");
        });

        it("transpiles extendBottom with chained conditional", () => {
            const code = `
extendBottom("DLG", 12, () => {
    reply(tra(100)).action(IncrementGlobal("x","GLOBAL",-1)).goTo(next);
    if (Global("y","GLOBAL",1)) {
        reply(tra(101)).goTo(other);
    }
});
`;
            const result = transpile(code);
            expect(result).toContain("EXTEND_BOTTOM DLG 12");
            expect(result).toContain('++ @100 DO ~IncrementGlobal("x","GLOBAL",-1)~ + next');
            expect(result).toContain('+~Global("y","GLOBAL",1)~+ @101 + other');
        });
    });

    // =========================================================================
    // appendEarly
    // =========================================================================

    describe("APPEND_EARLY", () => {
        it("transpiles appendEarly with states", () => {
            const code = `
function earlyState() {
    say(tra(100));
    exit();
}
appendEarly("DLG", earlyState);
`;
            const result = transpile(code);
            expect(result).toContain("APPEND_EARLY DLG");
            expect(result).toContain("IF ~~ earlyState");
            expect(result).toContain("SAY @100");
            expect(result).toContain("END");
        });
    });

    // =========================================================================
    // replaceState
    // =========================================================================

    describe("replaceState", () => {
        it("transpiles replaceState with state function", () => {
            const code = `
replaceState("DLG", 5, () => {
    say(tra(100));
    reply(tra(101)).exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("REPLACE states in DLG");
            expect(result).toContain("APPEND DLG");
            expect(result).toContain("IF ~~ 5");
            expect(result).toContain("SAY @100");
            expect(result).toContain("++ @101 EXIT");
        });
    });

    // =========================================================================
    // nonPausing begin option
    // =========================================================================

    describe("BEGIN with nonPausing option", () => {
        it("emits BEGIN with nonPausing flag", () => {
            const code = `
function state() {
    say(tra(100));
    exit();
}
begin("DLG", [state], { nonPausing: true });
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN DLG 1");
        });
    });

    // =========================================================================
    // ifFileExists append option
    // =========================================================================

    describe("APPEND with ifFileExists option", () => {
        it("emits APPEND IF_FILE_EXISTS", () => {
            const code = `
function state() {
    say(tra(100));
    exit();
}
append("DLG", [state], { ifFileExists: true });
`;
            const result = transpile(code);
            expect(result).toContain("APPEND IF_FILE_EXISTS DLG");
        });
    });

    // =========================================================================
    // Object form states
    // =========================================================================

    describe("Object form states", () => {
        it("transpiles begin with inline object states", () => {
            const code = `
begin("DLG", {
    greeting() {
        say(tra(100));
        exit();
    },
    farewell() {
        say(tra(200));
        exit();
    }
});
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN DLG");
            expect(result).toContain("IF ~~ greeting");
            expect(result).toContain("IF ~~ farewell");
            expect(result).toContain("SAY @100");
            expect(result).toContain("SAY @200");
        });
    });

    // =========================================================================
    // Chain method: copyTransLate, flags, solvedJournal, unsolvedJournal
    // =========================================================================

    describe("Chain method modifiers", () => {
        it("transpiles reply().copyTransLate()", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).copyTransLate("OTHER", "state5");
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("COPY_TRANS_LATE OTHER state5");
        });

        it("transpiles reply().flags()", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).flags(2).goTo(next);
}
function next() { say(tra(200)); exit(); }
begin("DLG", [state, next]);
`;
            const result = transpile(code);
            expect(result).toContain("FLAGS 2");
        });

        it("transpiles reply().solvedJournal()", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).solvedJournal(tra(500)).exit();
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("SOLVED_JOURNAL @500");
        });

        it("transpiles reply().unsolvedJournal()", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).unsolvedJournal(tra(600)).exit();
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("UNSOLVED_JOURNAL @600");
        });
    });

    // =========================================================================
    // Inline state() function
    // =========================================================================

    describe("Inline state() function", () => {
        it("transpiles state() in begin array", () => {
            const code = `
begin("DLG", [state("greeting", () => {
    say(tra(100));
    exit();
})]);
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN DLG");
            expect(result).toContain("IF ~~ greeting");
            expect(result).toContain("SAY @100");
            expect(result).toContain("EXIT");
        });

        it("transpiles state() as rest-arg in begin", () => {
            const code = `
begin("DLG",
    state("s1", () => { say(tra(100)); exit(); }),
    state("s2", () => { say(tra(200)); exit(); })
);
`;
            const result = transpile(code);
            expect(result).toContain("BEGIN DLG");
            expect(result).toContain("IF ~~ s1");
            expect(result).toContain("IF ~~ s2");
            expect(result).toContain("SAY @100");
            expect(result).toContain("SAY @200");
        });

        it("transpiles state() in append", () => {
            const code = `
append("DLG", state("newState", () => {
    say(tra(100));
    reply(tra(101)).goTo(other);
}));
`;
            const result = transpile(code);
            expect(result).toContain("APPEND DLG");
            expect(result).toContain("IF ~~ newState");
            expect(result).toContain("++ @101 + other");
        });

        it("transpiles state() mixed with function references", () => {
            const code = `
function existing() {
    say(tra(100));
    exit();
}
begin("DLG", [
    existing,
    state("inline", () => {
        say(tra(200));
        exit();
    })
]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ existing");
            expect(result).toContain("IF ~~ inline");
        });

        it("transpiles state() with transitions and triggers", () => {
            const code = `
begin("DLG", [state("shop", () => {
    say(tra(100));
    if (PartyGoldGT(500)) {
        reply(tra(101)).exit();
    }
    reply(tra(102)).exit();
})]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ shop");
            expect(result).toContain("+~PartyGoldGT(500)~+ @101 EXIT");
            expect(result).toContain("++ @102 EXIT");
        });
    });

    // =========================================================================
    // Scope constants (GLOBAL, LOCALS, MYAREA) from externalized ielib
    // =========================================================================

    describe("Scope constants", () => {
        it("quotes GLOBAL in trigger", () => {
            const code = `
function s() {
    say(tra(100));
    if (Global("talked", GLOBAL, 1)) {
        reply(tra(101)).exit();
    }
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toContain('Global("talked","GLOBAL",1)');
        });

        it("quotes GLOBAL in action", () => {
            const code = `
function s() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("talked", GLOBAL, 1)).exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toContain('SetGlobal("talked","GLOBAL",1)');
        });

        it("quotes LOCALS in trigger", () => {
            const code = `
function s() {
    say(tra(100));
    if (Global("x", LOCALS, 0)) {
        reply(tra(101)).exit();
    }
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toContain('Global("x","LOCALS",0)');
        });

        it("quotes MYAREA in action", () => {
            const code = `
function s() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("x", MYAREA, 1)).exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toContain('SetGlobal("x","MYAREA",1)');
        });
    });

    // =========================================================================
    // @tra tag preservation
    // =========================================================================

    describe("@tra tag preservation", () => {
        it("preserves single-line @tra comment in output", () => {
            const code = `/** @tra smarter_familiars.tra */
function s() {
    say(tra(100));
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toMatch(/^\/\*\* @tra smarter_familiars\.tra \*\//);
        });

        it("extracts @tra from multi-line JSDoc", () => {
            const code = `/**
 * Dialog description.
 * @tra my_dialog.tra
 */
function s() {
    say(tra(100));
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toMatch(/^\/\*\* @tra my_dialog\.tra \*\//);
        });

        it("preserves @tra with .msg extension", () => {
            const code = `/** @tra test.msg */
function s() {
    say(tra(100));
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toMatch(/^\/\*\* @tra test\.msg \*\//);
        });

        it("omits @tra line when no tag present", () => {
            const code = `
function s() {
    say(tra(100));
    exit();
}
begin("DLG", [s]);
`;
            const result = transpile(code);
            expect(result).toMatch(/^\/\* Generated from/);
        });
    });

    // =========================================================================
    // Error cases
    // =========================================================================

    describe("Error cases", () => {
        it("throws on say() with no arguments", () => {
            const code = `
function state() {
    say();
    exit();
}
begin("DLG", [state]);
`;
            expect(() => transpile(code)).toThrow(/requires at least 1 argument/);
        });

        it("throws on goTo() with no arguments", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101));
    goTo();
}
begin("DLG", [state]);
`;
            expect(() => transpile(code)).toThrow(/requires at least 1 argument/);
        });

        it("throws on unknown chain method", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).unknownMethod().exit();
}
begin("DLG", [state]);
`;
            expect(() => transpile(code)).toThrow(/Unknown chain method/);
        });
    });

    // =========================================================================
    // extendBottom with position option
    // =========================================================================

    describe("extendBottom with position", () => {
        it("transpiles extendBottom with position option", () => {
            const code = `
extendBottom("DLG", "state1", { position: 3 }, () => {
    reply(tra(100)).exit();
});
`;
            const result = transpile(code);
            expect(result).toContain("EXTEND_BOTTOM DLG state1 #3");
        });
    });

    // =========================================================================
    // extern with ifFileExists
    // =========================================================================

    describe("extern with ifFileExists", () => {
        it("transpiles extern with ifFileExists option in chain", () => {
            const code = `
function state() {
    say(tra(100));
    reply(tra(101)).extern("OTHER", "state5", { ifFileExists: true });
}
begin("DLG", [state]);
`;
            const result = transpile(code);
            expect(result).toContain("EXTERN IF_FILE_EXISTS OTHER state5");
        });
    });

    describe("Enum support", () => {
        it("substitutes numeric enum values in action arguments", () => {
            const code = `
enum Direction { N = 0, NE = 1, E = 2, SE = 3, S = 4, SW = 5, W = 6, NW = 7 }

function potions() {
    say(tra(100));
    reply(tra(101)).action(CreateCreature("spy", "[-1.-1]", Direction.S)).goTo(confirm);
}
begin("DLG", [potions]);
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('CreateCreature("spy","[-1.-1]",4)');
        });

        it("substitutes enum values in trigger conditions", () => {
            const code = `
enum State { Idle = 0, Active = 1, Dead = 2 }

function greeting() {
    if (Global("state", "LOCALS", State.Active)) {
        say(tra(100));
        exit();
    }
}
append("DLG", [greeting]);
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('Global("state","LOCALS",1)');
        });

        it("substitutes string enum values", () => {
            const code = `
enum Area { Town = "AR0100", Castle = "AR0200" }

function entry() {
    say(tra(100));
    reply(tra(101)).action(SetGlobal("area", Area.Town, 1)).exit();
}
begin("DLG", [entry]);
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('SetGlobal("area","AR0100",1)');
        });
    });

    describe("variable evaluation of helper functions", () => {
        it("resolves obj() assigned to a variable", () => {
            const code = `
function start() {
    const target = obj("g_spy1");
    say(tra(1));
    reply(tra(2)).action(ActionOverride(target, DestroySelf())).exit();
}
begin("DLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain('ActionOverride("g_spy1",DestroySelf())');
            expect(result).not.toContain("obj(");
        });

        it("resolves obj() with object identifier assigned to a variable", () => {
            const code = `
function start() {
    const player = obj("[PC]");
    say(tra(1));
    reply(tra(2)).action(ActionOverride(player, Rest())).exit();
}
begin("DLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain("ActionOverride([PC],Rest())");
            expect(result).not.toContain("obj(");
        });

        it("resolves obj() in trigger context when assigned to a variable", () => {
            const code = `
function start() {
    const npc = obj("Minsc");
    say(tra(1));
    if (See(npc)) {
        reply(tra(2)).exit();
    }
}
begin("DLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain('See("Minsc")');
            expect(result).not.toContain("obj(");
        });
    });

    // =========================================================================
    // Transitive state collection (Phase 9)
    // =========================================================================

    // =========================================================================
    // State isolation between parse() calls
    // =========================================================================

    describe("parse() state isolation", () => {
        it("does not leak state between calls when first call throws", () => {
            const project = new Project({ useInMemoryFileSystem: true });

            // First call: invalid begin() with no arguments — should throw
            const badSource = project.createSourceFile("bad.td", `begin();`);
            expect(() => parse(badSource)).toThrow();

            // Second call: valid source — must succeed without contamination
            const goodSource = project.createSourceFile(
                "good.td",
                `
function start() {
    say(tra(100));
    exit();
}
begin("MYDLG", [start]);
`,
            );
            const ir = parse(goodSource);
            expect(ir.constructs).toHaveLength(1);
            // Non-null safe: guarded by toHaveLength(1) assertion above
            expect(ir.constructs[0]!.type).toBe("begin");
            if (ir.constructs[0]?.type === "begin") {
                expect(ir.constructs[0]!.states).toHaveLength(1);
                // Non-null safe: guarded by toHaveLength(1) assertion above
                expect(ir.constructs[0]!.states[0]!.label).toBe("start");
            }
        });
    });
});
