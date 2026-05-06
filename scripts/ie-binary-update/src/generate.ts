import fs from "node:fs";
import path from "node:path";
import { emitSpecModule } from "./emit.ts";
import { loadOffsetItems } from "./parse-format.ts";
import { translateStruct } from "./translate.ts";

export interface FormatTarget {
    /** Path relative to the IESDP root, e.g. `_data/file_formats/itm_v1/header.yml`. */
    readonly iesdpRelPath: string;
    /** Path relative to the project root, e.g. `binary/src/itm/specs/header.ts`. */
    readonly outputRelPath: string;
    readonly specConst: string;
    readonly dataType: string;
}

export interface GenerateOptions {
    readonly iesdpDir: string;
    readonly outputDir: string;
    readonly targets: readonly FormatTarget[];
    /**
     * When true, generate to memory and report diffs against existing files
     * instead of writing. Used by CI to verify checked-in files are up to date.
     */
    readonly checkOnly?: boolean;
}

export interface DiffEntry {
    readonly outputRelPath: string;
    readonly expected: string;
    readonly actual: string;
}

export interface GenerateResult {
    readonly diffs: readonly DiffEntry[];
}

export function generate(opts: GenerateOptions): GenerateResult {
    const diffs: DiffEntry[] = [];

    for (const target of opts.targets) {
        const items = loadOffsetItems(path.join(opts.iesdpDir, target.iesdpRelPath));
        const struct = translateStruct(items);
        const expected = emitSpecModule({
            struct,
            specConst: target.specConst,
            dataType: target.dataType,
            sourcePath: target.iesdpRelPath,
        });

        const outputPath = path.join(opts.outputDir, target.outputRelPath);

        if (opts.checkOnly) {
            const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
            if (actual !== expected) {
                diffs.push({ outputRelPath: target.outputRelPath, expected, actual });
            }
            continue;
        }

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, expected, "utf8");
    }

    return { diffs };
}
