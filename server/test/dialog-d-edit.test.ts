import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD } from "../../shared/dialog-model";
import { applyDialogEdits, pendingInserts, verifyDialogEditApplied } from "../../shared/dialog-d-edit";
import type { DialogState } from "../../shared/dialog-model";

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

// A realistic .d file with:
//   - a leading block comment
//   - a BEGIN block with two states
//   - an ALTER_TRANS patch block (preserved verbatim - not a parsed state)
const FIXTURE = `/* greeting dialog - do not edit manually */
BEGIN ~greeter~
IF ~~ THEN BEGIN intro
  SAY ~Hello, traveller.~
  IF ~PlayerKnowsAboutItem~ THEN REPLY ~Tell me more.~ GOTO details
  IF ~~ THEN REPLY ~Farewell.~ EXIT
END
IF ~~ THEN BEGIN details
  SAY ~The item lies to the north.~
  IF ~~ THEN REPLY ~Thanks.~ EXIT
END
END

ALTER_TRANS ~greeter~ #0 #0 DO ~SetGlobal("met","GLOBAL",1)~ CONTINUE
`;

// A file containing a CHAIN: its links flatten into derived states that carry no
// sourceRange. They must never be written back - their bytes live inside the preserved
// CHAIN block, so re-emitting them would duplicate the content as standalone states.
const CHAIN_FIXTURE = `BEGIN ~greeter~
IF ~~ THEN BEGIN intro
  SAY ~Hello.~
  IF ~~ THEN REPLY ~Hi.~ EXIT
END
END

CHAIN ~speakerA~ greet_chain
~Line one.~
== ~speakerB~ ~Line two.~
== ~speakerC~ ~Line three.~
EXIT
`;

// ---------------------------------------------------------------------------

describe("applyDialogEdits", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("edit preserves comment, patch block, and other states unchanged", () => {
        const data = parseDDialog(FIXTURE);
        const model = modelFromD(data);

        // Mutate only the 'intro' state: change sayText and add a condition to the first choice.
        const root = model.roots.find((r) => r.kind === "dialog")!;
        const intro = root.states.find((s) => s.id === "intro")!;

        // Deep-clone the state so we can mutate without affecting the original.
        const mutated: DialogState = {
            ...intro,
            text: "Good day, friend.",
            choices: [
                {
                    ...intro.choices[0]!,
                    condition: "InMyParty(Player)",
                },
                { ...intro.choices[1]! },
            ],
        };
        // Replace intro in the root.
        root.states = root.states.map((s) => (s.id === "intro" ? mutated : s));

        const result = applyDialogEdits(FIXTURE, model, modelFromD(data));

        // Edited content appears.
        expect(result).toContain("Good day, friend.");
        expect(result).toContain("InMyParty(Player)");

        // Leading comment is preserved verbatim.
        expect(result).toContain("/* greeting dialog - do not edit manually */");

        // ALTER_TRANS patch block is preserved verbatim.
        expect(result).toContain('ALTER_TRANS ~greeter~ #0 #0 DO ~SetGlobal("met","GLOBAL",1)~ CONTINUE');

        // Untouched state 'details' original text is preserved.
        expect(result).toContain("The item lies to the north.");
    });

    it("edited output re-parses to a model with the new content", () => {
        const data = parseDDialog(FIXTURE);
        const model = modelFromD(data);

        const root = model.roots.find((r) => r.kind === "dialog")!;
        const details = root.states.find((s) => s.id === "details")!;
        const mutated: DialogState = {
            ...details,
            text: "The treasure is buried under the oak tree.",
        };
        root.states = root.states.map((s) => (s.id === "details" ? mutated : s));

        const result = applyDialogEdits(FIXTURE, model, modelFromD(data));

        // Re-parse the spliced output.
        const data2 = parseDDialog(result);
        const model2 = modelFromD(data2);

        const root2 = model2.roots.find((r) => r.kind === "dialog")!;
        const details2 = root2.states.find((s) => s.id === "details")!;

        expect(details2).toBeDefined();
        expect(details2.text).toBe("The treasure is buried under the oak tree.");
    });

    it("delete removes only the deleted state's block; comment and other state remain", () => {
        const data = parseDDialog(FIXTURE);
        const model = modelFromD(data);

        // Remove 'details' from the model.
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.filter((s) => s.id !== "details");

        const result = applyDialogEdits(FIXTURE, model, modelFromD(data));

        // 'details' block is gone.
        expect(result).not.toContain("The item lies to the north.");
        expect(result).not.toContain("BEGIN details");

        // Comment and other state and patch block survive.
        expect(result).toContain("/* greeting dialog - do not edit manually */");
        expect(result).toContain("Hello, traveller.");
        expect(result).toContain('ALTER_TRANS ~greeter~ #0 #0 DO ~SetGlobal("met","GLOBAL",1)~ CONTINUE');
    });

    it("rename: updated id and referencing goto target appear; surrounding text preserved", () => {
        const data = parseDDialog(FIXTURE);
        const model = modelFromD(data);

        const root = model.roots.find((r) => r.kind === "dialog")!;
        // Rename 'details' to 'lore'.
        // Also update the GOTO in 'intro' that references 'details'.
        const intro = root.states.find((s) => s.id === "intro")!;
        const details = root.states.find((s) => s.id === "details")!;

        const updatedIntro: DialogState = {
            ...intro,
            choices: intro.choices.map((c) => {
                if (c.target.kind === "state" && c.target.stateId === "details") {
                    return { ...c, target: { kind: "state" as const, stateId: "lore" } };
                }
                return c;
            }),
        };
        const renamedDetails: DialogState = {
            ...details,
            id: "lore",
        };

        root.states = [updatedIntro, renamedDetails];

        const result = applyDialogEdits(FIXTURE, model, modelFromD(data));

        // New id and the retargeted transition appear. The referencing transition is a
        // conditional reply, so it serializes in short form (`+ lore`), not `GOTO lore`.
        expect(result).toContain("BEGIN lore");
        expect(result).toContain("+ lore");

        // Old id is gone.
        expect(result).not.toContain("BEGIN details");

        // Surrounding text preserved.
        expect(result).toContain("/* greeting dialog - do not edit manually */");
        expect(result).toContain("Hello, traveller.");
        expect(result).toContain('ALTER_TRANS ~greeter~ #0 #0 DO ~SetGlobal("met","GLOBAL",1)~ CONTINUE');
    });

    it("pendingInserts returns states with no sourceRange", () => {
        const data = parseDDialog(FIXTURE);
        const model = modelFromD(data);

        const root = model.roots.find((r) => r.kind === "dialog")!;
        const newState: DialogState = {
            id: "newstate",
            text: "Newly added.",
            choices: [{ id: "newstate#0", target: { kind: "exit" } }],
            // No sourceRange.
        };
        root.states.push(newState);

        const pending = pendingInserts(model);
        expect(pending).toHaveLength(1);
        expect(pending[0]!.id).toBe("newstate");
    });

    it("flags CHAIN links as derived and never re-emits them on save", () => {
        const data = parseDDialog(CHAIN_FIXTURE);
        const model = modelFromD(data);

        // The CHAIN produced derived states, all tagged CHAIN.
        const derived = model.roots.flatMap((r) => r.states).filter((s) => s.derivedFrom);
        expect(derived.length).toBeGreaterThan(0);
        expect(derived.every((s) => s.derivedFrom === "CHAIN")).toBe(true);
        // Derived states are never pending inserts.
        expect(pendingInserts(model)).toHaveLength(0);

        // Saving with no edits must not duplicate the chain. The CHAIN block is preserved
        // verbatim (no state range covers it), so each line appears exactly once - the old
        // insert-fallback would have re-serialized the derived links into standalone blocks.
        const result = applyDialogEdits(CHAIN_FIXTURE, model, modelFromD(data));
        expect(result.match(/Line three\./g)).toHaveLength(1);
        expect(result.match(/CHAIN ~speakerA~ greet_chain/g)).toHaveLength(1);
        expect(result).toContain("CHAIN ~speakerA~ greet_chain");
    });

    it("throws for non-weidu-d format", () => {
        const model = modelFromD(parseDDialog(FIXTURE));
        const bad = { ...model, format: "fallout-ssl" as const };
        expect(() => applyDialogEdits(FIXTURE, bad)).toThrow("applyDialogEdits: only weidu-d models are supported");
    });
});

// ---------------------------------------------------------------------------
// Faithful write-back: a save must not reformat states the user did not change,
// and must preserve @N translation refs and `++` reply shorthand. These guard
// the source-text fidelity that the model-equivalence round-trip tests cannot
// see (every fixture above uses literal ~strings~ and longhand IF/THEN/REPLY).
// ---------------------------------------------------------------------------

// Real corpus forms: `SAY @N` translation refs and `++ reply + label` shorthand.
const SHORTHAND_FIXTURE = `APPEND ~BOTSMITH~
IF ~~ THEN BEGIN g_item_type
  SAY @21
  ++ @3 + g_weapon
  ++ @6 EXIT
END
IF ~~ THEN BEGIN g_weapon
  SAY @99
  ++ @4 EXIT
END
END
`;

describe("applyDialogEdits source-text fidelity", () => {
    beforeAll(async () => {
        await initParser();
    });

    // Guard: the fixture must actually parse into the shorthand/@N construct, or
    // the fidelity tests below would pass vacuously on a degenerate parse.
    it("the fixture parses into @N + shorthand states (guard)", () => {
        const model = modelFromD(parseDDialog(SHORTHAND_FIXTURE));
        const states = model.roots.find((r) => r.kind === "dialog")!.states;
        expect(states.map((s) => s.id)).toEqual(["g_item_type", "g_weapon"]);
        const it0 = states[0]!;
        expect(it0.text).toBe("@21");
        expect(it0.choices[0]!.text).toBe("@3");
        expect(it0.choices[0]!.condition ?? "").toBe("");
        expect(it0.choices[0]!.action ?? null).toBeNull();
        expect(it0.choices[0]!.target).toEqual({ kind: "state", stateId: "g_weapon" });
    });

    it("an identity save (no edits) returns the source byte-for-byte", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const model = modelFromD(data);
        const result = applyDialogEdits(SHORTHAND_FIXTURE, model, modelFromD(data));
        expect(result).toBe(SHORTHAND_FIXTURE);
    });

    it("editing one state leaves every other state's bytes identical", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const original = modelFromD(data);
        const model = modelFromD(data);

        // Edit only g_weapon's NPC line; g_item_type is untouched.
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) => (s.id === "g_weapon" ? { ...s, text: "@999" } : s));

        const result = applyDialogEdits(SHORTHAND_FIXTURE, model, original);

        // The untouched g_item_type block keeps its exact original bytes - @21 ref
        // and ++ shorthand intact, not rewritten to ~@21~ / longhand.
        expect(result).toContain("  SAY @21\n  ++ @3 + g_weapon\n  ++ @6 EXIT");
        expect(result).not.toContain("SAY ~@21~");
    });

    it("re-serializing an edited @N state keeps `SAY @N`, not `SAY ~@N~`", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const original = modelFromD(data);
        const model = modelFromD(data);

        // Change the @N state's trigger, forcing that state to re-serialize. Its SAY
        // line (which the user did not touch) must keep its @N translation ref.
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) =>
            s.id === "g_item_type" ? { ...s, trigger: 'Global("x","GLOBAL",1)' } : s,
        );

        const result = applyDialogEdits(SHORTHAND_FIXTURE, model, original);
        expect(result).toContain('IF ~Global("x","GLOBAL",1)~ THEN BEGIN g_item_type');
        expect(result).toContain("SAY @21");
        expect(result).not.toContain("SAY ~@21~");
    });

    it("re-serializing an edited state keeps `++ reply + label` shorthand and `REPLY @N`", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const original = modelFromD(data);
        const model = modelFromD(data);

        // Edit the @N state's trigger; its (untouched) replies must re-serialize as the
        // corpus `++ reply + label` / `++ reply EXIT` shorthand, not verbose IF/THEN/REPLY.
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) => (s.id === "g_item_type" ? { ...s, trigger: "True()" } : s));

        const result = applyDialogEdits(SHORTHAND_FIXTURE, model, original);
        expect(result).toContain("++ @3 + g_weapon");
        expect(result).toContain("++ @6 EXIT");
        expect(result).not.toContain("REPLY ~@3~");
        expect(result).not.toContain("REPLY ~@6~");
    });

    it("a SAY-only edit splices just the SAY value, leaving the rest of the state byte-identical", () => {
        // Original uses 0-indent IF and 2-space body; a whole-state re-serialize would
        // reflow that indentation. Per-field splice must touch only `@1` -> `@99`.
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  ++ @2 + s
END
END
`;
        const data = parseDDialog(FIX);
        const original = modelFromD(data);
        const model = modelFromD(data);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) => (s.id === "s" ? { ...s, text: "@99" } : s));
        const out = applyDialogEdits(FIX, model, original);
        expect(out).toBe(FIX.replace("SAY @1", "SAY @99"));
    });

    it("a trigger edit splices just the trigger span (adding a trigger to an empty ~~)", () => {
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  ++ @2 + s
END
END
`;
        const data = parseDDialog(FIX);
        const original = modelFromD(data);
        const model = modelFromD(data);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) => (s.id === "s" ? { ...s, trigger: "Foo()" } : s));
        const out = applyDialogEdits(FIX, model, original);
        expect(out).toBe(FIX.replace("IF ~~ THEN", "IF ~Foo()~ THEN"));
    });

    it("a single-transition edit splices just that transition, leaving siblings byte-identical", () => {
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  ++ @2 + s
  ++ @3 EXIT
END
END
`;
        const data = parseDDialog(FIX);
        const original = modelFromD(data);
        const model = modelFromD(data);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) =>
            s.id === "s" ? { ...s, choices: s.choices.map((c, i) => (i === 0 ? { ...c, text: "@88" } : c)) } : s,
        );
        const out = applyDialogEdits(FIX, model, original);
        expect(out).toBe(FIX.replace("++ @2 + s", "++ @88 + s"));
    });

    it("a structural change (added transition) falls back to whole-state and keeps every field", () => {
        // Add a transition AND change SAY: a partial field-splice that ignored the count
        // change would drop the new transition. The count guard must force a whole-state
        // re-serialize so both survive and the result re-parses equivalently.
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  ++ @2 EXIT
END
END
`;
        const data = parseDDialog(FIX);
        const original = modelFromD(data);
        const model = modelFromD(data);
        const root = model.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) =>
            s.id === "s"
                ? {
                      ...s,
                      text: "@99",
                      choices: [...s.choices, { id: "s#1", text: "@5", target: { kind: "exit" as const } }],
                  }
                : s,
        );
        const out = applyDialogEdits(FIX, model, original);
        const s2 = modelFromD(parseDDialog(out))
            .roots.find((r) => r.kind === "dialog")!
            .states.find((st) => st.id === "s")!;
        expect(s2.choices).toHaveLength(2);
        expect(s2.text).toBe("@99");
        expect(s2.choices[1]!.text).toBe("@5");
    });

    it("exposes per-field source ranges on a parsed state (say + each transition)", () => {
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  ++ @2 + s
  ++ @3 EXIT
END
END
`;
        const data = parseDDialog(FIX);
        const st = data.states[0]!;
        expect(st.sayRange).toBeDefined();
        expect(FIX.slice(st.sayRange!.start, st.sayRange!.end)).toBe("@1");
        expect(FIX.slice(st.transitions[0]!.range!.start, st.transitions[0]!.range!.end)).toBe("++ @2 + s");
        expect(FIX.slice(st.transitions[1]!.range!.start, st.transitions[1]!.range!.end)).toBe("++ @3 EXIT");

        // The IR carries the field ranges through the adapter.
        const istate = modelFromD(data).roots.find((r) => r.kind === "dialog")!.states[0]!;
        expect(FIX.slice(istate.sayRange!.start, istate.sayRange!.end)).toBe("@1");
        expect(FIX.slice(istate.choices[0]!.sourceRange!.start, istate.choices[0]!.sourceRange!.end)).toBe("++ @2 + s");
    });

    it("verifyDialogEditApplied: ok when the saved text re-parses to the edited model", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const original = modelFromD(data);
        const edited = modelFromD(data);
        const root = edited.roots.find((r) => r.kind === "dialog")!;
        root.states = root.states.map((s) => (s.id === "g_item_type" ? { ...s, text: "@77" } : s));
        const out = applyDialogEdits(SHORTHAND_FIXTURE, edited, original);
        const actual = modelFromD(parseDDialog(out));
        expect(verifyDialogEditApplied(edited, actual).ok).toBe(true);
    });

    it("verifyDialogEditApplied: flags a state whose saved bytes diverge from the edited model", () => {
        const data = parseDDialog(SHORTHAND_FIXTURE);
        const edited = modelFromD(data);
        // Simulate a serializer regression: the re-parsed `actual` disagrees with `edited`.
        const actual = modelFromD(data);
        const aroot = actual.roots.find((r) => r.kind === "dialog")!;
        aroot.states = aroot.states.map((s) => (s.id === "g_item_type" ? { ...s, text: "WRONG" } : s));
        const res = verifyDialogEditApplied(edited, actual);
        expect(res.ok).toBe(false);
        expect(res.reason).toContain("g_item_type");
    });

    it("parses the trigger of a conditional short-form reply (+ ~cond~ + reply)", () => {
        const FIX = `APPEND ~X~
IF ~~ THEN BEGIN s
  SAY @1
  + ~Global("g","GLOBAL",1)~ + @2 + s
END
END
`;
        const model = modelFromD(parseDDialog(FIX));
        const choice = model.roots.find((r) => r.kind === "dialog")!.states[0]!.choices[0]!;
        expect(choice.condition).toBe('Global("g","GLOBAL",1)');
        expect(choice.text).toBe("@2");
        expect(choice.target).toEqual({ kind: "state", stateId: "s" });
    });
});
