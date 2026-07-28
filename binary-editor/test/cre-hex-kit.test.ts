/**
 * CRE `kit` is a packed KIT.IDS dword (the bits encode class/kit), so it must render in hex, not as a
 * meaningless decimal. Drives the REAL parse + projection on a vendored Conjurer fixture and asserts the
 * projected Kit row carries `numericFormat: "hex32"` - the property the dropdown/summary read to hex-prefix
 * its value. Without this the field showed "8388608 MAGESCHOOL_CONJURER".
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { projectRow } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { enumSelectedLabel, enumHexDigits } from "../../shared/enum-label";
import type { Model, FlatNode } from "../src/model";

// Edwin is a Conjurer (kit dword 0x00800000); a vendored modify-time CRE.
const CRE_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");

function fixturePresent(): boolean {
    return fs.existsSync(CRE_FIXTURE);
}

/** Project a header field row by its display label through the real parse + projection. */
function projectHeaderField(model: Model, fieldName: string) {
    const node: FlatNode | undefined = model.nodes.find((n) => n.kind === "field" && n.name === fieldName);
    if (!node) throw new Error(`no ${fieldName} field in CRE header`);
    return projectRow(model, node, getRelationshipModel("cre"));
}

/** The label the closed dropdown / summary shows, built the same way the consumers build it. */
function consumerLabel(row: {
    rawValue?: number | string;
    enumOptions?: Readonly<Record<string, string>>;
    numericFormat?: string;
    size?: number;
}): string {
    return enumSelectedLabel(row.rawValue as number, row.enumOptions, enumHexDigits(row.numericFormat, row.size));
}

describe("CRE packed-bitfield hex display", () => {
    it("projects Kit so its value reads '0x00800000 MAGESCHOOL_CONJURER', not a bare 8388608", () => {
        if (!fixturePresent()) return;
        const bytes = new Uint8Array(fs.readFileSync(CRE_FIXTURE));
        const { sessionId } = openSession("file:///edwin6.cre", bytes);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error("CRE session did not open");

        const row = projectHeaderField(session.model, "Kit");
        expect(row.valueType).toBe("enum");
        expect(row.rawValue).toBe(0x00800000);
        // The model fact that drives hex prefixing everywhere the consumer renders the field.
        expect(row.numericFormat).toBe("hex32");
        expect(row.size).toBe(4); // dword -> 8 hex digits
        expect(consumerLabel(row)).toBe("0x00800000 MAGESCHOOL_CONJURER");
    });

    it("projects Alignment (a byte) at its own width: '0x13 LAWFUL_EVIL', not '19' or '0x00000013'", () => {
        if (!fixturePresent()) return;
        const bytes = new Uint8Array(fs.readFileSync(CRE_FIXTURE));
        const { sessionId } = openSession("file:///edwin6-align.cre", bytes);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error("CRE session did not open");

        const row = projectHeaderField(session.model, "Alignment");
        expect(row.valueType).toBe("enum");
        expect(row.rawValue).toBe(0x13);
        expect(row.numericFormat).toBe("hex32");
        expect(row.size).toBe(1); // byte -> 2 hex digits, not 8
        expect(consumerLabel(row)).toBe("0x13 LAWFUL_EVIL");
    });
});
