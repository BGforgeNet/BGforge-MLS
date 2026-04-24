/**
 * Tests for IESDP item type processing functions.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getItemTypes, getItemTypesIsense, saveItemTypesIelib } from "../src/ie/item-types.ts";
import type { ItemType } from "../src/ie/types.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("getItemTypes", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".ie-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("loads and processes item types from YAML", () => {
        const yamlContent = [
            "- type: Sword\n  code: '0x01'",
            "- type: Unknown\n  code: '0x00'",
            "- type: Shield\n  code: '0x02'\n  id: SHIELD_TYPE",
        ].join("\n");
        fs.writeFileSync(path.join(tmpDir, "item_types.yml"), yamlContent, "utf8");

        const result = getItemTypes(tmpDir);
        // 'unknown' items are skipped
        expect(result).toHaveLength(2);
        expect(result[0]!.id).toBe("ITEM_TYPE_sword");
        expect(result[0]!.value).toBe("0x01");
        expect(result[1]!.id).toBe("ITEM_TYPE_SHIELD_TYPE");
        expect(result[1]!.value).toBe("0x02");
    });
});

describe("saveItemTypesIelib", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".ie-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("writes TPP file with correct format", () => {
        const itypes: ItemType[] = [
            { id: "ITEM_TYPE_sword", desc: "Sword", value: "0x01" },
            { id: "ITEM_TYPE_shield", desc: "Shield", value: "0x02" },
        ];
        saveItemTypesIelib(tmpDir, itypes);

        const content = fs.readFileSync(path.join(tmpDir, "item_types.tpp"), "utf8");
        expect(content).toContain("ITEM_TYPE_sword = 0x01");
        expect(content).toContain("ITEM_TYPE_shield = 0x02");
    });
});

describe("getItemTypesIsense", () => {
    it("formats item types for completion", () => {
        const itypes: ItemType[] = [{ id: "ITEM_TYPE_sword", desc: "Sword", value: "0x01" }];
        const result = getItemTypesIsense(itypes);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: "ITEM_TYPE_sword",
            detail: "int ITEM_TYPE_sword = 0x01",
            doc: "Sword",
        });
    });
});
