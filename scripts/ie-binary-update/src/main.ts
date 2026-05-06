/**
 * Entry point for `pnpm exec tsx scripts/ie-binary-update/src/main.ts`.
 * Regenerates `binary/src/<format>/specs/*.ts` from IESDP `_data/file_formats/`.
 *
 * Hand-overrides for things that don't translate cleanly (flag tables,
 * bit-packed sub-fields, presentation labels) live in `*.overrides.ts`
 * sibling files and are merged at module load by the format's index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { extractOpcodes, emitOpcodesModule } from "./extract-opcodes.ts";
import { type FormatTarget, generate } from "./generate.ts";

/**
 * All formats produced by this generator.
 *
 * Only `feature_block.yml` (effect) is byte-identical between ITM and SPL.
 * `extended_header.yml` (ability) differs: ITM is 56 bytes; SPL is 40 with
 * different fields, so each format generates its own ability spec.
 */
const TARGETS: readonly FormatTarget[] = [
    {
        iesdpRelPath: "_data/file_formats/itm_v1/header.yml",
        outputRelPath: "binary/src/itm/specs/header.ts",
        specConst: "itmHeaderSpec",
        dataType: "ItmHeaderData",
    },
    {
        iesdpRelPath: "_data/file_formats/itm_v1/extended_header.yml",
        outputRelPath: "binary/src/itm/specs/ability.ts",
        specConst: "itmAbilitySpec",
        dataType: "ItmAbilityData",
    },
    {
        iesdpRelPath: "_data/file_formats/itm_v1/feature_block.yml",
        outputRelPath: "binary/src/ie-common/specs/effect.ts",
        specConst: "effectSpec",
        dataType: "EffectData",
    },
    {
        iesdpRelPath: "_data/file_formats/spl_v1/header.yml",
        outputRelPath: "binary/src/spl/specs/header.ts",
        specConst: "splHeaderSpec",
        dataType: "SplHeaderData",
    },
    {
        iesdpRelPath: "_data/file_formats/spl_v1/extended_header.yml",
        outputRelPath: "binary/src/spl/specs/ability.ts",
        specConst: "splAbilitySpec",
        dataType: "SplAbilityData",
    },
    {
        iesdpRelPath: "_data/file_formats/eff_v2/header.yml",
        outputRelPath: "binary/src/eff/specs/header.ts",
        specConst: "effHeaderSpec",
        dataType: "EffHeaderData",
    },
    {
        iesdpRelPath: "_data/file_formats/eff_v2/body.yml",
        outputRelPath: "binary/src/eff/specs/body.ts",
        specConst: "effBodySpec",
        dataType: "EffBodyData",
    },
];

function main(): void {
    const { values } = parseArgs({
        options: {
            s: { type: "string" },
            "output-dir": { type: "string" },
            check: { type: "boolean", default: false },
        },
    });

    const iesdpDir = values.s;
    if (iesdpDir === undefined) {
        console.error("Usage: ie-binary-update -s <iesdp_dir> [--output-dir <dir>] [--check]");
        process.exit(1);
    }

    // Default output dir is the project root (assumes the generator runs from repo root).
    const outputDir = values["output-dir"] ?? process.cwd();
    const result = generate({ iesdpDir, outputDir, targets: TARGETS, checkOnly: values.check });

    // Opcode lookup: harvested from `_opcodes/opNNN.html` frontmatter rather
    // than `_data/`, so it doesn't fit the per-format YAML pipeline. Generated
    // alongside the format specs so a single regen refreshes everything.
    const diffs = [...result.diffs];
    const opcodesOutputRel = "binary/src/ie-common/opcodes.ts";
    const opcodesExpected = emitOpcodesModule(extractOpcodes(path.join(iesdpDir, "_opcodes")), "_opcodes/opNNN.html");
    const opcodesPath = path.join(outputDir, opcodesOutputRel);
    if (values.check) {
        const actual = fs.existsSync(opcodesPath) ? fs.readFileSync(opcodesPath, "utf8") : "";
        if (actual !== opcodesExpected) {
            diffs.push({ outputRelPath: opcodesOutputRel, expected: opcodesExpected, actual });
        }
    } else {
        fs.mkdirSync(path.dirname(opcodesPath), { recursive: true });
        fs.writeFileSync(opcodesPath, opcodesExpected, "utf8");
    }

    if (diffs.length > 0) {
        for (const diff of diffs) {
            console.error(`Out of date: ${diff.outputRelPath}`);
        }
        console.error(
            `Run 'pnpm exec tsx ${path.relative(process.cwd(), import.meta.filename)} -s <iesdp_dir>' to regenerate.`,
        );
        process.exit(1);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
