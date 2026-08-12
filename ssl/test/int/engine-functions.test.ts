/**
 * Unit tests for the opcode tables and the source-name lookup built on them.
 *
 * The differential in `emit.test.ts` already pins a couple of opcodes against real compiled output,
 * which is what validates the tables' base offsets. These tests cover the properties that differential
 * cannot reach: the per-game slot sharing, and that the tables did not silently shrink.
 */

import { describe, expect, it } from "vitest";
import { ENGINE_FUNCTIONS, engineFunction } from "../../src/int/engine-functions.ts";
import { EngineOp, LibOp, OPCODE_LIMIT, engineOpcodeName } from "../../src/int/opcodes-engine.ts";
import { Op, opcodeName } from "../../src/int/opcodes.ts";

describe("opcode tables", () => {
    it("chains core, library and engine ranges without a gap", () => {
        // Core ends where library begins, library ends where engine begins. A miscount anywhere would
        // shift every later opcode, so the boundaries are asserted rather than assumed.
        expect(Op.NOOP).toBe(0x8000);
        expect(Op.ENDCRITICAL).toBe(0x804b);
        expect(LibOp.SAYQUIT).toBe(0x804c);
        expect(EngineOp.GIVE_EXP_POINTS).toBe(LibOp.SAYQUIT + 85);
        expect(OPCODE_LIMIT).toBe(EngineOp.GIVE_EXP_POINTS + 481);
    });

    it("names an opcode in whichever range it falls", () => {
        expect(opcodeName(Op.CRITICAL_START)).toBe("CRITICAL_START");
        expect(opcodeName(EngineOp.DISPLAY_MSG)).toBeUndefined();
        expect(engineOpcodeName(EngineOp.DISPLAY_MSG)).toBe("DISPLAY_MSG");
        expect(engineOpcodeName(Op.CRITICAL_START)).toBeUndefined();
    });

    it("gives the same slot a different name on Fallout 1", () => {
        // The two games share the numbering exactly; only seven slots hold a different function.
        expect(engineOpcodeName(EngineOp.MARK_AREA_KNOWN, 2)).toBe("MARK_AREA_KNOWN");
        expect(engineOpcodeName(EngineOp.MARK_AREA_KNOWN, 1)).toBe("REACTION");
        // A slot both games agree on reads the same either way.
        expect(engineOpcodeName(EngineOp.DISPLAY_MSG, 1)).toBe("DISPLAY_MSG");
    });
});

describe("engine function lookup", () => {
    it("resolves a source spelling to its opcode", () => {
        expect(engineFunction("display_msg")?.opcode).toBe(EngineOp.DISPLAY_MSG);
        expect(engineFunction("random")?.opcode).toBe(EngineOp.RANDOM);
    });

    it("marks the statement forms that discard a returned value", () => {
        const popping = Object.values(ENGINE_FUNCTIONS).filter((fn) => fn.popsResult);
        expect(popping.length).toBe(16);
    });

    it("keeps Fallout 1 spellings out of a Fallout 2 compile", () => {
        // Accepting `reaction` when targeting Fallout 2 would silently emit mark_area_known, since the
        // two share an opcode number - the exact failure the per-game split exists to prevent.
        expect(engineFunction("reaction", 2)).toBeUndefined();
        expect(engineFunction("reaction", 1)?.opcode).toBe(EngineOp.MARK_AREA_KNOWN);
    });

    it("covers the full engine vocabulary", () => {
        // A collapse here would let the lookup tests above pass while most functions were unreachable.
        expect(Object.keys(ENGINE_FUNCTIONS).length).toBe(530);
    });
});
