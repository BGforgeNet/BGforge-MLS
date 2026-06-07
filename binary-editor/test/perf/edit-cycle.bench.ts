/**
 * MAP edit-cycle performance bench - costs isolated.
 *
 * Fixture: denbus1.map (576 KB, ~68,948 model nodes with skipMapTiles=true, ~7x the 10k target).
 *
 * Three benches, each measuring a single cost in isolation:
 *   1. open (full parse)      - paid once when a file is opened in production.
 *   2. editField (per edit)   - the true per-edit interactivity cost; session opened ONCE outside the bench.
 *   3. structureOp add        - per-add cost; reparses the whole file; session opened ONCE outside the bench.
 *
 * Run manually (not part of the unit-test suite, which matches *.test.ts only):
 *   cd binary-editor && pnpm exec vitest bench --run test/perf/edit-cycle.bench.ts
 */
import { bench, describe } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dispatch } from "../../src/protocol";

const MAP = path.resolve(import.meta.dirname, "../../../client/testFixture/maps/denbus1.map");
const URI = `file://${MAP}`;

// Read once; each bench call creates a fresh Uint8Array so the parse sees mutable bytes.
const mapBuffer = fs.readFileSync(MAP);
const bytes = () => new Uint8Array(mapBuffer);

const open = () => dispatch({ type: "open", uri: URI, bytes: bytes(), options: { skipMapTiles: true } });

// Open a session and return its id; throws on failure.
function openSid(): string {
    const r = open();
    if (r.type !== "opened") throw new Error(`open failed: ${JSON.stringify(r)}`);
    return r.result.sessionId;
}

// Header / Version field: id "0/0", rawValue 20 (Fallout 2 enum).
// Known good from previous bench run; using a fixed id avoids a getChildren traversal at startup.
const FIELD_ID = "0/0";

describe("MAP perf on denbus1.map (~68,948 nodes, skipMapTiles=true)", () => {
    // Bench 1: open (full parse) measured in isolation - open then immediately close.
    bench("open (full parse) - one-time per file", () => {
        const r = open();
        if (r.type === "opened") dispatch({ type: "close", sessionId: r.result.sessionId });
    });

    // Bench 2: editField on a session opened ONCE in module scope - excludes parse cost entirely.
    // The value alternates between two numerics to avoid any "no-op same-value" shortcut.
    const editSid = openSid();
    let toggle = 0;
    bench("editField (per edit, session already open)", () => {
        // Write 20 or 21 alternately; both are valid enum values for the Version field.
        const value = toggle++ % 2 === 0 ? 20 : 21;
        const r = dispatch({ type: "editField", sessionId: editSid, nodeId: FIELD_ID, value });
        if (r.type !== "edited") throw new Error(`editField failed: ${JSON.stringify(r)}`);
        void r;
    });

    // Bench 3: structureOp add on a session opened ONCE - each add reparses the whole file.
    // "Global Variables" is the addable list on the MAP format (confirmed by prior bench).
    const addOpen = open();
    if (addOpen.type !== "opened") throw new Error(`open failed: ${JSON.stringify(addOpen)}`);
    const addSid = addOpen.result.sessionId;
    // Address the section by its stable NodeId (structure ops no longer take display paths).
    const globalVarsSectionId = addOpen.result.layout.layout?.sections["Global Variables"]?.nodeId;
    if (!globalVarsSectionId) throw new Error("no Global Variables section in layout");
    bench("structureOp add (per add, reparses)", () => {
        const r = dispatch({
            type: "structureOp",
            sessionId: addSid,
            op: { op: "add", sectionId: globalVarsSectionId },
        });
        if (r.type !== "structure") throw new Error(`structureOp failed: ${JSON.stringify(r)}`);
        void r;
    });
});
