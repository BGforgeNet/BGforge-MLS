/**
 * Dumps sfall completion data into server/data/fallout-ssl-sfall.yml.
 * Round-trip: reads the existing file, updates sfall_functions and hooks stanzas,
 * and writes back — preserving all other content and comments.
 *
 * Shared helpers (makeBlockScalar, YAML_DUMP_OPTIONS) are in utils/yaml-helpers.
 */

import fs from "node:fs";
import YAML, { Document, YAMLMap, YAMLSeq, isMap } from "yaml";
import { makeBlockScalar, YAML_DUMP_OPTIONS } from "../../../utils/src/yaml-helpers.ts";
import {
    type FalloutCompletionItem,
    COMPLETION_TYPE_CONSTANT,
    COMPLETION_TYPE_FUNCTION,
    SFALL_FUNCTIONS_STANZA,
    SFALL_HOOKS_STANZA,
} from "./types.ts";

/**
 * Creates a YAML sequence of completion items for the sfall_functions stanza.
 * Doc fields use block scalar style (|-) for multiline content.
 */
function createCompletionSeq(doc: Document, items: readonly FalloutCompletionItem[]): YAMLSeq {
    const seq = new YAMLSeq();
    for (const item of items) {
        const map = new YAMLMap();
        map.add(doc.createPair("name", item.name));

        if (item.detail !== undefined) {
            map.add(doc.createPair("detail", item.detail));
        }

        if (item.doc !== undefined) {
            const cleanDoc = item.doc.replace(/ +$/gm, "");
            const docValue = makeBlockScalar(doc, cleanDoc);
            map.add(doc.createPair("doc", docValue));
        }

        if (item.args !== undefined) {
            map.add(doc.createPair("args", doc.createNode(item.args)));
            map.add(doc.createPair("type", item.type));
        }

        seq.add(map);
    }
    return seq;
}

/**
 * Dumps sfall completion data into the completion YAML file (round-trip).
 * Updates the sfall_functions and hooks stanzas, preserving all other content.
 */
export function dumpFalloutCompletion(
    fpath: string,
    sfallFunctions: readonly FalloutCompletionItem[],
    sfallHooks: readonly FalloutCompletionItem[],
): void {
    const content = fs.readFileSync(fpath, "utf8");
    // Cast to Document to avoid ParsedNode generic constraints on set()
    const doc = YAML.parseDocument(content) as Document;

    const contents = doc.contents;
    if (!isMap(contents)) {
        throw new Error(`Expected map contents in ${fpath}`);
    }

    // Update sfall_functions stanza
    const functionsMap = new YAMLMap();
    functionsMap.add(doc.createPair("type", COMPLETION_TYPE_FUNCTION));
    functionsMap.add(doc.createPair("items", createCompletionSeq(doc, sfallFunctions)));
    contents.set(SFALL_FUNCTIONS_STANZA, functionsMap);

    // Update hooks stanza
    const hooksMap = new YAMLMap();
    hooksMap.add(doc.createPair("type", COMPLETION_TYPE_CONSTANT));
    hooksMap.add(doc.createPair("items", createCompletionSeq(doc, sfallHooks)));
    contents.set(SFALL_HOOKS_STANZA, hooksMap);

    const output = doc.toString(YAML_DUMP_OPTIONS);
    fs.writeFileSync(fpath, output, "utf8");
}
