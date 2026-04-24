/**
 * Unit tests for TBAF transpiler.
 * Tests the transform and emit stages of TypeScript to BAF transpilation.
 */

import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { TBAFTransformer } from "../../transpilers/tbaf/src/transform";
import { emitBAF } from "../../transpilers/tbaf/src/emit";
import { applyBAFFixups } from "../../transpilers/tbaf/src/index";
import { transformEnums } from "../../transpilers/common/enum-transform";

describe("TBAF Transpiler", () => {
    const transformer = new TBAFTransformer();

    function transpile(code: string): string {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("test.tbaf", code);
        const ir = transformer.transform(sourceFile);
        applyBAFFixups(ir);
        return emitBAF(ir);
    }

    /** Transpile with enum pre-transform (simulates what bundle() does) */
    function transpileWithEnums(code: string): string {
        const { code: transformed } = transformEnums(code);
        return transpile(transformed);
    }

    describe("Basic IF/THEN/END blocks", () => {
        it("transpiles simple condition and action", () => {
            const code = `
if (See(Player1)) {
    Attack(Player1);
}
`;
            const result = transpile(code);
            expect(result).toContain("IF");
            expect(result).toContain("See(Player1)");
            expect(result).toContain("THEN");
            expect(result).toContain("RESPONSE #100");
            expect(result).toContain("Attack(Player1)");
            expect(result).toContain("END");
        });

        it("transpiles multiple conditions", () => {
            const code = `
if (See(Player1) && !Global("attacked", "LOCALS", 1)) {
    Attack(Player1);
    SetGlobal("attacked", "LOCALS", 1);
}
`;
            const result = transpile(code);
            expect(result).toContain("See(Player1)");
            expect(result).toContain('!Global("attacked", "LOCALS", 1)');
            expect(result).toContain("Attack(Player1)");
            expect(result).toContain('SetGlobal("attacked", "LOCALS", 1)');
        });

        it("transpiles OR conditions", () => {
            const code = `
if (See(Player1) || See(Player2)) {
    Attack(NearestEnemyOf(Myself));
}
`;
            const result = transpile(code);
            expect(result).toContain("OR(2)");
            expect(result).toContain("See(Player1)");
            expect(result).toContain("See(Player2)");
        });
    });

    describe("Compile-time loop unrolling", () => {
        it("unrolls for-of loop over const array", () => {
            const code = `
const enemies = ["Player1", "Player2", "Player3"];

for (const enemy of enemies) {
    if (See(enemy)) {
        Attack(enemy);
    }
}
`;
            const result = transpile(code);
            // Should have 3 IF blocks, one for each enemy
            expect(result).toContain('See("Player1")');
            expect(result).toContain('Attack("Player1")');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('Attack("Player2")');
            expect(result).toContain('See("Player3")');
            expect(result).toContain('Attack("Player3")');
        });

        it("unrolls for loop with numeric range", () => {
            const code = `
for (let i = 1; i <= 3; i++) {
    if (Global("count", "LOCALS", i)) {
        Continue();
    }
}
`;
            const result = transpile(code);
            expect(result).toContain('Global("count", "LOCALS", 1)');
            expect(result).toContain('Global("count", "LOCALS", 2)');
            expect(result).toContain('Global("count", "LOCALS", 3)');
        });
    });

    describe("Array spread expressions", () => {
        it("flattens spread in array literal", () => {
            const code = `
const base = ["Player1", "Player2"];
const all = [...base, "Player3"];

for (const target of all) {
    if (See(target)) {
        Attack(target);
    }
}
`;
            const result = transpile(code);
            // Should have Player1, Player2, Player3 from spread
            expect(result).toContain('See("Player1")');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('See("Player3")');
        });
    });

    describe("Array destructuring", () => {
        it("destructures array in for-of loop", () => {
            const code = `
const pairs = [["Player1", "SWORD01"], ["Player2", "BOW01"]];

for (const [target, item] of pairs) {
    if (See(target)) {
        GiveItemCreate(item, target, 1, 0, 0);
    }
}
`;
            const result = transpile(code);
            expect(result).toContain('See("Player1")');
            expect(result).toContain('GiveItemCreate("SWORD01", "Player1", 1, 0, 0)');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('GiveItemCreate("BOW01", "Player2", 1, 0, 0)');
        });
    });

    describe("Function inlining", () => {
        it("inlines user-defined functions", () => {
            const code = `
function attackIfVisible(target: string) {
    if (See(target)) {
        Attack(target);
    }
}

attackIfVisible("Player1");
attackIfVisible("Player2");
`;
            const result = transpile(code);
            expect(result).toContain('See("Player1")');
            expect(result).toContain('Attack("Player1")');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('Attack("Player2")');
        });

        it("inlines functions with multiple parameters", () => {
            const code = `
function giveItem(target: string, item: string) {
    if (See(target)) {
        GiveItemCreate(item, target, 1, 0, 0);
    }
}

giveItem("Player1", "SWORD01");
giveItem("Player2", "BOW01");
`;
            const result = transpile(code);
            expect(result).toContain('See("Player1")');
            expect(result).toContain('GiveItemCreate("SWORD01", "Player1", 1, 0, 0)');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('GiveItemCreate("BOW01", "Player2", 1, 0, 0)');
        });
    });

    describe("Point arguments", () => {
        it("converts point tuple to BAF point notation", () => {
            const code = `
if (True()) {
    CreateCreature("ccguard2", [2791, 831], 6);
}
`;
            const result = transpile(code);
            expect(result).toContain('CreateCreature("ccguard2", [2791.831], 6)');
        });

        it("converts point tuple through variable substitution", () => {
            const code = `
const pos: [number, number] = [100, 200];

if (True()) {
    CreateCreature("ccguard2", pos, 6);
}
`;
            const result = transpile(code);
            expect(result).toContain('CreateCreature("ccguard2", [100.200], 6)');
        });

        it("converts point tuple through function inlining", () => {
            const code = `
function spawn(resref: string, pos: [number, number]) {
    if (True()) {
        CreateCreature(resref, pos, 0);
    }
}

spawn("ccguard2", [2791, 831]);
`;
            const result = transpile(code);
            expect(result).toContain('CreateCreature("ccguard2", [2791.831], 0)');
        });

        it("converts point tuples through for-of loop unrolling", () => {
            const code = `
const positions: [string, [number, number]][] = [
    ["ccguard1", [100, 200]],
    ["ccguard2", [300, 400]],
];

for (const [resref, pos] of positions) {
    if (True()) {
        CreateCreature(resref, pos, 0);
    }
}
`;
            const result = transpile(code);
            expect(result).toContain('CreateCreature("ccguard1", [100.200], 0)');
            expect(result).toContain('CreateCreature("ccguard2", [300.400], 0)');
        });
    });

    describe("Translation references", () => {
        it("converts $tra() to @number", () => {
            const code = `
if (True()) {
    DisplayStringHead(Myself, $tra(123));
}
`;
            const result = transpile(code);
            expect(result).toContain("@123");
        });
    });

    describe("Response priorities", () => {
        it("defaults to response 100", () => {
            const code = `
if (See(Player1)) {
    Attack(Player1);
}
`;
            const result = transpile(code);
            expect(result).toContain("RESPONSE #100");
        });
    });

    describe("Switch statements", () => {
        it("transpiles switch to multiple IF blocks", () => {
            const code = `
const state = Global("state", "LOCALS");
switch (state) {
    case 0:
        ActionA();
        break;
    case 1:
        ActionB();
        break;
}
`;
            const result = transpile(code);
            expect(result).toContain('Global("state", "LOCALS", 0)');
            expect(result).toContain("ActionA()");
            expect(result).toContain('Global("state", "LOCALS", 1)');
            expect(result).toContain("ActionB()");
        });

        it("handles multiple actions per case", () => {
            const code = `
switch (Global("phase", "MYAREA")) {
    case 0:
        DisplayString(Myself, 100);
        SetGlobal("phase", "MYAREA", 1);
        break;
    case 1:
        DisplayString(Myself, 200);
        ActionOverride(Player1, StartDialogNoSet(Myself));
        break;
}
`;
            const result = transpile(code);
            expect(result).toContain('Global("phase", "MYAREA", 0)');
            expect(result).toContain("DisplayString(Myself, 100)");
            expect(result).toContain('SetGlobal("phase", "MYAREA", 1)');
            expect(result).toContain('Global("phase", "MYAREA", 1)');
            expect(result).toContain("DisplayString(Myself, 200)");
            expect(result).toContain("ActionOverride(Player1, StartDialogNoSet(Myself))");
        });

        it("handles numeric case values", () => {
            const code = `
switch (Global("count", "LOCALS")) {
    case 5:
        Continue();
        break;
    case 10:
        NoAction();
        break;
}
`;
            const result = transpile(code);
            expect(result).toContain('Global("count", "LOCALS", 5)');
            expect(result).toContain('Global("count", "LOCALS", 10)');
        });

        it("substitutes const values in case expressions", () => {
            const code = `
const STATE_IDLE = 0;
const STATE_ACTIVE = 1;

switch (Global("state", "LOCALS")) {
    case STATE_IDLE:
        Wait(1);
        break;
    case STATE_ACTIVE:
        Attack(NearestEnemyOf(Myself));
        break;
}
`;
            const result = transpile(code);
            expect(result).toContain('Global("state", "LOCALS", 0)');
            expect(result).toContain("Wait(1)");
            expect(result).toContain('Global("state", "LOCALS", 1)');
            expect(result).toContain("Attack(NearestEnemyOf(Myself))");
        });
    });

    describe("Enum support", () => {
        it("substitutes numeric enum values in conditions and actions", () => {
            const code = `
enum DamageType { Fire = 1, Ice = 2, Lightning = 3 }

if (CheckSpellState(Myself, DamageType.Fire)) {
    ApplySpell(NearestEnemyOf(Myself), DamageType.Ice);
}
`;
            const result = transpileWithEnums(code);
            expect(result).toContain("CheckSpellState(Myself, 1)");
            expect(result).toContain("ApplySpell(NearestEnemyOf(Myself), 2)");
        });

        it("substitutes string enum values in actions", () => {
            const code = `
enum Script { Player = "Player1", Enemy = "ENMYSCR" }

if (See(Script.Player)) {
    SetGlobal("seen", Script.Enemy, 1);
}
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('See("Player1")');
            expect(result).toContain('SetGlobal("seen", "ENMYSCR", 1)');
        });

        it("uses enum values in switch case expressions", () => {
            const code = `
enum State { Idle, Active, Dead }

switch (Global("state", "LOCALS")) {
    case State.Idle:
        Wait(1);
        break;
    case State.Active:
        Attack(NearestEnemyOf(Myself));
        break;
}
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('Global("state", "LOCALS", 0)');
            expect(result).toContain("Wait(1)");
            expect(result).toContain('Global("state", "LOCALS", 1)');
            expect(result).toContain("Attack(NearestEnemyOf(Myself))");
        });

        it("uses enum values in for-of array literals", () => {
            const code = `
enum Target { Player1 = "Player1", Player2 = "Player2" }

const targets = [Target.Player1, Target.Player2];

for (const t of targets) {
    if (See(t)) {
        Attack(t);
    }
}
`;
            const result = transpileWithEnums(code);
            expect(result).toContain('See("Player1")');
            expect(result).toContain('Attack("Player1")');
            expect(result).toContain('See("Player2")');
            expect(result).toContain('Attack("Player2")');
        });
    });
});
