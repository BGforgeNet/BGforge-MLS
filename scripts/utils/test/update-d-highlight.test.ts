/**
 * Tests for update-d-highlight: integration of updateDHighlight against
 * a minimal tmLanguage fixture. Pattern-generation logic is shared with
 * update-tp2-highlight (buildHighlightPatterns) which has its own tests.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { updateDHighlight } from "../src/update-d-highlight.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

/**
 * Minimal tmLanguage YAML with the eight D-specific repository stanzas.
 * Matches the keys used in STANZA_MAP in update-d-highlight.ts.
 */
const MINIMAL_TM_YAML = `repository:
  d-action:
    name: support.function.weidu-d.action
    patterns:
      - match: \\b(OldAction)\\b
  chain-epilogue:
    name: keyword.control.weidu-d.chain
    patterns:
      - match: \\b(Old)\\b
  sugar:
    name: keyword.control.weidu-d.sugar
    patterns:
      - match: \\b(Old)\\b
  state:
    name: keyword.control.weidu-d.state
    patterns:
      - match: \\b(Old)\\b
  transfeature:
    name: keyword.control.weidu-d.transfeature
    patterns:
      - match: \\b(Old)\\b
  transnext:
    name: keyword.control.weidu-d.transnext
    patterns:
      - match: \\b(Old)\\b
  transition:
    name: keyword.control.weidu-d.transition
    patterns:
      - match: \\b(Old)\\b
  action-when:
    name: keyword.control.weidu-d.when
    patterns:
      - match: \\b(Old)\\b
`;

describe("updateDHighlight", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".d-hl-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("replaces all mapped D stanza patterns from real data", () => {
        const highlightPath = path.join(tmpDir, "weidu-d.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateDHighlight("server/data/weidu-d-base.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        const parsed = YAML.parse(updated);

        // d-action stanza should contain real actions
        const actionPatterns = parsed.repository["d-action"].patterns as Array<{ match: string }>;
        expect(actionPatterns.length).toBeGreaterThan(1);
        expect(actionPatterns.some((p) => p.match === "\\b(REPLACE_ACTION_TEXT_PROCESS_REGEXP)\\b")).toBe(true);
        expect(actionPatterns.some((p) => p.match === "\\b(OldAction)\\b")).toBe(false);

        // action-when stanza should contain IF and UNLESS
        const whenPatterns = parsed.repository["action-when"].patterns as Array<{ match: string }>;
        expect(whenPatterns.some((p) => p.match === "\\b(IF)\\b")).toBe(true);
        expect(whenPatterns.some((p) => p.match === "\\b(UNLESS)\\b")).toBe(true);
    });

    it("sets auto-generated comments on updated stanzas", () => {
        const highlightPath = path.join(tmpDir, "weidu-d.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateDHighlight("server/data/weidu-d-base.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        expect(updated).toContain("weidu-d-base.yml");
    });

    it("writes sorted patterns in transnext stanza", () => {
        const highlightPath = path.join(tmpDir, "weidu-d.tmLanguage.yml");
        fs.writeFileSync(highlightPath, MINIMAL_TM_YAML, "utf8");

        updateDHighlight("server/data/weidu-d-base.yml", highlightPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        const parsed = YAML.parse(updated);
        const patterns = (parsed.repository.transnext.patterns as Array<{ match: string }>).map((p) => p.match);
        expect(patterns).toEqual([...patterns].sort());
        // transnext should include EXIT, EXTERN, GOTO
        expect(patterns).toContain("\\b(EXIT)\\b");
        expect(patterns).toContain("\\b(EXTERN)\\b");
        expect(patterns).toContain("\\b(GOTO)\\b");
    });
});
