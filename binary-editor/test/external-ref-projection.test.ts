/**
 * The spec's `ref` / `slotRef` declarations have to survive the projection from the parsed display tree onto
 * the editor `Row` - the layer between the binary library (which emits them) and the client (which resolves
 * them against an open game). Both of those ends are tested independently, so a projection that silently
 * dropped either would leave every suite green while the feature was dead in the editor.
 *
 * Asserts through `buildLayout`, the resolved form the webview renders, rather than the spec or the walker.
 * (`getWindow` is the wrong lens here: it returns the collapsed top-level groups, so no field row is in it.)
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { buildLayout } from "../src/layout";
import type { Row } from "../src/types";

const ITM_FIXTURE = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");
// CRE lives only under external/ (fetched by `pnpm test:external`); it is the sole format carrying slot refs.
const CRE_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");

/** Every field row of the resolved layout - the set the detail form renders. */
function rowsFor(fixture: string, uri: string, format: string): Row[] {
    const bytes = new Uint8Array(fs.readFileSync(fixture));
    const { sessionId } = openSession(uri, bytes);
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error(`session did not open for ${fixture}`);
    const layout = buildLayout(format, session.model, session.relationshipModel).layout;
    if (!layout) throw new Error(`no layout resolved for ${format}`);
    return Object.values(layout.fields);
}

describe("external refs reach the editor row", () => {
    it("projects a strref field's ref onto the row the webview renders", () => {
        const row = rowsFor(ITM_FIXTURE, "file:///misc8j.itm", "itm").find((r) => r.name === "Unidentified Name");

        expect(row?.ref).toEqual({ kind: "strref" });
        // The declaration adds resolvability and nothing else - the row is still edited as a number.
        expect(row?.valueType).toBe("int32");
    });

    it("leaves a plain numeric field without a ref", () => {
        const row = rowsFor(ITM_FIXTURE, "file:///misc8j-plain.itm", "itm").find((r) => r.name === "Weight");

        // Asserted present first: `undefined?.ref` is also undefined, so a row that went missing would pass.
        expect(row).toBeDefined();
        expect(row?.ref).toBeUndefined();
    });

    // A CRE sound slot carries BOTH - a strref value and an IDS-named label - and the client has to apply each.
    // A projection that kept only one would strand the other, which is how the label was lost once already.
    it.skipIf(!fs.existsSync(CRE_FIXTURE))("projects value ref and slot ref together on a sound slot", () => {
        const slots = rowsFor(CRE_FIXTURE, "file:///edwin6-refs.cre", "cre").filter((r) => r.slotRef !== undefined);

        expect(slots).toHaveLength(100);
        expect(slots[0]?.ref).toEqual({ kind: "strref" });
        expect(slots[0]?.slotRef).toEqual({ ref: { kind: "ids", tables: ["SNDSLOT", "SOUNDOFF"] }, index: 0 });
    });
});
