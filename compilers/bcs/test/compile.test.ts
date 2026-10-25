import { beforeAll, describe, expect, test } from "vitest";
import type { Parser } from "web-tree-sitter";
import {
    BcsCompileError,
    compileBaf,
    compileSymbolsFrom,
    decompileBcs,
    readBcs,
    writeBcs,
    type BcsCompileDiagnostic,
    type BcsCompileSymbols,
    type BcsSignatureRow,
} from "@bgforge/bcs";
import { getParser, initParser } from "@bgforge/shared/parsers/weidu-baf";
import { COMPILE_SYMBOLS, SYMBOLS } from "./fixture-symbols";

/**
 * Hermetic cover for compiling, beside the reference differential.
 *
 * `weidu-differential.test.ts` is the authority on what a compiled script should hold - it compares against
 * what the reference produces from the same source. These are for what a differential cannot reach: the
 * refusals, and the two places a stored record carries something BAF has no way to say, where the right
 * behaviour is a documented degradation rather than agreement.
 */

let parser: Parser;

beforeAll(async () => {
    await initParser();
    parser = getParser();
});

const compile = (source: string): string => writeBcs(compileBaf(parser, source, COMPILE_SYMBOLS));

/** One block, with the given condition and response body, in the shape the decompiler emits. */
const script = (condition: string, actions: string[] = []): string =>
    [
        "IF",
        ...condition.split("\n").map((line) => `  ${line}`),
        "THEN",
        "  RESPONSE #100",
        ...actions.map((a) => `    ${a}`),
        "END",
        "",
    ].join("\n");

describe("compileBaf - what a record holds", () => {
    test("a negated trigger sets bit 0 of its flags word", () => {
        const plain = compileBaf(parser, script("HPGT([ANYONE],20)"), COMPILE_SYMBOLS);
        const negated = compileBaf(parser, script("!HPGT([ANYONE],20)"), COMPILE_SYMBOLS);

        expect(plain.blocks[0]!.triggers[0]!.ints[2]).toBe(0);
        expect(negated.blocks[0]!.triggers[0]!.ints[2]).toBe(1);
    });

    test("a comment in front of the negation does not hide it", () => {
        // The `!` is an anonymous child and comments are extras the grammar hangs anywhere, so reading the
        // condition's text from the front finds the comment instead.
        const compiled = compileBaf(parser, script("/* why */ !HPGT([ANYONE],20)"), COMPILE_SYMBOLS);

        expect(compiled.blocks[0]!.triggers[0]!.ints[2]).toBe(1);
    });

    test("OR(n) is a stored trigger whose first integer is the count", () => {
        const compiled = compileBaf(parser, script("OR(2)\n  False()\n  False()"), COMPILE_SYMBOLS);

        const [or, ...rest] = compiled.blocks[0]!.triggers;
        expect(or!.ints[0]).toBe(0x4089);
        expect(or!.ints[1]).toBe(2);
        expect(rest).toHaveLength(2);
    });

    test("ActionOverride stores the inner action's id with the override in the first object slot", () => {
        const compiled = compileBaf(
            parser,
            script("False()", ['ActionOverride("Bodhi",Attack([ANYONE]))']),
            COMPILE_SYMBOLS,
        );

        const action = compiled.blocks[0]!.responses[0]!.actions[0]!;
        // Id 3 is Attack, not the id ACTION.IDS gives ActionOverride - nothing nested is ever stored.
        expect(action.id).toBe(3);
        expect(action.objects[0]!.string).toBe("Bodhi");
        expect(action.objects).toHaveLength(3);
    });

    test("TriggerOverride writes a NextTriggerObject record in front of the trigger it retargets", () => {
        const compiled = compileBaf(parser, script('TriggerOverride("Bodhi",HPGT([ANYONE],20))'), COMPILE_SYMBOLS);

        const [next, retargeted] = compiled.blocks[0]!.triggers;
        expect(next!.ints[0]).toBe(0x40e0);
        expect(next!.object.string).toBe("Bodhi");
        expect(retargeted!.ints[0]).toBe(0x4011);
    });

    test("an identifier chain is stored innermost first", () => {
        const compiled = compileBaf(parser, script("See(NearestEnemyOf(LastSeenBy))"), COMPILE_SYMBOLS);

        // Twelve numbers: seven enumerated fields, then the five identifier slots.
        expect(compiled.blocks[0]!.triggers[0]!.object.ints).toEqual([0, 0, 0, 0, 0, 0, 0, 18, 12, 0, 0, 0]);
    });

    test("an object with nothing set at all stores as zeroes", () => {
        const compiled = compileBaf(parser, script("See([ANYONE])"), COMPILE_SYMBOLS);

        const object = compiled.blocks[0]!.triggers[0]!.object;
        expect(object.ints.every((value) => value === 0)).toBe(true);
        expect(object.string).toBe("");
    });

    test("a value a table spells unsigned is stored as the signed dword a record holds", () => {
        // STATE.IDS spells STATE_SILENCED 0x80000000, which no file can hold as a positive number.
        const compiled = compileBaf(parser, script("HPGT([ANYONE],0x80000000)"), COMPILE_SYMBOLS);

        expect(compiled.blocks[0]!.triggers[0]!.ints[1]).toBe(-2147483648);
    });

    // Real scripts bracket an enumerated value the same way they bracket an object ([NEUTRAL] in
    // `Allegiance(Myself,[NEUTRAL])`, from BGT-WeiDU's alarys.baf) - WeiDU's grammar does not tell the two
    // apart until the parameter's own type does, so a single-name bracket around an I:-typed argument must
    // compile identically to the bare identifier.
    test("a bracketed enumerated value compiles the same as its bare form", () => {
        const bracketed = compile(script("False()", ["ApplySpell([ANYONE],[WIZARD_MAGIC_MISSILE])"]));
        const bare = compile(script("False()", ["ApplySpell([ANYONE],WIZARD_MAGIC_MISSILE)"]));

        expect(bracketed).toBe(bare);
    });

    // A real name can alias a value: BG2/BGEE's CLASS.IDS spells 202 both LONG_BOW and MAGE_ALL (the fixture
    // copies both rows verbatim). Both must resolve to the same field value, proving the compiler inverts
    // idsAll (every alias) rather than ids (the one name a value is canonical under).
    test("an aliased IDS name compiles to the same value as its alias", () => {
        const longBow = compile(script("See([0.0.0.LONG_BOW])"));
        const mageAll = compile(script("See([0.0.0.MAGE_ALL])"));

        expect(longBow).toBe(mageAll);
        const compiled = compileBaf(parser, script("See([0.0.0.LONG_BOW])"), COMPILE_SYMBOLS);
        expect(compiled.blocks[0]!.triggers[0]!.object.ints[3]).toBe(202);
    });

    test("a call with no name in the tables keeps the id the decompiler printed", () => {
        const compiled = compileBaf(parser, script("False()", ["UnknownAction812()"]), COMPILE_SYMBOLS);

        expect(compiled.blocks[0]!.responses[0]!.actions[0]!.id).toBe(812);
    });
});

describe("compileBaf - what BAF cannot say", () => {
    /**
     * The BG1-era writer omits a record's unused fields rather than writing them, so a script that ships with
     * one cannot come back byte-identical: BAF has no spelling for "this record stops early". The full form
     * is what the reference writes for the same source, and what the engine reads either way.
     */
    const truncated = [
        "SC",
        "CR",
        "CO",
        "TR",
        "16401 20OB",
        '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
        "TR",
        "CO",
        "RS",
        "RE",
        "100RE",
        "RS",
        "CR",
        "SC",
        "",
    ].join("\n");

    test("a truncated record compiles back as a full one", () => {
        const source = decompileBcs(readBcs(truncated), SYMBOLS);

        const compiled = compile(source);

        expect(source).toContain("HPGT([ANYONE],20)");
        expect(compiled).toContain('16401 20 0 0 0 "" "" OB');
    });

    test("and the round trip is stable from there", () => {
        // The degradation happens once. A script saved from the editable view and saved again has to be the
        // same bytes, or every save would drift a little further from what the game shipped.
        const once = compile(decompileBcs(readBcs(truncated), SYMBOLS));

        const twice = compile(decompileBcs(readBcs(once), SYMBOLS));

        expect(twice).toBe(once);
    });

    test("a response with no actions is written as a bare weight", () => {
        // Real scripts carry them, and the reference accepts the source form - so the grammar has to too.
        const compiled = compile(script("False()"));

        expect(compiled).toContain("100RE");
    });
});

/**
 * The fixture tables plus the rows a case needs, for shapes a real install's do not carry: an id a table
 * names twice, a signature this cannot store. The rest of the script still has to compile, so these ADD to
 * the tables rather than standing in for them.
 */
function symbolsWith(rows: { triggers?: BcsSignatureRow[]; actions?: BcsSignatureRow[] }): BcsCompileSymbols {
    const named = (list: BcsSignatureRow[] | undefined, name: string): BcsSignatureRow[] =>
        (list ?? []).filter((row) => row.signature.toLowerCase().startsWith(`${name.toLowerCase()}(`));
    return {
        triggerByName: (name) => [...COMPILE_SYMBOLS.triggerByName(name), ...named(rows.triggers, name)],
        actionByName: (name) => [...COMPILE_SYMBOLS.actionByName(name), ...named(rows.actions, name)],
        idsAll: COMPILE_SYMBOLS.idsAll,
    };
}

/** The fixture tables with one call's rows taken OUT, for the two constructs a missing row makes unwritable. */
function symbolsWithout(missing: string): BcsCompileSymbols {
    const gone = (name: string): boolean => name.toLowerCase() === missing.toLowerCase();
    return {
        triggerByName: (name) => (gone(name) ? [] : COMPILE_SYMBOLS.triggerByName(name)),
        actionByName: COMPILE_SYMBOLS.actionByName,
        idsAll: COMPILE_SYMBOLS.idsAll,
    };
}

/** The problems a compile refused with, or an empty list when it did not refuse. */
function problemsOf(run: () => unknown): string[] {
    try {
        run();
    } catch (error) {
        return error instanceof BcsCompileError ? error.diagnostics.map((problem) => problem.message) : [String(error)];
    }
    return [];
}

describe("compileBaf - refusals", () => {
    test("a source the grammar cannot read is refused, with every error located", () => {
        // The class alone passes on any refusal, including one raised for an unrelated reason; the sibling
        // tests below pin the sentence, and this one owes its own name a located diagnostic too.
        let refusal: BcsCompileError | undefined;
        try {
            compile("IF\n  See(\nTHEN\n");
        } catch (error) {
            refusal = error instanceof BcsCompileError ? error : undefined;
        }

        expect(refusal?.diagnostics.map((problem) => problem.message)).toEqual(["syntax error"]);
        // Located within the source, not pinned to a line: the parser reports the start of the region it
        // could not close (here line 1, where the IF opens) rather than the token that broke it.
        expect(refusal?.diagnostics[0]?.line).toBeGreaterThanOrEqual(1);
        expect(refusal?.diagnostics[0]?.line).toBeLessThanOrEqual(3);
    });

    test("a name no table gives is refused rather than compiled to an invented id", () => {
        let refusal: BcsCompileError | undefined;
        try {
            compile(script("NoSuchTrigger(1)"));
        } catch (error) {
            refusal = error as BcsCompileError;
        }

        expect(refusal?.diagnostics[0]?.message).toContain("NoSuchTrigger");
        expect(refusal?.diagnostics[0]?.line).toBe(2);
    });

    test("every unresolvable name is reported, not only the first", () => {
        let refusal: BcsCompileError | undefined;
        try {
            compile(script("False()", ["NoSuchAction()", "AlsoMissing()"]));
        } catch (error) {
            refusal = error as BcsCompileError;
        }

        expect(refusal?.diagnostics).toHaveLength(2);
    });

    test("a call given the wrong number of arguments is refused", () => {
        let refusal: BcsCompileError | undefined;
        try {
            compile(script("HPGT([ANYONE])"));
        } catch (error) {
            refusal = error as BcsCompileError;
        }

        expect(refusal?.diagnostics[0]?.message).toContain("takes 2 arguments");
    });

    test("an argument naming nothing in the table its signature points at is refused", () => {
        let refusal: BcsCompileError | undefined;
        try {
            compile(script("False()", ["ApplySpell([ANYONE],NO_SUCH_SPELL)"]));
        } catch (error) {
            refusal = error as BcsCompileError;
        }

        expect(refusal?.diagnostics[0]?.message).toContain("SPELL.IDS does not name NO_SUCH_SPELL");
    });
});

describe("compileBaf - what it will not guess at", () => {
    test("a parser with no tree is refused rather than compiled as an empty script", () => {
        const noTree = { parse: () => null } as unknown as Parser;

        expect(() => compileBaf(noTree, script("False()"), COMPILE_SYMBOLS)).toThrow(/no tree/);
    });

    test("an argument type BCS has no stored form for is refused", () => {
        // `A:Action*` - the format reference says outright it does not know how one is stored. The only row
        // a real table gives it is ActionOverride, which never reaches this path because it is resolved by
        // name, so the shape has to be supplied here.
        const symbols = symbolsWith({ actions: [{ id: 400, signature: "RunSomething(A:Action*)" }] });

        const problems = problemsOf(() => compileBaf(parser, script("False()", ["RunSomething(Continue())"]), symbols));

        expect(problems[0]).toContain("no stored form for");
    });

    test("more strings than a record stores is refused rather than silently dropped", () => {
        const symbols = symbolsWith({ actions: [{ id: 401, signature: "ThreeStrings(S:A*,S:B*,S:C*)" }] });

        const problems = problemsOf(() =>
            compileBaf(parser, script("False()", ['ThreeStrings("a","b","c")']), symbols),
        );

        expect(problems[0]).toContain("do not fit");
    });

    test("a row is chosen by argument count where a table names one call twice", () => {
        const symbols = symbolsWith({
            actions: [
                { id: 410, signature: "Twice(O:Target*)" },
                { id: 411, signature: "Twice(O:Target*,I:Value*)" },
            ],
        });

        const compiled = compileBaf(parser, script("False()", ["Twice(Myself,3)"]), symbols);

        expect(compiled.blocks[0]!.responses[0]!.actions[0]!.id).toBe(411);
    });

    test("TriggerOverride is refused where the table cannot name its stored half", () => {
        // BG2:ToB's TRIGGER.IDS has no NextTriggerObject row at all, so the construct simply cannot be
        // written there - inventing an id would produce a file the game reads as something else.
        const symbols = symbolsWithout("NextTriggerObject");

        const problems = problemsOf(() =>
            compileBaf(parser, script("TriggerOverride(Myself,HPGT([ANYONE],20))"), symbols),
        );

        expect(problems[0]).toContain("no NextTriggerObject");
    });

    test("OR is refused where the table cannot name it", () => {
        const symbols = symbolsWithout("OR");

        const problems = problemsOf(() => compileBaf(parser, script("OR(2)\n  False()\n  False()"), symbols));

        expect(problems[0]).toContain("no OR");
    });

    test("an unnamed trigger keeps the id the decompiler printed", () => {
        const compiled = compileBaf(parser, script("UnknownTrigger9001()"), COMPILE_SYMBOLS);

        expect(compiled.blocks[0]!.triggers[0]!.ints[0]).toBe(9001);
    });

    test("an override wrapping the wrong shape is refused", () => {
        expect(problemsOf(() => compile(script("TriggerOverride(Myself)")))[0]).toContain("TriggerOverride takes");
        // ActionOverride is a word of its own in the grammar, as in the reference, so the wrong shape never
        // reaches the compiler as a call.
        expect(problemsOf(() => compile(script("False()", ["ActionOverride(Myself)"])))).toEqual(["syntax error"]);
    });
});

describe("compileSymbolsFrom", () => {
    // ACTION.IDS names one id twice 32 times over on a real install, so the index is many-rows-per-name
    // and the inversion must keep every row rather than letting a later one win.
    test("indexes every row that spells the same call, keyed case-insensitively", () => {
        const game = {
            idsAll: (resref: string) =>
                resref === "ACTION"
                    ? new Map([
                          [30, ["MoveToPoint(P:Point*)"]],
                          [160, ["DisplayString(O:Object*,I:StrRef*)", "displaystring(S:Text*)"]],
                      ])
                    : undefined,
        };

        const symbols = compileSymbolsFrom(game);

        expect(symbols.actionByName("MOVETOPOINT")).toEqual([{ id: 30, signature: "MoveToPoint(P:Point*)" }]);
        expect(symbols.actionByName("DisplayString")).toEqual([
            { id: 160, signature: "DisplayString(O:Object*,I:StrRef*)" },
            { id: 160, signature: "displaystring(S:Text*)" },
        ]);
        expect(symbols.actionByName("nosuchaction")).toEqual([]);
    });

    test("indexes triggers from TRIGGER.IDS and passes idsAll straight through", () => {
        const scroll = new Map([[4, ["VERY_FAST", "BD_NORMAL"]]]);
        const game = {
            idsAll: (resref: string) =>
                resref === "TRIGGER"
                    ? new Map([[16395, ["Global(S:Name*,S:Area*,I:Value*)"]]])
                    : resref === "SCROLL"
                      ? scroll
                      : undefined,
        };

        const symbols = compileSymbolsFrom(game);

        expect(symbols.triggerByName("global")).toEqual([{ id: 16395, signature: "Global(S:Name*,S:Area*,I:Value*)" }]);
        expect(symbols.idsAll("SCROLL")).toBe(scroll);
        expect(symbols.idsAll("MISSING")).toBeUndefined();
    });

    // An install with no such table must read as "no rows", not throw - it is how a partial install behaves.
    test("reports no rows when the install has no such table", () => {
        const symbols = compileSymbolsFrom({ idsAll: () => undefined });

        expect(symbols.actionByName("MoveToPoint")).toEqual([]);
        expect(symbols.triggerByName("Global")).toEqual([]);
    });
});

describe("compileBaf - arguments that do not fit their parameter", () => {
    const refusal = (source: string): string => problemsOf(() => compile(source))[0] ?? "";

    test("a number where a string belongs", () => {
        expect(refusal(script("False()", ["PlaySound(5)"]))).toContain("expected a quoted string");
    });

    test("a bracket list where a point belongs", () => {
        expect(refusal(script("False()", ["MoveToPoint([1.2.3])"]))).toContain("expected a point");
    });

    test("a string-table reference where a number belongs", () => {
        expect(refusal(script("HPGT([ANYONE],~twenty~)"))).toContain("expected a number");
    });

    test("a name where the parameter points at no table", () => {
        // HPGT's `I:Hit Points*` names no table, so a name there can resolve nowhere at all.
        expect(refusal(script("HPGT([ANYONE],SOME_NAME)"))).toContain("names no table");
    });

    test("a coordinate that is not a number", () => {
        // `%px%` is a WeiDU install-time substitution; nothing resolves it here.
        expect(refusal(script("False()", ["MoveToPoint([%px%.%py%])"]))).toContain("is not a number");
    });

    test("a name the argument's own table does not carry", () => {
        expect(refusal(script("False()", ["ApplySpell([ANYONE],NO_SUCH_SPELL)"]))).toContain("SPELL.IDS does not name");
    });
});

describe("compileBaf - objects that do not fit", () => {
    const refusal = (source: string): string => problemsOf(() => compile(source))[0] ?? "";

    test("something that is not an object at all", () => {
        expect(refusal(script("See(5)"))).toContain("is not an object");
    });

    test("an identifier chain deeper than a record's five slots", () => {
        const nested = "Nothing(Nothing(Nothing(Nothing(Nothing(Myself)))))";

        expect(refusal(script(`See(${nested})`))).toContain("nests at most 5");
    });

    test("an identifier no OBJECT.IDS row names", () => {
        expect(refusal(script("See(NoSuchObject)"))).toContain("OBJECT.IDS does not name");
    });

    test("more fields than the engine's objects carry", () => {
        expect(refusal(script("See([1.2.3.4.5.6.7.8])"))).toContain("at most 7 fields");
    });

    test("a field name its own table does not carry", () => {
        expect(refusal(script("See([NO_SUCH_ALLEGIANCE])"))).toContain("EA.IDS does not name");
    });
});

describe("compileBaf - spellings the reference reads", () => {
    const objectOf = (source: string, engine: "bg" | "iwd" = "bg") =>
        compileBaf(parser, source, COMPILE_SYMBOLS, engine).blocks[0]!.triggers[0]!.object;

    test("ANYONE among other bracket components is the value 0, as the reference reads it", () => {
        // RACE.IDS has no ANYONE row, so a table lookup would refuse this.
        expect(objectOf(script("See([ENEMY.HUMANOID.ANYONE])")).ints.slice(0, 7)).toEqual([255, 1, 0, 0, 0, 0, 0]);
        expect(objectOf(script("See([ENEMY.HUMANOID.anyone])")).ints.slice(0, 7)).toEqual([255, 1, 0, 0, 0, 0, 0]);
    });

    test("an object rectangle is stored where the engine has the field, and dropped where it has not", () => {
        const plain = objectOf(script("See(Player1)"), "iwd");
        const withRect = objectOf(script("See(Player1[1.2.3.4])"), "iwd");

        expect(plain.region).toEqual([-1, -1, -1, -1]);
        expect(withRect.region).toEqual([1, 2, 3, 4]);
        expect(withRect.ints).toEqual(plain.ints);
        expect(compile(script("See([ENEMY][1.2.3.4])"))).toBe(compile(script("See([ENEMY])")));
    });

    test("a rectangle after an object the decompiler printed compiles back", () => {
        const source = script("See(NearestEnemyOf(Myself)[5.6.7.8])", ['Attack("Druid3"[1.2.3.4])']);

        const compiled = compileBaf(parser, source, COMPILE_SYMBOLS, "iwd");

        expect(compiled.blocks[0]!.triggers[0]!.object.region).toEqual([5, 6, 7, 8]);
        expect(compiled.blocks[0]!.responses[0]!.actions[0]!.objects[1]!.region).toEqual([1, 2, 3, 4]);
    });

    test("an ActionOverride without its closing parenthesis compiles as the closed form", () => {
        const open = script("False()", ["ActionOverride(Player1,Attack([ENEMY])", "Continue()"]);
        const closed = script("False()", ["ActionOverride(Player1,Attack([ENEMY]))", "Continue()"]);

        expect(compile(open)).toBe(compile(closed));
    });

    test("a TriggerOverride without its closing parenthesis is refused", () => {
        // Unlike ActionOverride, whose closing parenthesis the reference does not require.
        expect(problemsOf(() => compile(script("TriggerOverride(Player1,False()")))).toEqual(["missing )"]);
    });

    test("a hash integer and a negative hex integer are numbers", () => {
        const second = (value: string) =>
            compileBaf(parser, script(`HPGT([ANYONE],${value})`), COMPILE_SYMBOLS).blocks[0]!.triggers[0]!.ints[1];

        expect(second("#5")).toBe(5);
        expect(second("# 5")).toBe(5);
        expect(second("-0x10")).toBe(-16);
    });

    test("a response list may be empty", () => {
        const compiled = compileBaf(parser, "IF\n  False()\nTHEN\nEND\n", COMPILE_SYMBOLS);

        expect(compiled.blocks[0]!.responses).toEqual([]);
    });

    test("a five-quote symbol names a table entry like the bare word", () => {
        const quoted = script("False()", ['ApplySpell([ANYONE],"""""WIZARD_MAGIC_MISSILE""""")']);
        const bare = script("False()", ["ApplySpell([ANYONE],WIZARD_MAGIC_MISSILE)"]);

        expect(compile(quoted)).toBe(compile(bare));
    });

    test("a translated text with a sound is refused: only an install can resolve it", () => {
        const problems = problemsOf(() => compile(script("False()", ["DisplayStringHead(Myself,~hi~ [SND])"])));

        expect(problems).toEqual(["expected a number, not ~hi~ [SND]"]);
    });

    test("a string keeps what is between its delimiters, whatever the form", () => {
        const stored = (argument: string) =>
            compileBaf(parser, script("False()", [`PlaySound(${argument})`]), COMPILE_SYMBOLS).blocks[0]!.responses[0]!
                .actions[0]!.strings[0];

        expect(stored('"// x"')).toBe("// x");
        expect(stored("~~~~~a ~ b~~~~~")).toBe("a ~ b");
        expect(stored('"two\nlines"')).toBe("two\nlines");
    });

    test("a variable as a call name is refused, naming the variable", () => {
        const problems = problemsOf(() => compile(script("False()", ["%RunAway%(Myself)"])));

        expect(problems).toEqual(["this game's ACTION.IDS has no action called %RunAway%"]);
    });

    test("a variable in a value position is refused, naming the variable", () => {
        expect(problemsOf(() => compile(script("OR(%n%)\n  False()\n  False()")))).toEqual(["%n% is not a number"]);
    });
});

/** The located problems a compile refused with, or none when it did not refuse. */
function diagnosticsOf(source: string): readonly BcsCompileDiagnostic[] {
    try {
        compile(source);
    } catch (error) {
        return error instanceof BcsCompileError ? error.diagnostics : [];
    }
    return [];
}

describe("compileBaf - which text form fits which slot", () => {
    const refusals = (source: string): string[] => diagnosticsOf(source).map((problem) => problem.message);
    const storedString = (argument: string) =>
        compileBaf(parser, script("False()", [`PlaySound(${argument})`]), COMPILE_SYMBOLS).blocks[0]!.responses[0]!
            .actions[0]!.strings[0];
    const storedSpell = (argument: string) =>
        compileBaf(parser, script("False()", [`ApplySpell(Player1,${argument})`]), COMPILE_SYMBOLS).blocks[0]!
            .responses[0]!.actions[0]!.ints[0];

    // The reference reads ~text~ and %text% as a dialog string reference, which is a number, so a string or an
    // object slot refuses it with a type mismatch.
    test.each(["~x~", "%a-b%"])("%s in a string slot is refused at the argument", (argument) => {
        const source = script("False()", [`PlaySound(${argument})`]);
        const found = diagnosticsOf(source);

        expect(found.map((problem) => problem.message)).toEqual([
            `${argument} is a string-table reference, which only a number argument takes, not a string`,
        ]);
        expect(found[0]).toMatchObject({ line: 5, column: source.split("\n")[4]!.indexOf(argument) + 1 });
    });

    test("a ~text~ as an object is refused at the argument", () => {
        expect(refusals(script("False()", ["Attack(~Druid3~)"]))).toEqual([
            "~Druid3~ is a string-table reference, which only a number argument takes, not an object",
        ]);
    });

    test("a variable in a string slot stays refused, naming it", () => {
        expect(refusals(script("False()", ["PlaySound(%x%)"]))).toEqual(["expected a quoted string, not %x%"]);
    });

    test("the five-tilde form stays a plain string in a string slot", () => {
        expect(storedString("~~~~~x~~~~~")).toBe("x");
    });

    test("a quoted text in a number slot is read as the bare name or number would be", () => {
        const wanted = storedSpell("WIZARD_MAGIC_MISSILE");

        expect(storedSpell('"WIZARD_MAGIC_MISSILE"')).toBe(wanted);
        expect(storedSpell("~~~~~WIZARD_MAGIC_MISSILE~~~~~")).toBe(wanted);
        expect(storedSpell('"3"')).toBe(3);
        expect(storedSpell('"0x10"')).toBe(16);
    });

    test("a quoted text no table names is refused in a number slot", () => {
        expect(refusals(script("False()", ['ApplySpell(Player1,"abc")']))).toEqual([
            "this game's SPELL.IDS does not name abc",
        ]);
    });

    test("a string-table reference in a number slot is refused: only an install can resolve it", () => {
        expect(refusals(script("HPGT(Player1,~3~)"))).toEqual(["expected a number, not ~3~"]);
    });
});

describe("compileBaf - hex integers", () => {
    const second = (value: string) =>
        compileBaf(parser, script(`HPGT([ANYONE],${value})`), COMPILE_SYMBOLS).blocks[0]!.triggers[0]!.ints[1];

    // The reference's hex number is the prefix and decimal digits only, read as base 16.
    test("0x then decimal digits is read as base 16", () => {
        expect(second("0x10")).toBe(16);
        expect(second("0x19")).toBe(25);
    });

    test.each(["0xFF", "0xff", "0x1a", "0X10", "-0xFF"])("%s is refused as the reference refuses it", (value) => {
        expect(problemsOf(() => compile(script(`HPGT([ANYONE],${value})`)))).toEqual(["syntax error"]);
    });
});
