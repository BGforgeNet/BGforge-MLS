/**
 * TD patch operation tests (td/src/patch-operations.ts): the top-level calls
 * that emit WeiDU D patch keywords (ALTER_TRANS, ADD_STATE_TRIGGER, etc.)
 * rather than a dialog state.
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

describe("alterTrans()", () => {
    it("emits ALTER_TRANS with the changed fields", async () => {
        const out = await emit(
            'alterTrans("wsmith01", [32], [0], {\n  trigger: False(),\n  action: Continue(),\n});\n',
        );
        expect(out).toContain(
            'ALTER_TRANS wsmith01\nBEGIN 32 END\nBEGIN 0 END\nBEGIN\n  "TRIGGER" ~False()~\n  "ACTION" ~Continue()~\nEND',
        );
    });

    it("trigger: false clears the trigger", async () => {
        const out = await emit('alterTrans("wsmith01", [32], [0], {\n  trigger: false,\n});\n');
        expect(out).toContain('"TRIGGER" ~~');
    });

    it("rejects fewer than 4 arguments", async () => {
        await expect(emit('alterTrans("wsmith01", [32], [0]);\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("alterTrans() requires 4 arguments"),
        });
    });
});

describe("addStateTrigger()", () => {
    it("emits ADD_STATE_TRIGGER for a single state", async () => {
        const out = await emit('addStateTrigger("BJALVAR", "state1", Global("newCondition","GLOBAL",1));\n');
        expect(out).toContain('ADD_STATE_TRIGGER BJALVAR state1 ~Global("newCondition","GLOBAL",1)~');
    });

    it("accepts an array of states", async () => {
        const out = await emit('addStateTrigger("BJALVAR", ["state1", "state2"], Global("cond","GLOBAL",1));\n');
        expect(out).toContain("BJALVAR state1 state2 ~");
    });
});

describe("addTransTrigger()", () => {
    it("emits ADD_TRANS_TRIGGER with a trans list from the options object", async () => {
        const out = await emit(
            'addTransTrigger("BJALVAR", ["state1"], !Global("blocked","GLOBAL",1), { trans: [0, 1, 2] });\n',
        );
        expect(out).toContain('ADD_TRANS_TRIGGER BJALVAR state1 ~!Global("blocked","GLOBAL",1)~ DO 0 1 2');
    });

    it("rejects fewer than 3 arguments", async () => {
        await expect(emit('addTransTrigger("BJALVAR", ["state1"]);\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("addTransTrigger() requires at least 3 arguments"),
        });
    });
});

describe("addTransAction()", () => {
    it("emits ADD_TRANS_ACTION with the states/transitions/action blocks", async () => {
        const out = await emit('addTransAction("BJALVAR", ["state1"], [0, 1], SetGlobal("acted","GLOBAL",1));\n');
        expect(out).toContain(
            'ADD_TRANS_ACTION BJALVAR BEGIN state1 END BEGIN 0 1 END ~SetGlobal("acted","GLOBAL",1)~',
        );
    });
});

describe("replaceTransTrigger() / replaceTransAction()", () => {
    it("replaceTransTrigger emits REPLACE_TRANS_TRIGGER with old/new text", async () => {
        const out = await emit(
            'replaceTransTrigger("wsmith01", ["g_2things"], [], "PartyGoldGT(7499)", "PartyGoldGT(12499)");\n',
        );
        expect(out).toContain(
            "REPLACE_TRANS_TRIGGER wsmith01 BEGIN g_2things END BEGIN  END ~PartyGoldGT(7499)~ ~PartyGoldGT(12499)~",
        );
    });

    it("replaceTransAction emits REPLACE_TRANS_ACTION", async () => {
        const out = await emit(
            'replaceTransAction("wsmith01", ["g_2things"], [], "TakePartyGold(7500)", "TakePartyGold(12500)");\n',
        );
        expect(out).toContain("REPLACE_TRANS_ACTION wsmith01");
    });

    it("rejects fewer than 5 arguments", async () => {
        await expect(emit('replaceTransTrigger("wsmith01", ["g_2things"], []);\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("replaceTransTrigger() requires at least 5 arguments"),
        });
    });
});

describe("replaceTriggerText() / replaceActionText()", () => {
    it("replaceTriggerText emits REPLACE_TRIGGER_TEXT for a single filename", async () => {
        const out = await emit('replaceTriggerText("BJALVAR", "OldTrigger", "NewTrigger");\n');
        expect(out).toContain("REPLACE_TRIGGER_TEXT BJALVAR ~OldTrigger~ ~NewTrigger~");
    });

    it("replaceActionText accepts an array of filenames", async () => {
        const out = await emit(
            'replaceActionText(["player1", "player2"], "ReputationInc(-1)", "ReputationInc(-2)");\n',
        );
        expect(out).toContain("REPLACE_ACTION_TEXT player1 player2 ~ReputationInc(-1)~ ~ReputationInc(-2)~");
    });

    it("rejects a first argument that is neither a string nor an array", async () => {
        await expect(emit('replaceTriggerText(42, "a", "b");\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("replaceTriggerText() first argument must be a string or array"),
        });
    });
});

describe("setWeight()", () => {
    it("emits SET_WEIGHT with a #-prefixed weight", async () => {
        const out = await emit('setWeight("BJALVAR", "state1", 5);\n');
        expect(out).toContain("SET_WEIGHT BJALVAR state1 #5");
    });
});

describe("replaceSay()", () => {
    it("emits REPLACE_SAY with the resolved text value", async () => {
        const out = await emit('replaceSay("BJALVAR", "state1", tra(999));\n');
        expect(out).toContain("REPLACE_SAY BJALVAR state1 @999");
    });
});

describe("replaceStateTrigger()", () => {
    it("emits REPLACE_STATE_TRIGGER with the first state inline and the rest as a list", async () => {
        const out = await emit('replaceStateTrigger("BJALVAR", [1, 2, 3], Global("newTrigger","GLOBAL",1));\n');
        expect(out).toContain('REPLACE_STATE_TRIGGER BJALVAR 1 ~Global("newTrigger","GLOBAL",1)~ 2 3');
    });
});

describe("replace()", () => {
    it("emits an APPEND block replacing states by numeric index", async () => {
        const out = await emit(
            'replace("MYDLG", {\n  0: function replacement0() {\n    say(tra(60));\n    exit();\n  },\n});\n',
        );
        expect(out).toContain("// REPLACE states in MYDLG - manually verify WeiDU syntax");
        expect(out).toContain("APPEND MYDLG");
    });

    it("rejects a non-function state value", async () => {
        await expect(emit('replace("MYDLG", {\n  0: "not a function",\n});\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("replace() state 0 must be a function"),
        });
    });

    it("rejects fewer than 2 arguments", async () => {
        await expect(emit('replace("MYDLG");\n')).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringContaining("replace() requires 2 arguments"),
        });
    });
});
