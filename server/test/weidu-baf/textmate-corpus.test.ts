/**
 * Corpus oracle for the BAF TextMate grammar's name population.
 *
 * Reads the grammar's OWN scope assignments as the population - not the server/data YAML, which covers only
 * a subset (6 of ~27 IDS stanzas are generated from it; the rest are hand-maintained). Asserts that the set
 * of names carrying each scope does not shrink when the ALL-CAPS stanzas are replaced by a casing rule.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BAF_SYNTAX_PATH = path.resolve(__dirname, "../../../syntaxes/weidu-baf.tmLanguage.json");
const ALLCAPS = /^[A-Z][A-Z0-9_]*$/;

interface Rule {
    match?: string;
    name?: string;
    patterns?: Rule[];
    captures?: Record<string, Rule>;
}

/** Every literal `\b(NAME)\b` rule in the grammar, grouped by the scope it assigns. */
function namesByScope(): Map<string, string[]> {
    const grammar = JSON.parse(readFileSync(BAF_SYNTAX_PATH, "utf-8")) as { repository: Record<string, Rule> };
    const out = new Map<string, string[]>();

    const visit = (node: Rule | Rule[] | undefined): void => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach((n) => visit(n));
            return;
        }
        const literal = node.match?.match(/^\\b\(([^)|]*)\)\\b$/);
        if (literal && node.name && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(literal[1]!)) {
            if (!out.has(node.name)) out.set(node.name, []);
            out.get(node.name)!.push(literal[1]!);
        }
        visit(node.patterns);
        if (node.captures) visit(Object.values(node.captures));
    };

    Object.values(grammar.repository).forEach((rule) => visit(rule));
    return out;
}

const CONSTANT = "constant.other.weidu-baf";
const TRIGGER = "entity.name.function.trigger.weidu-baf";
const ACTION = "support.function.weidu-baf";

describe("weidu-baf grammar name population", () => {
    // Every hyphenated constant in the grammar. \b[A-Z][A-Z0-9_]*\b shreds these into fragments (it stops at
    // the "-", which is not a word character), so each MUST stay enumerated ahead of the casing rule.
    // Derived from the grammar's own scope assignments, not hand-listed: an earlier hand-built list read a
    // truncated probe and carried only 5 of the 8, which would have silently dropped the three YUAN-TI
    // variants. Asserted as an EXACT set for that reason - a >= threshold cannot catch a dropped name.
    const HYPHENATED = [
        "GIANT_YAGA-SHURA",
        "KUO-TOA",
        "KUO-TOA_LARGE",
        "WILL-O-WISP",
        "YUAN-TI",
        "YUAN-TI_ELITE",
        "YUAN-TI_HALF",
        "YUAN-TI_PRIEST",
    ];

    it("still enumerates every hyphenated constant, exactly", () => {
        const consts = namesByScope().get(CONSTANT) ?? [];
        const hyphenated = [...new Set(consts.filter((n) => n.includes("-")))].sort();
        // Exact equality, not a subset check: the failure this guards against is a name silently vanishing
        // from the enumeration, which every loose matcher passes.
        expect(hyphenated).toEqual([...HYPHENATED].sort());
    });

    it("still enumerates every CamelCase constant a casing rule cannot express", () => {
        // The casing rule covers ALL-CAPS names. The CamelCase remainder - 117 OBJECT.IDS entries plus
        // CasterHold (genuine STATS.IDS entry 70; its 223 siblings are ALL-CAPS) - must stay enumerated.
        const consts = namesByScope().get(CONSTANT) ?? [];
        const camel = [...new Set(consts.filter((n) => !ALLCAPS.test(n) && !n.includes("-")))];

        expect(camel).toContain("BestAC");
        expect(camel).toContain("NearestEnemyOf");
        expect(camel).toContain("CasterHold");
        // Exact count, not a floor: 117 object-ids + CasterHold. A floor would pass while names disappear.
        expect(camel.length).toBe(118);
    });

    it("still enumerates every ALL-CAPS call name so the casing rule cannot claim it", () => {
        const byScope = namesByScope();
        const triggers = byScope.get(TRIGGER) ?? [];
        const actions = byScope.get(ACTION) ?? [];

        // 12 ALL-CAPS triggers + 1 ALL-CAPS action. If any drops out of the enumeration, the casing rule
        // colours it as a constant and the call silently changes colour.
        for (const name of ["G", "GGT", "GLT", "HP", "HPGT", "HPLT", "INI", "LOS", "OR", "XP", "XPGT", "XPLT"]) {
            expect(triggers, `trigger ${name} must stay enumerated`).toContain(name);
        }
        expect(actions, "action SG must stay enumerated").toContain("SG");
    });

    it("keeps the full call vocabulary enumerated", () => {
        const byScope = namesByScope();
        expect((byScope.get(TRIGGER) ?? []).length).toBeGreaterThanOrEqual(258);
        expect((byScope.get(ACTION) ?? []).length).toBeGreaterThanOrEqual(400);
    });
});
