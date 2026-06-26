import { beforeAll, describe, expect, it } from "vitest";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { parseDialog as parseSSL } from "../src/dialog";
import { modelFromD, modelFromSSL, resolveText } from "../../shared/dialog-model";

describe("DialogModel adapters (real producer -> IR)", () => {
    beforeAll(async () => {
        await initWeiduD();
    });

    it("maps a real WeiDU D parse: goto -> state, exit, and %var% extern -> unresolved external", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN hello
  SAY ~Hi there.~
  IF ~~ THEN REPLY ~more~ GOTO next
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN next
  SAY ~More.~
  IF ~~ THEN REPLY ~leave~ EXTERN ~%OTHER%~ 0
END
`;
        const model = modelFromD(parseDDialog(d));
        expect(model.format).toBe("weidu-d");
        expect(model.editable).toBe(true);

        const dialog = model.roots.find((r) => r.kind === "dialog")!;
        const hello = dialog.states.find((s) => s.id === "hello")!;
        expect(hello.choices[0]!.target).toEqual({ kind: "state", stateId: "next" });
        expect(hello.choices[1]!.target).toEqual({ kind: "exit" });

        const next = dialog.states.find((s) => s.id === "next")!;
        expect(next.choices[0]!.target.kind).toBe("external");
        const ext = next.choices[0]!.target as { kind: "external"; label: string; resolved: boolean };
        expect(ext.resolved).toBe(false);
        expect(ext.label).toContain("%OTHER%");
    });

    it("maps a real SSL parse: option -> state with reaction, conditional carried, message -> exit", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    if (global_var(GVAR_X) == 1) then NOption(101, Node002, 4);
end
procedure Node002 begin
    Reply(200);
    NMessage(201);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const model = modelFromSSL(await parseSSL(ssl));
        expect(model.format).toBe("fallout-ssl");
        expect(model.editable).toBe(false);

        const states = model.roots[0]!.states;
        const n1 = states.find((s) => s.id === "Node001")!;
        expect(n1.text).toBe("@100");
        expect(n1.choices[0]).toMatchObject({
            text: "@101",
            target: { kind: "state", stateId: "Node002" },
            reaction: "neutral",
            skill: 4,
        });
        expect(n1.choices[0]!.condition).toContain("GVAR_X");

        const n2 = states.find((s) => s.id === "Node002")!;
        // NMessage(201) is a terminal message -> exit.
        expect(n2.choices.some((c) => c.target.kind === "exit")).toBe(true);
    });

    it("resolves SSL numeric msgIds to their .msg text via the shared @N ref the renderer reads", async () => {
        // A node's reply/option text is a .msg line id; the renderer resolves it with the
        // same resolveText(@N) path D uses. The adapter must emit a resolvable ref, not a
        // bare number (which rendered as a raw "100"). Computed/expression ids stay literal.
        const ssl = `
procedure Node001 begin
    Reply(100);
    NOption(101, Node002, 4);
    NOption(some_var, Node002, 4);
end
procedure Node002 begin
    NMessage(200);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const model = modelFromSSL(await parseSSL(ssl));
        const messages = { "100": "Hello there.", "101": "Goodbye.", "200": "The end." };
        const n1 = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(resolveText(n1.text, messages)).toBe("Hello there.");
        expect(resolveText(n1.choices[0]!.text, messages)).toBe("Goodbye.");
        // A computed id has no numeric .msg line - it stays as the expression text.
        expect(resolveText(n1.choices[1]!.text, messages)).toBe("some_var");
    });

    it("flattens CHAIN bodies and groups same-file chains under one root", () => {
        const d = `CHAIN IF WEIGHT #-1 ~InParty("jaheira")~ THEN ~%KAGAIN_BANTER%~ KAJA2
@122
== ~%JAHEIRA_BANTER%~ @123
== ~%KAGAIN_BANTER%~ @124
EXIT

CHAIN IF WEIGHT #-1 ~InParty("khalid")~ THEN ~%KAGAIN_BANTER%~ KAKH1
@129
== ~%KHALID_BANTER%~ @130
EXIT
`;
        const model = modelFromD(parseDDialog(d));

        // Both chains target %KAGAIN_BANTER%, so they share one dialog root (not two islands).
        const dialogRoots = model.roots.filter((r) => r.kind === "dialog");
        expect(dialogRoots).toHaveLength(1);
        expect(dialogRoots[0]!.label).toBe("%KAGAIN_BANTER%");

        const states = dialogRoots[0]!.states;
        // Chain bodies are fully flattened: 3 states (KAJA2 chain) + 2 (KAKH1 chain).
        expect(states.map((s) => s.id)).toEqual(["KAJA2", "KAJA2_1", "KAJA2_2", "KAKH1", "KAKH1_1"]);

        // Each `==` line is its own state with the switched speaker, linked sequentially.
        const entry = states.find((s) => s.id === "KAJA2")!;
        expect(entry.text).toBe("@122");
        expect(entry.choices[0]!.target).toEqual({ kind: "state", stateId: "KAJA2_1" });
        const second = states.find((s) => s.id === "KAJA2_1")!;
        expect(second.speaker).toBe("%JAHEIRA_BANTER%");
        expect(second.text).toBe("@123");
    });

    it("carries a state's WEIGHT (including negative) into the model", () => {
        const d = `APPEND ~coranj~
IF WEIGHT #-2 ~~ THEN BEGIN heavy SAY ~Hi.~ IF ~~ THEN EXIT END
IF WEIGHT #5 ~~ THEN BEGIN light SAY ~Ho.~ IF ~~ THEN EXIT END
IF ~~ THEN BEGIN plain SAY ~Hum.~ IF ~~ THEN EXIT END
END
`;
        const model = modelFromD(parseDDialog(d));
        const states = model.roots[0]!.states;
        expect(states.find((s) => s.id === "heavy")!.weight).toBe(-2);
        expect(states.find((s) => s.id === "light")!.weight).toBe(5);
        expect(states.find((s) => s.id === "plain")!.weight).toBeUndefined();
    });

    it("groups APPEND states by their target file, not all under the first block", () => {
        // A single .d that appends to two different dialogs must yield one dialog root
        // per file, not one lump under the first APPEND (the multi-file grouping bug).
        const d = `APPEND ~coranj~
IF ~~ THEN BEGIN c_hello SAY ~Hi.~ IF ~~ THEN GOTO c_more END
IF ~~ THEN BEGIN c_more SAY ~More.~ IF ~~ THEN EXIT END
END

APPEND ~brielb~
IF ~~ THEN BEGIN b_hello SAY ~Greetings.~ IF ~~ THEN EXIT END
END
`;
        const model = modelFromD(parseDDialog(d));
        const dialogRoots = model.roots.filter((r) => r.kind === "dialog");
        expect(dialogRoots.map((r) => r.label).sort()).toEqual(["brielb", "coranj"]);

        const coranj = dialogRoots.find((r) => r.label === "coranj")!;
        expect(coranj.states.map((s) => s.id)).toEqual(["c_hello", "c_more"]);
        const brielb = dialogRoots.find((r) => r.label === "brielb")!;
        expect(brielb.states.map((s) => s.id)).toEqual(["b_hello"]);
    });
});
