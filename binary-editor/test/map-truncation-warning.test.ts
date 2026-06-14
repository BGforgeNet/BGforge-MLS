/**
 * A partially-decoded MAP surfaces a warning so the editor can show a banner.
 *
 * The map parser bails into an opaque tail (label `objects-tail` / `script-section-tail`) when it reaches an
 * object whose subtype it cannot resolve - common, since full object decoding needs every referenced PRO. That
 * truncation was previously silent (only a buried "Truncated" note); it now emits a `warnings[]` entry, carried
 * through the open response to a banner. The benign opaque ranges (skipped `tiles`, header padding) do NOT warn.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/index";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

describe("MAP partial-decode warning", () => {
    it("warns when object data is truncated to an opaque tail", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
        const r = dispatch({ type: "open", uri: "file:///arcaves.map", bytes });
        expect(r.type).toBe("opened");
        if (r.type !== "opened") return;
        expect(
            r.result.warnings.some((w) => /partial|decode|opaque|preserved|not.*shown/i.test(w)),
            `warnings: ${JSON.stringify(r.result.warnings)}`,
        ).toBe(true);
    });
});
