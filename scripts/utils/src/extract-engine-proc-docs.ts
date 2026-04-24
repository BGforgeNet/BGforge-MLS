/**
 * Extracts engine procedure data from the YAML source.
 * Produces two outputs:
 *   --out:   { name: docText } JSON for the TSSL TypeScript plugin (hover docs)
 *   --names: sorted string array of procedure names (used by server for tree-shaking
 *            and by the plugin for TS6133 diagnostic suppression)
 *
 * Single source of truth: server/data/fallout-ssl-base.yml (engine_procedures stanza).
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/extract-engine-proc-docs.ts \
 *     --yaml server/data/fallout-ssl-base.yml \
 *     --out server/out/fallout-ssl-engine-proc-docs.json \
 *     --names server/out/fallout-ssl-engine-procedures.json
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { FALLOUT_SSL_STANZAS } from "../../../shared/stanza-names.ts";

interface YamlItem {
    readonly name: string;
    readonly doc?: string;
}

interface YamlStanza {
    readonly items: readonly YamlItem[];
}

function main(): void {
    const { values } = parseArgs({
        options: {
            yaml: { type: "string" },
            out: { type: "string" },
            names: { type: "string" },
        },
        strict: true,
    });

    if (!values.yaml || !values.out || !values.names) {
        console.error("Usage: extract-engine-proc-docs --yaml <path> --out <path> --names <path>");
        process.exit(1);
    }

    if (!fs.existsSync(values.yaml)) {
        console.error(`File not found: ${values.yaml} (--yaml). Run the data generation step first.`);
        process.exit(1);
    }

    const yamlData = YAML.parse(fs.readFileSync(values.yaml, "utf8")) as Record<string, YamlStanza>;

    const engineStanza = yamlData[FALLOUT_SSL_STANZAS.engine_procedures];
    if (!engineStanza) {
        console.error(`No '${FALLOUT_SSL_STANZAS.engine_procedures}' stanza found in YAML`);
        process.exit(1);
    }

    const engineNames = engineStanza.items.map((item) => item.name).sort();

    // Build docs as immutable object from entries
    const docs: Readonly<Record<string, string>> = Object.fromEntries(
        engineStanza.items
            .filter((item) => item.doc !== undefined && item.doc !== "")
            .map((item) => [item.name, item.doc as string] as const),
    );

    fs.writeFileSync(values.out, JSON.stringify(docs, null, 4), "utf8");
    fs.writeFileSync(values.names, JSON.stringify(engineNames, null, 4), "utf8");
}

main();
