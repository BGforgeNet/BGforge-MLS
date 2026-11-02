/**
 * Tests for sfall-data module: loading functions.yml and hooks.yml,
 * building completion items and highlight patterns.
 * Shared litscal tests are in utils/test/yaml-helpers.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSfallFunctions, loadSfallHooks } from "../src/fallout/sfall-data.ts";
import type { FalloutCompletionItem } from "../src/fallout/types.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("loadSfallFunctions", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("loads and sorts categories and functions", () => {
        const yaml = `
- name: "Category B"
  items:
    - name: func_b
      detail: "void func_b()"
    - name: func_a
      detail: "int func_a()"
- name: "Category A"
  items:
    - name: func_c
      detail: "void func_c()"
`;
        fs.writeFileSync(path.join(tmpDir, "functions.yml"), yaml, "utf8");
        const result = loadSfallFunctions(tmpDir);

        // Categories sorted: A before B; functions sorted within each category
        expect(result.completionItems[0]!.name).toBe("func_c");
        expect(result.completionItems[1]!.name).toBe("func_a");
        expect(result.completionItems[2]!.name).toBe("func_b");
    });

    it("merges category doc into function doc", () => {
        const yaml = `
- name: "Category"
  doc: "Category docs"
  items:
    - name: func_no_doc
      detail: "void func_no_doc()"
    - name: func_with_doc
      detail: "void func_with_doc()"
      doc: "Function docs"
`;
        fs.writeFileSync(path.join(tmpDir, "functions.yml"), yaml, "utf8");
        const result = loadSfallFunctions(tmpDir);

        const noDoc = result.completionItems.find((i) => i.name === "func_no_doc");
        expect(noDoc?.doc).toBe("Category docs");

        const withDoc = result.completionItems.find((i) => i.name === "func_with_doc");
        expect(withDoc?.doc).toBe("Function docs\nCategory docs");
    });

    it("preserves args and type when present", () => {
        const yaml = `
- name: "Cat"
  items:
    - name: typed_func
      detail: "int typed_func(int x)"
      type: "int"
      args:
        - name: x
          type: int
          doc: "the value"
`;
        fs.writeFileSync(path.join(tmpDir, "functions.yml"), yaml, "utf8");
        const result = loadSfallFunctions(tmpDir);

        const item = result.completionItems[0]!;
        expect(item.args).toHaveLength(1);
        expect(item.type).toBe("int");
    });

    /** The one function a functions.yml holding just `item` (YAML, indented as an item) imports to. */
    function importOne(item: string): FalloutCompletionItem {
        fs.writeFileSync(path.join(tmpDir, "functions.yml"), `- name: "Cat"\n  items:\n${item}`, "utf8");
        const items = loadSfallFunctions(tmpDir).completionItems;
        expect(items).toHaveLength(1);
        return items[0]!;
    }

    // The signatures are the ones sfall's own documentation generator writes from the same fields.
    it("builds the signature from the type and the arguments, defaults included", () => {
        const item = importOne(`
    - name: get_stat_max
      type: int
      args:
        - name: stat
          type: int
        - name: who
          type: bool
          default: "False"
          doc: 1 for other critters
`);
        expect(item).toEqual({
            name: "get_stat_max",
            detail: "int get_stat_max(int stat, bool who = False)",
            type: "int",
            args: [
                { name: "stat", type: "int" },
                { name: "who", type: "bool", default: "False", doc: "1 for other critters" },
            ],
        });
    });

    it("writes a function without arguments without parentheses", () => {
        expect(importOne("    - name: get_year\n      type: int\n").detail).toBe("int get_year");
    });

    it("writes a metarule call once per argument count it accepts, an omittable argument dropping from the right", () => {
        const item = importOne(`
    - name: message_box
      type: int
      metarule: message_box
      args:
        - name: message
          type: string
        - name: flags
          type: int
          optional: true
        - name: color
          type: int
          default: "145"
`);
        expect(item.detail).toBe(
            [
                'int sfall_func1("message_box", string message)',
                'int sfall_func2("message_box", string message, int flags)',
                'int sfall_func3("message_box", string message, int flags, int color = 145)',
            ].join("\n"),
        );
    });

    it("calls a metarule by its own name, which can differ from the function's", () => {
        const item = importOne(`
    - name: remove_all_timer_events
      type: void
      metarule: remove_timer_event
`);
        expect(item.detail).toBe('void sfall_func0("remove_timer_event")');
    });

    it("takes a detail line as the signature, for what is not a call", () => {
        const item = importOne('    - name: div\n      detail: "x div y"\n');
        expect(item).toEqual({ name: "div", detail: "x div y" });
    });

    it("carries a deprecation through, a flag or a message", () => {
        const flagged = importOne("    - name: f\n      type: int\n      deprecated: true\n");
        expect(flagged.deprecated).toBe(true);
        const explained = importOne("    - name: f\n      type: int\n      deprecated: Obsolete since sfall 2.1a.\n");
        expect(explained.deprecated).toBe("Obsolete since sfall 2.1a.");
    });

    it("throws when functions.yml not found", () => {
        expect(() => loadSfallFunctions(tmpDir)).toThrow("functions.yml not found");
    });
});

describe("loadSfallHooks", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("loads hooks and generates HOOK_ prefix", () => {
        const yaml = `
- name: AdjustFid
  doc: "Runs after calculating character figure FID."
- name: AdjustPoison
  doc: "Runs when poison level changes."
`;
        fs.writeFileSync(path.join(tmpDir, "hooks.yml"), yaml, "utf8");
        const result = loadSfallHooks(tmpDir);

        expect(result.completionItems).toHaveLength(2);
        expect(result.completionItems[0]!.name).toBe("HOOK_ADJUSTFID");
        expect(result.completionItems[1]!.name).toBe("HOOK_ADJUSTPOISON");
    });

    it("sorts hooks alphabetically by name", () => {
        const yaml = `
- name: Zebra
  doc: "Z hook"
- name: Alpha
  doc: "A hook"
`;
        fs.writeFileSync(path.join(tmpDir, "hooks.yml"), yaml, "utf8");
        const result = loadSfallHooks(tmpDir);

        expect(result.completionItems[0]!.name).toBe("HOOK_ALPHA");
        expect(result.completionItems[1]!.name).toBe("HOOK_ZEBRA");
    });

    it("throws when hooks.yml not found", () => {
        expect(() => loadSfallHooks(tmpDir)).toThrow("hooks.yml not found");
    });
});
