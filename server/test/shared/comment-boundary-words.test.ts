/**
 * The TP2 and D external scanners end an unclosed block comment before the next line that starts a top-level item,
 * and each keeps its own copy of the words that start one: C cannot read the grammar. A word missing from a copy
 * lets an unclosed comment swallow that item while it is being typed; a word only in a copy ends it early. The
 * grammar side is read from the generated grammar.json, so this needs the grammar build.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const GRAMMARS_DIR = path.resolve(__dirname, "../../../grammars");

interface Rule {
    type: string;
    value?: string;
    name?: string;
    content?: Rule;
    members?: Rule[];
}

/** The strings `rule` can begin with; `null` stands for the empty match. */
function leadingStrings(rules: Record<string, Rule>, rule: Rule, seen: ReadonlySet<string>): Set<string | null> {
    switch (rule.type) {
        case "STRING":
            return new Set([rule.value!]);
        case "BLANK":
            return new Set([null]);
        case "SYMBOL": {
            if (seen.has(rule.name!)) return new Set();
            const target = rules[rule.name!];
            expect(target, `rule ${rule.name}`).toBeDefined();
            return leadingStrings(rules, target!, new Set([...seen, rule.name!]));
        }
        case "CHOICE":
            return new Set(rule.members!.flatMap((member) => [...leadingStrings(rules, member, seen)]));
        case "SEQ": {
            const out = new Set<string | null>();
            for (const member of rule.members!) {
                const first = leadingStrings(rules, member, seen);
                for (const word of first) if (word !== null) out.add(word);
                if (!first.has(null)) return out;
            }
            return out.add(null);
        }
        case "REPEAT":
            return new Set([...leadingStrings(rules, rule.content!, seen), null]);
        default:
            // REPEAT1, FIELD, ALIAS, TOKEN and the PREC family begin as their content does.
            expect(rule.content, `${rule.type} without content`).toBeDefined();
            return leadingStrings(rules, rule.content!, seen);
    }
}

/** The words the named top-level rules of `grammar` begin with. */
function grammarWords(grammar: string, names: readonly string[]): string[] {
    const json = readFileSync(path.join(GRAMMARS_DIR, grammar, "src/grammar.json"), "utf8");
    const rules = (JSON.parse(json) as { rules: Record<string, Rule> }).rules;
    const words = new Set<string>();
    for (const name of names) {
        const rule = rules[name];
        expect(rule, `rule ${name} in ${grammar}`).toBeDefined();
        for (const word of leadingStrings(rules, rule!, new Set([name]))) if (word !== null) words.add(word);
    }
    return [...words];
}

/** The quoted words of the scanner's BOUNDARY_WORDS. */
function scannerWords(grammar: string): string[] {
    const text = readFileSync(path.join(GRAMMARS_DIR, grammar, "src/scanner.c"), "utf8");
    const marker = "BOUNDARY_WORDS[] = {";
    const start = text.indexOf(marker);
    expect(start, `${marker} not found in ${grammar}`).toBeGreaterThanOrEqual(0);
    const body = text.slice(start + marker.length, text.indexOf("}", start));
    return [...body.matchAll(/"(\w+)"/g)].map((match) => match[1]!);
}

describe("unclosed-comment boundary words", () => {
    it.each([
        {
            grammar: "weidu-tp2",
            rules: [
                "backup_directive",
                "author_directive",
                "support_directive",
                "_top_level",
                "component",
                "action_define_function",
                "action_define_patch_function",
                "action_define_dimorphic_function",
                "action_define_macro",
                "action_define_patch_macro",
            ],
            // A block's END: the block being typed keeps it.
            extra: ["END"],
        },
        {
            grammar: "weidu-d",
            rules: ["_d_action"],
            // IF begins a state or a transition, and END closes a state or an action.
            extra: ["IF", "END"],
        },
    ])("match the top-level rules of $grammar", ({ grammar, rules, extra }) => {
        const expected = [...grammarWords(grammar, rules), ...extra].sort();
        expect(expected.length).toBeGreaterThan(extra.length);
        expect([...scannerWords(grammar)].sort()).toEqual(expected);
    });
});
