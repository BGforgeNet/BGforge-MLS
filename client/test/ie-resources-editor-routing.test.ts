/**
 * Which editor a game resource opens with. Pins the mechanism that keeps the two game families apart, which
 * shipped as a live defect ("Unknown object type: 80" when following a projectile reference).
 */
import { describe, expect, it } from "vitest";
import { parserRegistry, type BinaryParser } from "@bgforge/binary";
import { isIeBinaryRecord, viewTypeForResource } from "../src/ie-resources/editor-routing";

describe("viewTypeForResource", () => {
    it("sends the four parsed IE formats to the binary editor", () => {
        for (const ext of ["itm", "spl", "eff", "cre"]) {
            expect(viewTypeForResource(ext)).toBe("bgforge.binaryEditor");
        }
    });

    // A resref carries whatever case the record stored, and a game ships both.
    it("matches the extension case-insensitively", () => {
        expect(viewTypeForResource("ITM")).toBe("bgforge.binaryEditor");
    });

    /**
     * The regression this exists for. `.pro` is a Fallout PROTOTYPE to the parser registry and an Infinity
     * Engine PROJECTILE to this viewer, so a family-blind lookup lands an IE projectile in the Fallout reader,
     * which rejects it. The exclusion is no longer a hand-kept one: the Fallout parser simply is not an answer
     * to the question this asks.
     */
    it("keeps IE .pro out of the binary editor, which parses the Fallout format of that name", () => {
        expect(viewTypeForResource("pro")).toBe("default");
        // ...and the trap is live: a parser DOES claim the extension, which is what made a bare lookup look safe.
        expect(parserRegistry.getByExtension(".pro")).toBeDefined();
    });

    // Never left to file association: the binary editor is registered for `*.pro` at DEFAULT priority, so an
    // unnamed `vscode.open` resolves to it anyway. A named view is what actually routes these elsewhere.
    it("names a concrete view for a format it cannot parse, rather than leaving it unset", () => {
        expect(viewTypeForResource("bcs")).toBe("default");
        expect(viewTypeForResource("dlg")).toBe("default");
    });

    /**
     * The blind spot the hand-kept extension list had: a new IE parser was invisible to routing until someone
     * remembered to list it here, and no test could catch the omission because the registry could not be asked
     * which game a parser serves. It can now, so registration IS the wiring.
     */
    it("routes a newly registered IE format without being told about it", () => {
        const added: BinaryParser = {
            id: "routing-test-ie",
            name: "routing-test-ie",
            extensions: ["rtie"],
            family: "infinity-engine",
            parse: () => ({ fields: [] }) as unknown as ReturnType<BinaryParser["parse"]>,
        };
        expect(viewTypeForResource("rtie")).toBe("default");

        parserRegistry.register(added);

        expect(viewTypeForResource("rtie")).toBe("bgforge.binaryEditor");
    });
});

// The tree's "this is a record we can read" affordance and the view choice above are one decision, so they
// cannot disagree about a format - `.pro` used to be openable in the tree while routing sent it elsewhere.
describe("isIeBinaryRecord", () => {
    it("agrees with the view choice, including on the Fallout-shared extension", () => {
        for (const ext of ["itm", "spl", "eff", "cre", "pro", "bcs", "2da"]) {
            expect(isIeBinaryRecord(ext)).toBe(viewTypeForResource(ext) === "bgforge.binaryEditor");
        }
        expect(isIeBinaryRecord("pro")).toBe(false);
    });
});
