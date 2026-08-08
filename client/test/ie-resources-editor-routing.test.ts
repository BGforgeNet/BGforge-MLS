/**
 * Which editor a game resource opens with. Pins the mechanism that keeps the two game families apart, which
 * shipped as a live defect ("Unknown object type: 80" when following a projectile reference).
 */
import { describe, expect, it } from "vitest";
import { parserRegistry, type BinaryParser } from "@bgforge/binary";
import pkg from "../../package.json";
import { isIeBinaryRecord, hasViewerFor, viewTypeForResource } from "../src/ie-resources/editor-routing";

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

    /**
     * The binary editor is not the only editor a game resource can open in. Routing asked the parser registry
     * and nothing else, so a `.bam` followed from an item's animation field fell through to the plain text
     * editor and rendered as "the file is not displayed ... because it is either binary or uses an unsupported
     * text encoding" - with the animation editor registered for that very extension.
     */
    it("sends a BAM to the animation editor", () => {
        expect(viewTypeForResource("bam")).toBe("bgforge.animationEditor");
        expect(viewTypeForResource("BAM")).toBe("bgforge.animationEditor");
    });

    // Never left to file association: the binary editor is registered for `*.pro` at DEFAULT priority, so an
    // unnamed `vscode.open` resolves to it anyway. A named view is what actually routes these elsewhere.
    it("names a concrete view for a format it cannot parse, rather than leaving it unset", () => {
        expect(viewTypeForResource("bcs")).toBe("default");
        expect(viewTypeForResource("dlg")).toBe("default");
    });

    /**
     * `"default"` means the plain TEXT editor, not "pick a suitable editor" - so a portrait routed there showed
     * bytes while VS Code's own image preview claimed `.bmp` at builtin priority and would have drawn it. The
     * previewers have to be named as explicitly as ours.
     */
    it("names VS Code's own previewer for a format it ships one for", () => {
        expect(viewTypeForResource("bmp")).toBe("imagePreview.previewEditor");
        expect(viewTypeForResource("BMP")).toBe("imagePreview.previewEditor");
        expect(viewTypeForResource("wav")).toBe("vscode.audioPreview");
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

/**
 * A named view only routes if the extension registers it for that extension: a renamed view type, or a
 * selector that stopped covering a format, would send the resource to an editor nothing answers for. The
 * manifest is the registration, so it is what this checks against.
 */
describe("the named views against the manifest", () => {
    const editors = pkg.contributes.customEditors as {
        viewType: string;
        selector: { filenamePattern: string }[];
    }[];

    it("registers every routed extension with the view routing picks for it", () => {
        for (const ext of ["itm", "spl", "eff", "cre", "bam"]) {
            const viewType = viewTypeForResource(ext);
            const editor = editors.find((e) => e.viewType === viewType);
            expect(editor?.selector.map((s) => s.filenamePattern)).toContain(`*.${ext}`);
        }
    });

    // The builtin previewers are deliberately NOT in our manifest - they are VS Code's, contributed by its
    // bundled media-preview extension. Nothing here can pin those view ids, so they are verified by opening a
    // portrait in a real editor rather than by this suite; the check that stays possible is that we never
    // claim one of them ourselves, which would shadow the real registration.
    it("does not itself register the builtin previewer view ids", () => {
        const ours = editors.map((e) => e.viewType);
        expect(ours).not.toContain("imagePreview.previewEditor");
        expect(ours).not.toContain("vscode.audioPreview");
    });
});

// The tree's "this is a record we can read" affordance and the view choice above are one decision, so they
// cannot disagree about a format - `.pro` used to be openable in the tree while routing sent it elsewhere.
describe("isIeBinaryRecord", () => {
    it("agrees with the view choice, including on the Fallout-shared extension", () => {
        for (const ext of ["itm", "spl", "eff", "cre", "pro", "bcs", "2da", "bam"]) {
            expect(isIeBinaryRecord(ext)).toBe(viewTypeForResource(ext) === "bgforge.binaryEditor");
        }
        expect(isIeBinaryRecord("pro")).toBe(false);
    });
});

/**
 * The tree's affordance and the binary editor's open-chip gate both read this - it meant "binary record" while
 * a BAM opened in the animation editor, so the tree called openable exactly the wrong set.
 */
describe("hasViewerFor", () => {
    it("is true for whatever routing names a view for, and false for the rest", () => {
        for (const ext of ["itm", "spl", "eff", "cre", "bam", "bmp", "wav", "pro", "bcs", "2da", "mos"]) {
            expect(hasViewerFor(ext)).toBe(viewTypeForResource(ext) !== "default");
        }
        expect(hasViewerFor("bam")).toBe(true);
        expect(hasViewerFor("mos")).toBe(false);
    });

    // The binary editor gates its open chip on this, and a field's declared ref type is UPPERCASE
    // (`ref: { kind: "resource", type: "ITM" }`), where the tree passes a filename's lowercase extension. A
    // case-sensitive lookup here would withhold the chip from every field that currently has one.
    it("answers the same for a declared ref type as for a filename extension", () => {
        for (const ext of ["ITM", "SPL", "EFF", "CRE", "BAM", "BMP"]) {
            expect(hasViewerFor(ext)).toBe(true);
        }
        for (const ext of ["BCS", "DLG", "PRO"]) {
            expect(hasViewerFor(ext)).toBe(false);
        }
    });

    // A creature's portraits are the reason this covers more than our own editors: they were withheld with the
    // scripts, though only the scripts are genuinely unviewable.
    it("covers a portrait, which only VS Code's previewer can show", () => {
        expect(hasViewerFor("BMP")).toBe(true);
        expect(hasViewerFor("BCS")).toBe(false);
    });
});
