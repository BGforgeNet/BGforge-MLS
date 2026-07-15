/**
 * Generates the WeiDU BAF IDS completion stanzas from IESDP's per-IDS documentation pages into a single
 * weidu-baf-ids.yml. Each IDS file becomes one `type: 21` (CompletionItemKind.Constant) stanza whose items
 * are the IDS symbols (usable as trigger/action arguments, e.g. Allegiance(Myself,NEUTRAL)). Adding a new
 * IDS table is one IDS_FILES entry. Wired into ie-update.sh after iesdp-update.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Document, YAMLMap } from "yaml";
import { YAML_DUMP_OPTIONS } from "../../utils/src/yaml-helpers.ts";
import { type CompletionItem, createItemsSeq } from "./ie/index.ts";

/**
 * First-line marker stamped into the generated YAML. Leading space renders as "# Auto-generated ...".
 * The oxfmt-exclusion drift guard keys off this marker.
 */
const GENERATED_MARKER =
    " Auto-generated from IESDP IDS pages by scripts/ie-update/src/baf-ids-update.ts. Do not hand-edit.";

/** All IDS stanzas are constant values. */
const IDS_TYPE = 21; // CompletionItemKind.Constant

interface IdsFile {
    /** YAML stanza key. */
    readonly stanza: string;
    /** IESDP htm basename under files/ids/bg2/. */
    readonly page: string;
    /** `doc` value stamped on each item (the source IDS filename). */
    readonly doc: string;
    /** Items prepended before the parsed ones - for values IESDP's page omits (e.g. EA's ANYONE=0). */
    readonly prepend?: readonly CompletionItem[];
}

/** The IDS tables bundled for BAF/D completion. Add a row to bundle another IDS. */
const IDS_FILES: readonly IdsFile[] = [
    { stanza: "bg2_animate_ids", page: "animate", doc: "animate.ids" },
    { stanza: "bg2_slots_ids", page: "slots", doc: "slots.ids" },
    {
        stanza: "bg2_ea_ids",
        page: "ea",
        doc: "ea.ids",
        // IESDP's ea page documents the named allegiances but omits ANYONE (0), the common wildcard.
        prepend: [{ name: "ANYONE", detail: "0", doc: "ea.ids" }],
    },
    { stanza: "bg2_general_ids", page: "general", doc: "general.ids" },
    { stanza: "bg2_race_ids", page: "race", doc: "race.ids" },
    { stanza: "bg2_gender_ids", page: "gender", doc: "gender.ids" },
];

/**
 * Parses an IESDP IDS documentation page into completion items. After stripping HTML tags, each line whose
 * first two whitespace-delimited tokens are `<value> <name>` (value a decimal or 0x-hex literal; name the
 * next token, which may contain hyphens; any trailing description ignored) becomes an item. Duplicate names
 * keep the first occurrence. Exported for unit testing.
 */
export function parseIdsHtml(html: string, doc: string): CompletionItem[] {
    // Process line by line: strip this line's tags, then match `<value> <name>`. Line-wise (not a
    // whole-string regex) because `\s+` matches newlines, so a bare count line like "126" would otherwise
    // consume the newline and grab the next row's value ("0x0000 FIRE_RING") as its name.
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const rawLine of html.split("\n")) {
        const line = rawLine.replaceAll(/<[^>]*>/g, "");
        const match = /^\s*(0x[0-9A-Fa-f]+|[0-9]+)\s+(\S+)/.exec(line);
        if (match === null) {
            continue;
        }
        const name = match[2]!;
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        items.push({ name, detail: match[1]!, doc });
    }
    return items;
}

/** Builds the full weidu-baf-ids.yml document (one stanza per IDS_FILES entry). */
function buildIdsDoc(iesdpDir: string): Document {
    const yamlDoc = new Document();
    const root = new YAMLMap();
    yamlDoc.contents = root;

    for (const ids of IDS_FILES) {
        const page = path.join(iesdpDir, "files", "ids", "bg2", `${ids.page}.htm`);
        const parsed = parseIdsHtml(fs.readFileSync(page, "utf8"), ids.doc);
        const items = [...(ids.prepend ?? []), ...parsed];

        const stanza = new YAMLMap();
        stanza.add(yamlDoc.createPair("type", IDS_TYPE));
        stanza.add(yamlDoc.createPair("items", createItemsSeq(yamlDoc, items)));
        root.add(yamlDoc.createPair(ids.stanza, stanza));
    }

    yamlDoc.commentBefore = GENERATED_MARKER;
    return yamlDoc;
}

function main(): void {
    const { values } = parseArgs({
        options: {
            s: { type: "string" },
            "data-ids": { type: "string" },
        },
    });

    const iesdpDir = values.s;
    const dataIds = values["data-ids"];

    if (!iesdpDir || !dataIds) {
        console.error("Usage: baf-ids-update -s <iesdp_dir> --data-ids <path>");
        process.exit(1);
    }

    const yamlDoc = buildIdsDoc(iesdpDir);
    fs.writeFileSync(dataIds, yamlDoc.toString(YAML_DUMP_OPTIONS), "utf8");
}

const isDirectRun = process.argv[1]?.endsWith("baf-ids-update.ts");
if (isDirectRun) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
