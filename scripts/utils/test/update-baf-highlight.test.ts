/**
 * Tests for update-baf-highlight: integration of updateBafHighlight against
 * a minimal tmLanguage fixture. Pattern-generation logic is separately covered
 * by update-tp2-highlight.test.ts (shared buildHighlightPatterns).
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { updateBafHighlight } from "../src/update-baf-highlight.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

/** Minimal tmLanguage YAML with actions and triggers stanzas. */
const MINIMAL_TM_YAML = `repository:
  actions:
    name: support.function.weidu-baf.action
    patterns:
      - match: \\b(OldAction)\\b
  triggers:
    name: keyword.control.weidu-baf.trigger
    patterns:
      - match: \\b(OldTrigger)\\b
`;

describe("updateBafHighlight", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".baf-hl-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("replaces action and trigger patterns from real BAF IESDP data", () => {
        const highlightPath = path.join(tmpDir, "weidu-baf.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateBafHighlight("server/data/weidu-baf-iesdp.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        const parsed = YAML.parse(updated);

        // actions stanza should have real patterns from IESDP data
        const actionPatterns = parsed.repository.actions.patterns as Array<{ match: string }>;
        expect(actionPatterns.length).toBeGreaterThan(1);
        // ActionOverride is a known BAF IESDP action
        expect(actionPatterns.some((p) => p.match === "\\b(ActionOverride)\\b")).toBe(true);
        // Old placeholder should be gone
        expect(actionPatterns.some((p) => p.match === "\\b(OldAction)\\b")).toBe(false);

        // triggers stanza should have real patterns from IESDP data
        const triggerPatterns = parsed.repository.triggers.patterns as Array<{ match: string }>;
        expect(triggerPatterns.length).toBeGreaterThan(1);
        expect(triggerPatterns.some((p) => p.match === "\\b(True)\\b")).toBe(true);
    });

    it("sets auto-generated comment on each updated stanza", () => {
        const highlightPath = path.join(tmpDir, "weidu-baf.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateBafHighlight("server/data/weidu-baf-iesdp.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        // Both stanzas get an auto-generated comment referencing the source file
        expect(updated).toContain("weidu-baf-iesdp.yml");
    });

    it("writes sorted patterns (alphabetical by match string)", () => {
        const highlightPath = path.join(tmpDir, "weidu-baf.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateBafHighlight("server/data/weidu-baf-iesdp.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        const parsed = YAML.parse(updated);
        const patterns = (parsed.repository.actions.patterns as Array<{ match: string }>).map((p) => p.match);
        expect(patterns).toEqual([...patterns].sort());
    });
});
