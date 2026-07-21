/**
 * transpilers/common/bundle.ts's no-imports path: bundling is skipped for
 * files without imports (see the function's doc comment), but a local enum
 * still needs pre-transforming to a flat const before parsing. This is a
 * pure seam (transformEnums only, no esbuild) distinct from the esbuild
 * bundling path already covered by api.test.ts/bundle.test.ts.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../tbaf/src/index";

describe("bundle(): source with no imports", () => {
    it("transforms a local enum to a flat const even without any imports to bundle", async () => {
        const src =
            'enum Spell {\n  Shield = "WIZARD_SHIELD",\n}\n\nif (See(Player1)) {\n  Spell(Myself, Spell.Shield);\n}\n';
        const out = await transpile("/virtual/foo.tbaf", src);
        expect(out).toContain("WIZARD_SHIELD");
        expect(out).not.toContain("Spell.Shield");
    });
});
