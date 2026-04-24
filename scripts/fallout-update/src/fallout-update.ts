/**
 * Main entry point for the Fallout SSL data update script.
 * Loads sfall functions/hooks from the sfall source and dumps completion YAML.
 *
 * Usage:
 *   pnpm exec tsx scripts/fallout-update/src/fallout-update.ts \
 *     -s <src_dir> --sfall-file <path>
 */

import { parseArgs } from "node:util";
import { dumpFalloutCompletion, loadSfallFunctions, loadSfallHooks } from "./fallout/index.ts";

const { values } = parseArgs({
    options: {
        s: { type: "string", short: "s" },
        "sfall-file": { type: "string" },
    },
    strict: true,
});

const srcDir = values.s;
const sfallFile = values["sfall-file"];

if (srcDir === undefined || sfallFile === undefined) {
    console.error("Usage: fallout-update -s <src_dir> --sfall-file <path>");
    process.exit(1);
}

// Load sfall functions and hooks
const sfallFunctions = loadSfallFunctions(srcDir);
const sfallHooks = loadSfallHooks(srcDir);

// Dump completion YAML
dumpFalloutCompletion(sfallFile, sfallFunctions.completionItems, sfallHooks.completionItems);
