/**
 * Tests for update-baf-highlight: integration of updateBafHighlight against
 * a minimal tmLanguage fixture. Pattern-generation logic is separately covered
 * by update-tp2-highlight.test.ts (shared buildHighlightPatterns).
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { idsStanzaRepoKey, updateBafHighlight } from "../src/update-baf-highlight.ts";

/** Extracts NAME from a `\b(NAME)\b` highlight match pattern. */
function matchName(match: string): string | undefined {
    return /^\\b\((.+)\)\\b$/.exec(match)?.[1];
}

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

    it("regenerates IDS stanzas from the ids-yaml source, preserving the constant scope", () => {
        // Grammar fixture with an IDS stanza carrying a stale hand-maintained list; the generator should
        // replace its patterns from the ids-yaml while leaving the `name:` scope intact.
        const tmWithIds = `${MINIMAL_TM_YAML}  race-ids:
    name: constant.other.weidu-baf
    patterns:
      - match: \\b(OldRace)\\b
`;
        const idsYaml = `bgee_race_ids:
  type: 21
  items:
    - name: MINOTAUR
      detail: "0x63"
      doc: race.ids
    - name: HUMAN
      detail: "0x1"
      doc: race.ids
`;
        const highlightPath = path.join(tmpDir, "weidu-baf.tmLanguage.yml");
        const idsPath = path.join(tmpDir, "weidu-baf-ids.yml");
        fs.writeFileSync(highlightPath, tmWithIds, "utf8");
        fs.writeFileSync(idsPath, idsYaml, "utf8");

        updateBafHighlight("server/data/weidu-baf-iesdp.yml", highlightPath, idsPath);

        const updated = fs.readFileSync(highlightPath, "utf8");
        const parsed = YAML.parse(updated);
        const race = parsed.repository["race-ids"] as { name: string; patterns: Array<{ match: string }> };
        const names = race.patterns.map((p) => p.match);
        expect(names).toContain("\\b(MINOTAUR)\\b");
        expect(names).toContain("\\b(HUMAN)\\b");
        expect(names).not.toContain("\\b(OldRace)\\b");
        expect(race.name).toBe("constant.other.weidu-baf");
        expect(updated).toContain("Auto-generated from weidu-baf-ids.yml");
    });

    it("maps ids data stanza keys to grammar repository keys", () => {
        expect(idsStanzaRepoKey("bgee_animate_ids")).toBe("animate-ids");
        expect(idsStanzaRepoKey("bgee_general_ids")).toBe("general-ids");
        expect(idsStanzaRepoKey("bgee_ea_ids")).toBe("ea-ids");
    });
});

describe("committed IDS highlight stays in sync with weidu-baf-ids.yml", () => {
    // One source of truth: completion (via generate-data.ts) and highlighting (via update-baf-highlight.ts)
    // both read weidu-baf-ids.yml. This guard fails if the committed grammar drifts from that data - e.g. the
    // data file changed but the grammar was not regenerated (scripts/generate-data.sh).
    it("each IDS table's names match its grammar -ids stanza exactly", () => {
        const ids = YAML.parse(fs.readFileSync("server/data/weidu-baf-ids.yml", "utf8")) as Record<
            string,
            { items: Array<{ name: string }> }
        >;
        const grammar = YAML.parse(fs.readFileSync("syntaxes/weidu-baf.tmLanguage.yml", "utf8")) as {
            repository: Record<string, { patterns: Array<{ match?: string }> }>;
        };

        for (const [dataKey, stanza] of Object.entries(ids)) {
            const repoKey = idsStanzaRepoKey(dataKey);
            const grammarStanza = grammar.repository[repoKey];
            if (grammarStanza === undefined) {
                throw new Error(`Missing grammar stanza: ${repoKey}`);
            }

            const grammarNames = grammarStanza.patterns
                .map((p) => (p.match ? matchName(p.match) : undefined))
                .filter((n): n is string => n !== undefined)
                .sort();
            const idsNames = stanza.items.map((i) => i.name).sort();
            expect(grammarNames, `Drift in ${repoKey}`).toEqual(idsNames);
        }
    });
});
