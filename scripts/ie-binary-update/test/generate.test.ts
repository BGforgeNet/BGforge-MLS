import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type FormatTarget, generate } from "../src/generate.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const IESDP_DIR = path.join(REPO_ROOT, "external/infinity-engine/iesdp");
const itmHeaderTarget: FormatTarget = {
    iesdpRelPath: "_data/file_formats/itm_v1/header.yml",
    outputRelPath: "binary/src/itm/specs/header.ts",
    specConst: "itmHeaderSpec",
    dataType: "ItmHeaderData",
};

describe("generate — IESDP itm_v1 header", () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ie-bin-gen-"));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    test("writes header.ts with expected spec const and the full set of derived field names", () => {
        generate({ iesdpDir: IESDP_DIR, outputDir: outDir, targets: [itmHeaderTarget] });
        const generated = fs.readFileSync(path.join(outDir, itmHeaderTarget.outputRelPath), "utf8");

        expect(generated).toContain("// Auto-generated from IESDP _data/file_formats/itm_v1/header.yml");
        expect(generated).toContain("export const itmHeaderSpec = {");
        expect(generated).toContain("export type ItmHeaderData = SpecData<typeof itmHeaderSpec>;");

        // Spot-check a few fields that exercise distinct translation rules.
        expect(generated).toContain("signature: arraySpec({ element: { codec: u8 }, count: 4 }),");
        expect(generated).toContain("unidentifiedName: { codec: i32 },"); // strref → i32
        expect(generated).toContain("replacement: arraySpec({ element: { codec: u8 }, count: 8 }),"); // resref
        expect(generated).toContain("flags: { codec: u32 },"); // markdown-stripped, derived name
        expect(generated).toContain("type: { codec: u16 },");
        expect(generated).toContain("usabilityFlags: arraySpec({ element: { codec: u8 }, count: 4 }),"); // mult
        expect(generated).toContain("kitUsability1: { codec: u8 },"); // markdown-stripped derived name
        expect(generated).toContain("featureBlocksCount: { codec: u16 },");
    });

    test("returns checkOnly=true diff-list when output differs", () => {
        // Pre-write a divergent file under outDir so check mode reports a diff.
        const target = path.join(outDir, itmHeaderTarget.outputRelPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "// stale\n");

        const result = generate({
            iesdpDir: IESDP_DIR,
            outputDir: outDir,
            targets: [itmHeaderTarget],
            checkOnly: true,
        });
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0]?.outputRelPath).toBe(itmHeaderTarget.outputRelPath);
    });

    test("checkOnly returns empty diffs when output matches", () => {
        // First write, then re-run in check mode.
        generate({ iesdpDir: IESDP_DIR, outputDir: outDir, targets: [itmHeaderTarget] });
        const result = generate({
            iesdpDir: IESDP_DIR,
            outputDir: outDir,
            targets: [itmHeaderTarget],
            checkOnly: true,
        });
        expect(result.diffs).toHaveLength(0);
    });
});
