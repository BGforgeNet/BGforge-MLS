/**
 * Entry point for `pnpm exec tsx scripts/ie-binary-update/src/main.ts`.
 * Regenerates `binary/src/<format>/specs/*.ts` from IESDP `_data/file_formats/`.
 *
 * Hand-overrides for things that don't translate cleanly (flag tables,
 * bit-packed sub-fields, presentation labels) live in `*.overrides.ts`
 * sibling files and are merged at module load by the format's index.ts.
 */

import path from "node:path";
import { parseArgs } from "node:util";
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

    if (result.diffs.length > 0) {
        for (const diff of result.diffs) {
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
