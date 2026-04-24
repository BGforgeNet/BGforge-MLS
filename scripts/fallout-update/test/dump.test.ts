/**
 * Tests for dump module: round-trip YAML updates for the sfall completion file.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { dumpFalloutCompletion } from "../src/fallout/dump.ts";
import { SFALL_FUNCTIONS_STANZA, SFALL_HOOKS_STANZA, type FalloutCompletionItem } from "../src/fallout/types.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("dumpFalloutCompletion", () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
        filePath = path.join(tmpDir, "sfall.yml");
        // Create initial YAML with existing stanzas
        const initial = `sfall_functions:
  type: 3
  items: []
hooks:
  type: 21
  items: []
other-stanza:
  preserved: true
`;
        fs.writeFileSync(filePath, initial, "utf8");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("writes function completion items", () => {
        const functions: FalloutCompletionItem[] = [{ name: "my_func", detail: "void my_func()", doc: "A function." }];
        const hooks: FalloutCompletionItem[] = [];

        dumpFalloutCompletion(filePath, functions, hooks);

        const result = YAML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const stanza = result[SFALL_FUNCTIONS_STANZA] as { type: number; items: Array<{ name: string }> };
        expect(stanza.type).toBe(3);
        expect(stanza.items).toHaveLength(1);
        expect(stanza.items[0]!.name).toBe("my_func");
    });

    it("writes hook completion items", () => {
        const functions: FalloutCompletionItem[] = [];
        const hooks: FalloutCompletionItem[] = [{ name: "HOOK_TEST", doc: "A test hook." }];

        dumpFalloutCompletion(filePath, functions, hooks);

        const result = YAML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const stanza = result[SFALL_HOOKS_STANZA] as { type: number; items: Array<{ name: string }> };
        expect(stanza.type).toBe(21);
        expect(stanza.items).toHaveLength(1);
        expect(stanza.items[0]!.name).toBe("HOOK_TEST");
    });

    it("preserves other stanzas", () => {
        dumpFalloutCompletion(filePath, [], []);

        const result = YAML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const other = result["other-stanza"] as { preserved: boolean };
        expect(other.preserved).toBe(true);
    });

    it("uses block scalar for multiline doc", () => {
        const functions: FalloutCompletionItem[] = [{ name: "func", detail: "void func()", doc: "Line 1\nLine 2" }];
        dumpFalloutCompletion(filePath, functions, []);

        const content = fs.readFileSync(filePath, "utf8");
        // Block scalar starts with |- or |
        expect(content).toMatch(/doc: [|]/);
    });
});
