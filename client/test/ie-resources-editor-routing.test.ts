/**
 * Which editor a game resource opens with. Pins one non-obvious exclusion and one non-obvious mechanism, both
 * of which shipped as a live defect ("Unknown object type: 80" when following a projectile reference).
 */
import { describe, expect, it } from "vitest";
import { parserRegistry } from "@bgforge/binary";
import { IE_BINARY_EDITOR_EXTENSIONS, viewTypeForResource } from "../src/ie-resources/editor-routing";

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
     * Engine PROJECTILE to this viewer, so routing an IE projectile by extension lands it in the Fallout
     * reader, which rejects it. The registry cannot tell them apart - it is keyed by extension alone - so the
     * exclusion is the fix and must not be "corrected" back.
     */
    it("keeps IE .pro out of the binary editor, which parses the Fallout format of that name", () => {
        expect(IE_BINARY_EDITOR_EXTENSIONS.has("pro")).toBe(false);
        expect(viewTypeForResource("pro")).toBe("default");
        // ...and the trap is live: the registry does claim the extension, which is what made this look safe.
        expect(parserRegistry.getByExtension(".pro")).toBeDefined();
    });

    // Never left to file association: the binary editor is registered for `*.pro` at DEFAULT priority, so an
    // unnamed `vscode.open` resolves to it anyway. A named view is what actually routes these elsewhere.
    it("names a concrete view for a format it cannot parse, rather than leaving it unset", () => {
        expect(viewTypeForResource("bcs")).toBe("default");
        expect(viewTypeForResource("dlg")).toBe("default");
    });

    // Every extension the set claims must really have a parser, or the binary editor opens a record it cannot
    // read. This does NOT catch the reverse - a NEW IE parser added without listing it here - because the
    // registry has no game-family dimension to ask. That gap closes only when it gains one.
    it("claims no extension the parser registry cannot read", () => {
        const unparseable = [...IE_BINARY_EDITOR_EXTENSIONS].filter(
            (ext) => parserRegistry.getByExtension(`.${ext}`) === undefined,
        );

        expect(unparseable).toEqual([]);
    });
});
