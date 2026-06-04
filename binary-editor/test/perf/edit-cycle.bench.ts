/**
 * MAP edit-cycle performance bench.
 *
 * Fixture: denbus1.map (576 KB, 68,948 model nodes with skipMapTiles=true).
 * That is well above the 10k-record target, so the 10k gate is MEASURED, not
 * extrapolated.
 *
 * Two benches:
 *   1. open + window + editField - the field-mutation path (serialize on demand).
 *   2. open + structureOp add    - the most expensive path: reparses the whole file.
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

// Editable field: Header / Version (id "0/0", rawValue 20 = Fallout 2 enum).
// Writing back the same value keeps the file logically unchanged across iterations.
const FIELD_ID = "0/0";
const FIELD_VALUE = 20;

describe("MAP edit cycle (denbus1.map, 68948 nodes, skipMapTiles=true)", () => {
    bench("open + window + editField (field-mutation path)", () => {
        const opened = dispatch({ type: "open", uri: URI, bytes: bytes(), options: { skipMapTiles: true } });
        if (opened.type !== "opened") throw new Error(`open failed: ${JSON.stringify(opened)}`);
        const sid = opened.result.sessionId;

        // Window the first 50 visible rows - typical initial render.
        const win = dispatch({ type: "getWindow", sessionId: sid, start: 0, end: 50 });
        if (win.type !== "window") throw new Error("getWindow failed");

        // Edit a field (marks dirty; does NOT reparse the file - O(model) serialize on demand).
        const edited = dispatch({ type: "editField", sessionId: sid, nodeId: FIELD_ID, value: FIELD_VALUE });
        if (edited.type !== "edited") throw new Error("editField failed");

        dispatch({ type: "close", sessionId: sid });

        // Defeat DCE: consume results so V8 cannot hoist them out of the loop.
        void win;
        void edited;
    });

    bench("open + structureOp add (full reparse path)", () => {
        const opened = dispatch({ type: "open", uri: URI, bytes: bytes(), options: { skipMapTiles: true } });
        if (opened.type !== "opened") throw new Error(`open failed: ${JSON.stringify(opened)}`);
        const sid = opened.result.sessionId;

        // structureOp serializes the current model then reparses the produced bytes -
        // the costliest mutation path. "Global Variables" is the addable list on this format.
        const added = dispatch({
            type: "structureOp",
            sessionId: sid,
            op: { op: "add", namePath: ["Global Variables"] },
        });
        if (added.type !== "structure") throw new Error(`structureOp failed: ${JSON.stringify(added)}`);

        dispatch({ type: "close", sessionId: sid });

        void added;
    });
});
