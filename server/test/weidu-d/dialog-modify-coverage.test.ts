/**
 * Branch-coverage tests for weidu-d/dialog-modify.ts.
 *
 * The base dialog.test.ts covers ALTER_TRANS, REPLACE_ACTION_TEXT,
 * REPLACE_TRANS_TRIGGER, REPLACE_TRANS_ACTION, and REPLACE_STATE_TRIGGER.
 * This file adds the remaining modify-action variants (ADD_STATE_TRIGGER,
 * ADD_TRANS_ACTION, ADD_TRANS_TRIGGER, REPLACE_SAY, SET_WEIGHT,
 * REPLACE_TRIGGER_TEXT) plus empty/missing-description fallbacks.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { parseDDialog } from "../../src/weidu-d/dialog";
import { initParser } from "../../../shared/parsers/weidu-d";

beforeAll(async () => {
    await initParser();
});

describe("dialog-modify: ADD_STATE_TRIGGER", () => {
    it("parses ADD_STATE_TRIGGER as modify block with state ref and trigger", () => {
        const text = `ADD_STATE_TRIGGER finsol01 4 ~Global("foo","GLOBAL",1)~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("ADD_STATE_TRIGGER");
        expect(block.file).toBe("finsol01");
        expect(block.stateRefs).toContain("4");
        expect(block.description).toContain("Global");
    });

    it("ADD_STATE_TRIGGER with empty trigger -> undefined description", () => {
        const text = `ADD_STATE_TRIGGER finsol01 4 ~~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.actionName).toBe("ADD_STATE_TRIGGER");
        // Empty trigger collapses to undefined via `truncate(...) || undefined`
        expect(block.description).toBeUndefined();
    });
});

describe("dialog-modify: ADD_TRANS_ACTION", () => {
    it("parses ADD_TRANS_ACTION with state refs and action body", () => {
        const text = `
ADD_TRANS_ACTION wsmith01
BEGIN 32 END
BEGIN 0 END
~SetGlobal("foo","GLOBAL",1)~
`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("ADD_TRANS_ACTION");
        expect(block.file).toBe("wsmith01");
        expect(block.stateRefs).toContain("32");
        expect(block.description).toContain("SetGlobal");
    });
});

describe("dialog-modify: ADD_TRANS_TRIGGER", () => {
    it("parses ADD_TRANS_TRIGGER with state ref and trigger", () => {
        const text = `ADD_TRANS_TRIGGER wsmith01 5 ~Global("foo","GLOBAL",1)~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("ADD_TRANS_TRIGGER");
        expect(block.file).toBe("wsmith01");
        expect(block.stateRefs).toContain("5");
        expect(block.description).toContain("Global");
    });
});

describe("dialog-modify: REPLACE_SAY", () => {
    it("parses REPLACE_SAY with state ref and text", () => {
        const text = `REPLACE_SAY wsmith01 4 ~Replacement text here~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("REPLACE_SAY");
        expect(block.file).toBe("wsmith01");
        expect(block.stateRefs).toContain("4");
        expect(block.description).toContain("Replacement text");
    });

    it("REPLACE_SAY with TRA reference text", () => {
        const text = `REPLACE_SAY wsmith01 4 @123`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.actionName).toBe("REPLACE_SAY");
        expect(block.description).toBe("@123");
    });

    it("REPLACE_SAY with empty text -> undefined description", () => {
        const text = `REPLACE_SAY wsmith01 4 ~~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        expect(result.blocks[0]!.description).toBeUndefined();
    });
});

describe("dialog-modify: SET_WEIGHT", () => {
    it("parses SET_WEIGHT as modify block with state ref and weight", () => {
        // SET_WEIGHT grammar requires a `#`-prefixed weight value (see grammar.js _weight_value).
        const text = `SET_WEIGHT wsmith01 4 #100`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("SET_WEIGHT");
        expect(block.file).toBe("wsmith01");
        expect(block.stateRefs).toContain("4");
        expect(block.description).toContain("100");
    });
});

describe("dialog-modify: REPLACE_TRIGGER_TEXT", () => {
    it("parses REPLACE_TRIGGER_TEXT with old/new text", () => {
        const text = `REPLACE_TRIGGER_TEXT wsmith01 ~OldTrigger()~ ~NewTrigger()~`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.kind).toBe("modify");
        expect(block.actionName).toBe("REPLACE_TRIGGER_TEXT");
        expect(block.file).toBe("wsmith01");
        expect(block.description).toContain("OldTrigger");
        expect(block.description).toContain("NewTrigger");
    });
});

describe("dialog-modify: ALTER_TRANS with empty changes", () => {
    it("ALTER_TRANS with empty changes block produces empty description", () => {
        // Empty changes block -> extractAlterTransParts returns "" -> description is undefined
        const text = `
ALTER_TRANS wsmith01
BEGIN 0 END
BEGIN 0 END
BEGIN
END
`;
        const result = parseDDialog(text);

        expect(result.blocks).toHaveLength(1);
        const block = result.blocks[0]!;
        expect(block.actionName).toBe("ALTER_TRANS");
        // changes || undefined -> undefined
        expect(block.description).toBeUndefined();
    });
});
