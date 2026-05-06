import fs from "node:fs";
import YAML from "yaml";
import { type OffsetItem, validateArray, validateOffsetItem } from "../../ie-update/src/ie/index.ts";

/** Reads an IESDP offset YAML file and validates it as `OffsetItem[]`. */
export function loadOffsetItems(yamlPath: string): readonly OffsetItem[] {
    const raw = YAML.parse(fs.readFileSync(yamlPath, "utf8"));
    return validateArray(raw, validateOffsetItem, yamlPath);
}
