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
    it("still enumerates every name a casing rule cannot express", () => {
        // The casing rule \b[A-Z][A-Z0-9_]*\b covers ALL-CAPS constants. Everything else MUST remain
        // enumerated or it silently loses its colour. This asserts the exception set is intact.
        const consts = namesByScope().get(CONSTANT) ?? [];
        const inexpressible = consts.filter((n) => !ALLCAPS.test(n));

        // OBJECT.IDS entries (CamelCase), CasterHold (STATS.IDS 70), and the hyphenated names.
        expect(inexpressible).toContain("BestAC");
        expect(inexpressible).toContain("NearestEnemyOf");
        expect(inexpressible).toContain("CasterHold");
        expect(inexpressible).toContain("KUO-TOA");
        expect(inexpressible).toContain("WILL-O-WISP");
        expect(inexpressible).toContain("YUAN-TI");
        expect(inexpressible.length).toBeGreaterThanOrEqual(118);
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
