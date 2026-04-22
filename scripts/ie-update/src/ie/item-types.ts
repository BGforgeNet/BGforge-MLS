/**
 * IESDP item type processing.
 * Extracts item types from IESDP data, generates IElib TPP definitions,
 * and formats item types for IDE completion.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { stringToId } from "./offsets.ts";
import type { CompletionItem, ItemType, ItemTypeRaw } from "./types.ts";
import { validateArray, validateItemTypeRaw } from "./validate.ts";

const ITEM_TYPE_PREFIX = "ITEM_TYPE_";

/**
 * Loads item types from IESDP file_formats/item_types.yml.
 * Generates IDs from descriptions, skipping unknown types.
 */
export function getItemTypes(iesdpFileFormatsDir: string): readonly ItemType[] {
    const sourceFile = path.join(iesdpFileFormatsDir, "item_types.yml");
    const content = fs.readFileSync(sourceFile, "utf8");
    const items: readonly ItemTypeRaw[] = validateArray(
        YAML.parse(content),
        validateItemTypeRaw,
        sourceFile,
    );

    return items.reduce<readonly ItemType[]>((acc, item) => {
        const iid = getItemTypeId(item);
        if (iid === "ITEM_TYPE_unknown") {
            return acc;
        }
        if (Number.isNaN(Number(item.code))) {
            throw new TypeError(`Invalid item type code '${item.code}' for '${item.type}' in ${sourceFile}`);
        }
        return [...acc, { id: iid, desc: item.type, value: item.code }];
    }, []);
}

/**
 * Gets or generates an ID for an item type.
 * Uses custom 'id' field if present, otherwise constructs from the type description.
 */
function getItemTypeId(item: ItemTypeRaw): string {
    if (item.id !== undefined) {
        return ITEM_TYPE_PREFIX + item.id;
    }
    return stringToId(item.type, ITEM_TYPE_PREFIX);
}

/**
 * Saves item types as IElib TPP defines to structures/item_types.tpp.
 */
export function saveItemTypesIelib(ielibStructuresDir: string, itypes: readonly ItemType[]): void {
    const destFile = path.join(ielibStructuresDir, "item_types.tpp");
    const text = itypes.map((itype) => `${itype.id} = ${itype.value}`).join("\n") + "\n";
    fs.writeFileSync(destFile, text + "\n", "utf8");
}

/**
 * Formats item types for IDE intellisense completion items.
 */
export function getItemTypesIsense(itypes: readonly ItemType[]): readonly CompletionItem[] {
    return itypes.map((itype) => ({
        name: itype.id,
        detail: `int ${itype.id} = ${itype.value}`,
        doc: itype.desc,
    }));
}
