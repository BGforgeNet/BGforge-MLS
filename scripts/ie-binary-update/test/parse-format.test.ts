import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadOffsetItems } from "../src/parse-format.ts";

describe("loadOffsetItems", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ie-bin-update-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("parses and validates a YAML offset file", () => {
        const yamlPath = path.join(tmpDir, "header.yml");
        fs.writeFileSync(
            yamlPath,
            [
                "- desc: Signature",
                "  type: char array",
                "  length: 4",
                "  id: signature",
                "- desc: Flags",
                "  type: dword",
            ].join("\n"),
            "utf8",
        );

        const items = loadOffsetItems(yamlPath);
        expect(items).toHaveLength(2);
        expect(items[0]?.id).toBe("signature");
        expect(items[1]?.type).toBe("dword");
    });

    test("throws when the YAML root is not a sequence", () => {
        const yamlPath = path.join(tmpDir, "bad.yml");
        fs.writeFileSync(yamlPath, "key: value\n", "utf8");
        expect(() => loadOffsetItems(yamlPath)).toThrow();
    });
});
