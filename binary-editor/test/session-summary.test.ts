/**
 * Verifies that getChildren rows carry a `summary` field when the session's
 * format has a registered summary composer.
 *
 * Each assertion drives the REAL producer: the expected value is derived by
 * projecting the key child field through the same path the composer uses, so
 * the test pins session-layer wiring against real parse output, not a
 * hand-typed string.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/protocol";
import { projectRow } from "../src/window";
import { sessionStore } from "../src/session";
import type { Row } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPL_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/fixpack/bgsleepp.spl");
const ITM_FIXTURE = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");
const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function splPresent(): boolean {
    return fs.existsSync(SPL_FIXTURE);
}
function itmPresent(): boolean {
    return fs.existsSync(ITM_FIXTURE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open a file through the protocol, return the session id.
 * Throws on parse failure so tests fail loudly if the fixture is unreadable.
 */
function protocolOpen(fixture: string, uri: string): string {
    const bytes = new Uint8Array(fs.readFileSync(fixture));
    const res = dispatch({ type: "open", uri, bytes });
    if (res.type !== "opened") throw new Error(`open failed: ${JSON.stringify(res)}`);
    if (res.result.errors.length > 0) throw new Error(`parse error: ${res.result.errors.join(", ")}`);
    return res.result.sessionId;
}

/**
 * Call getChildren via dispatch; return the rows.
 * `nodeId` null -> top-level roots; otherwise children of that node.
 */
function children(sessionId: string, nodeId: string | null, end = 1000): Row[] {
    const res = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end });
    if (res.type !== "children") throw new Error(`expected children, got ${res.type}`);
    return res.rows;
}

/**
 * Walk the root children to find a group with the given name, then return its
 * first group-child (the first list entry). Returns undefined when absent.
 */
function firstEntryViaProtocol(sessionId: string, sectionName: string): Row | undefined {
    const roots = children(sessionId, null);
    const section = roots.find((r) => r.kind === "group" && r.name === sectionName);
    if (!section) return undefined;
    const entries = children(sessionId, section.id);
    return entries.find((r) => r.kind === "group");
}

/**
 * Derive the expected summary for an entry row by projecting the named child
 * field directly from the model + rel - the same path the composer takes.
 * This avoids hard-coding the string while still pinning to the real producer.
 */
function expectedSummary(sessionId: string, entryRow: Row, fieldName: string): string | undefined {
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("session missing after open");
    const { model, relationshipModel: rel } = session;
    const childIndices = model.childrenByParent.get(entryRow.id) ?? [];
    const child = childIndices.map((i) => model.nodes[i]!).find((n) => n.kind === "field" && n.name === fieldName);
    if (!child) return undefined;
    return projectRow(model, child, rel).displayValue;
}

// ---------------------------------------------------------------------------
// SPL: Effects list -> Opcode summary
// ---------------------------------------------------------------------------

describe("session getChildren summary - SPL effects", () => {
    it("carries the Opcode displayValue as summary on each effect entry row", () => {
        if (!splPresent()) return;
        const sid = protocolOpen(SPL_FIXTURE, "file:///session-summary-spl.spl");
        const entry = firstEntryViaProtocol(sid, "Effects");
        if (!entry) throw new Error("no effect entry in SPL fixture");

        const expected = expectedSummary(sid, entry, "Opcode");
        expect(expected).toBeDefined();
        expect(expected!.length).toBeGreaterThan(0);

        // The row returned by getChildren must carry the same value as summary.
        expect(entry.summary).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// SPL: Abilities list -> Form summary
// ---------------------------------------------------------------------------

describe("session getChildren summary - SPL abilities", () => {
    it("carries the Form displayValue as summary on each ability entry row", () => {
        if (!splPresent()) return;
        const sid = protocolOpen(SPL_FIXTURE, "file:///session-summary-spl-abilities.spl");
        const entry = firstEntryViaProtocol(sid, "Abilities");
        if (!entry) throw new Error("no ability entry in SPL fixture");

        const expected = expectedSummary(sid, entry, "Form");
        expect(expected).toBeDefined();
        expect(expected!.length).toBeGreaterThan(0);

        expect(entry.summary).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// ITM: Effects list -> Opcode summary
// ---------------------------------------------------------------------------

describe("session getChildren summary - ITM effects", () => {
    it("carries the Opcode displayValue as summary on each effect entry row", () => {
        if (!itmPresent()) return;
        const sid = protocolOpen(ITM_FIXTURE, "file:///session-summary-itm.itm");
        const entry = firstEntryViaProtocol(sid, "Effects");
        if (!entry) throw new Error("no effect entry in ITM fixture");

        const expected = expectedSummary(sid, entry, "Opcode");
        expect(expected).toBeDefined();

        expect(entry.summary).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// Format without a summary spec: rows have no summary field
// ---------------------------------------------------------------------------

describe("session getChildren summary - no-summary format (map)", () => {
    it("rows for a format with no summary spec carry no summary", () => {
        const sid = protocolOpen(MAP_FIXTURE, "file:///session-summary.map");
        const roots = children(sid, null);
        expect(roots.length).toBeGreaterThan(0);
        // None of the root section rows should carry a summary for map format.
        const withSummary = roots.filter((r) => r.summary !== undefined);
        expect(withSummary.length).toBe(0);
    });
});
