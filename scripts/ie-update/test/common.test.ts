/**
 * Tests for IE-specific common YAML I/O and utility functions.
 * Shared helper tests (cmpStr, litscal, findFiles) are in utils/test/yaml-helpers.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    checkCompletion,
    decodeHtmlEntities,
    dumpCompletion,
    dumpDefinition,
    dumpHighlight,
    htmlInlineToText,
    normalizeHtmlFragment,
    stripLiquid,
} from "../src/ie/common.ts";
import YAML from "yaml";
import type { IEData } from "../src/ie/types.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("stripLiquid", () => {
    it("removes capture note tags", () => {
        const input = "{% capture note %}Some note{% endcapture %} {% include note.html %}";
        expect(stripLiquid(input)).toBe("Some note");
    });

    it("removes capture info tags", () => {
        const input = "{% capture note %}Some info{% endcapture %} {% include info.html %}";
        expect(stripLiquid(input)).toBe("Some info");
    });

    it("leaves plain text unchanged", () => {
        expect(stripLiquid("plain text")).toBe("plain text");
    });
});

describe("dumpCompletion", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".ie-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("writes completion items to YAML file", () => {
        const filePath = path.join(tmpDir, "data.yml");
        // Create initial YAML structure with an existing stanza
        fs.writeFileSync(filePath, "# comment\nexisting:\n  type: 21\n  items: []\n", "utf8");

        const iedata: IEData = {
            test: {
                stanza: "test-stanza",
                scope: "test.scope",
                items: [
                    { name: "B_item", detail: "detail B", doc: "doc B" },
                    { name: "A_item", detail: "detail A", doc: "doc A" },
                ],
            },
        };

        dumpCompletion(filePath, iedata);

        const content = fs.readFileSync(filePath, "utf8");
        const parsed = YAML.parse(content);
        expect(parsed["test-stanza"]).toBeDefined();
        expect(parsed["test-stanza"].type).toBe(21); // COMPLETION_TYPE_CONSTANT
        expect(parsed["test-stanza"].items).toHaveLength(2);
        // Items should be sorted by name
        expect(parsed["test-stanza"].items[0].name).toBe("A_item");
        expect(parsed["test-stanza"].items[1].name).toBe("B_item");
    });
});

describe("checkCompletion", () => {
    it("throws on duplicate names across stanzas", () => {
        const doc = YAML.parseDocument(
            "stanza1:\n  type: 21\n  items:\n    - name: DUPE\n      detail: d\n      doc: d\nstanza2:\n  type: 21\n  items:\n    - name: DUPE\n      detail: d\n      doc: d"
        );
        expect(() => checkCompletion(doc)).toThrow("Duplicated completion items");
    });

    it("allows EVALUATE_BUFFER duplicates", () => {
        const doc = YAML.parseDocument(
            "stanza1:\n  type: 21\n  items:\n    - name: EVALUATE_BUFFER\n      detail: d\n      doc: d\nstanza2:\n  type: 21\n  items:\n    - name: EVALUATE_BUFFER\n      detail: d\n      doc: d"
        );
        expect(() => checkCompletion(doc)).not.toThrow();
    });
});

describe("dumpHighlight", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".ie-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("writes highlight patterns to YAML file", () => {
        const filePath = path.join(tmpDir, "highlight.yml");
        fs.writeFileSync(filePath, "repository:\n  existing: {}\n", "utf8");

        const iedata: IEData = {
            test: {
                stanza: "test-stanza",
                scope: "test.scope",
                items: [
                    { name: "SHORT", detail: "d", doc: "d" },
                    { name: "LONGER_NAME", detail: "d", doc: "d" },
                ],
            },
        };

        dumpHighlight(filePath, iedata);

        const content = fs.readFileSync(filePath, "utf8");
        const parsed = YAML.parse(content);
        const stanza = parsed.repository["test-stanza"];
        expect(stanza.name).toBe("test.scope");
        expect(stanza.patterns).toBeDefined();
        // Longer names should come first
        expect(stanza.patterns[0].match).toContain("LONGER_NAME");
    });
});

describe("decodeHtmlEntities", () => {
    it("decodes hex numeric character references (&#x...;)", () => {
        expect(decodeHtmlEntities("&#x41;")).toBe("A");
        expect(decodeHtmlEntities("&#x4F;")).toBe("O");
    });

    it("decodes decimal numeric character references (&#...;)", () => {
        expect(decodeHtmlEntities("&#65;")).toBe("A");
        expect(decodeHtmlEntities("&#79;")).toBe("O");
    });

    it("passes through unknown named entities unchanged", () => {
        expect(decodeHtmlEntities("&unknown;")).toBe("&unknown;");
    });
});

describe("htmlInlineToText", () => {
    it("strips tags and decodes entities", () => {
        expect(htmlInlineToText("<code>&#x41;</code>")).toBe("A");
    });
});

describe("normalizeHtmlFragment compactBlankLines: false", () => {
    it("trims without collapsing blank lines when compactBlankLines is false", () => {
        const html = "  hello  ";
        const result = normalizeHtmlFragment(html, {
            resolveHref: (h: string) => h,
            compactBlankLines: false,
        });
        // Should trim but not compact blank lines
        expect(result).toBe("hello");
    });

    it("preserves multiple blank lines when compactBlankLines is false", () => {
        const html = "line1<br /><br /><br />line2";
        const result = normalizeHtmlFragment(html, {
            resolveHref: (h: string) => h,
            compactBlankLines: false,
        });
        // Three <br> = three newlines — not collapsed
        expect(result).toContain("\n\n\n");
    });
});

describe("dumpDefinition", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".ie-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("writes sorted definition constants to TPP file", () => {
        const items = new Map([
            ["Z_CONST", "0x10"],
            ["A_CONST", "0x0"],
        ]);
        dumpDefinition("EFF_V2_", items, tmpDir);

        const outputPath = path.join(tmpDir, "effv2", "iesdp.tpp");
        expect(fs.existsSync(outputPath)).toBe(true);

        const content = fs.readFileSync(outputPath, "utf8");
        const lines = content.trim().split("\n");
        // Should be sorted alphabetically
        expect(lines[0]).toBe("A_CONST = 0x0");
        expect(lines[1]).toBe("Z_CONST = 0x10");
    });
});
