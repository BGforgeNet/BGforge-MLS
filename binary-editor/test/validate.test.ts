import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { buildModel } from "../src/model";
import { validate } from "../src/validate";
import { ieEffectsModel } from "../src/relationship/ie-effects";
import type { ParseResult } from "@bgforge/binary";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function openSessionForFixture() {
    const { sessionId } = openSession("file:///arcaves.map", new Uint8Array(fs.readFileSync(MAP_FIXTURE)));
    const session = sessionStore.get(sessionId);
    expect(session).toBeDefined();
    return session;
}

/** Build an EditorSession for a fabricated EFF parse result. The Effect 1 group
 *  includes all five fields the constraint rule requires: opcode, parameter1,
 *  parameter2, probability1, probability2. */
function effectSessionWithProbs(prob1: number, prob2: number): EditorSession {
    const result = {
        format: "eff",
        formatName: "EFF",
        root: {
            name: "EFF File",
            fields: [
                {
                    name: "Effect 1",
                    fields: [
                        {
                            name: "opcode",
                            value: 0,
                            rawValue: 0,
                            offset: 0,
                            size: 4,
                            type: "enum",
                            enumOptions: { "0": "op 0" },
                        },
                        { name: "parameter1", value: 5, offset: 8, size: 4, type: "uint32" },
                        { name: "parameter2", value: 2, offset: 12, size: 4, type: "uint32" },
                        { name: "probability1", value: prob1, offset: 16, size: 2, type: "uint16" },
                        { name: "probability2", value: prob2, offset: 18, size: 2, type: "uint16" },
                    ],
                },
            ],
        },
    } as unknown as ParseResult;
    return {
        id: "sv1",
        uri: "file:///x.eff",
        parserId: "eff",
        parseOptions: {},
        model: buildModel(result),
        undo: [],
        redo: [],
        dirty: false,
        relationshipModel: ieEffectsModel,
    };
}

describe("validate", () => {
    it("returns no diagnostics for a clean map", () => {
        const session = openSessionForFixture();
        if (!session) return;
        expect(validate(session)).toEqual([]);
    });

    it("never throws", () => {
        const session = openSessionForFixture();
        if (!session) return;
        expect(() => validate(session)).not.toThrow();
    });
});

describe("validate - relationship constraints", () => {
    it("surfaces relationship constraints with real node ids when prob1 < prob2", () => {
        // prob1=10 < prob2=40 => empty range, constraint fires
        const session = effectSessionWithProbs(10, 40);
        const diags = validate(session);
        const d = diags.find((x) => x.nodeId !== "" && x.severity === "warning");
        expect(d).toBeDefined();
        expect(d?.quickFix).toBeDefined();
    });

    it("returns no per-field constraint diagnostics for a valid effect (prob1 >= prob2)", () => {
        // prob1=100 >= prob2=0 => valid range, no constraint fires
        const session = effectSessionWithProbs(100, 0);
        const diags = validate(session);
        // No constraint diagnostic should carry a real (non-empty) nodeId from relationship rules.
        // The snapshot pass on a fabricated EFF tree may or may not throw; we assert only that
        // no per-field constraint diagnostic is present.
        expect(diags.every((x) => x.nodeId === "")).toBe(true);
    });
});
