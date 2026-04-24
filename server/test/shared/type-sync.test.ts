/**
 * Validates that JSDoc type and tag lists in TextMate grammars, parser, and completions
 * stay in sync with the canonical lists in jsdoc-types.ts.
 *
 * Catches drift when types/tags are added/removed in one place but not the others.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
    ALL_JSDOC_TYPE_NAMES,
    CUSTOM_JSDOC_TYPE_NAMES,
    FALLOUT_JSDOC_TYPE_NAMES,
    JSDOC_PARAM_TAGS,
    JSDOC_RETURN_TAGS,
    WEIDU_JSDOC_TYPE_NAMES,
} from "../../src/shared/jsdoc-types";
import { WEIDU_JSDOC_TYPES } from "../../../shared/weidu-types";
import { FALLOUT_JSDOC_TYPES } from "../../src/shared/fallout-types";

const SYNTAXES_DIR = path.resolve(__dirname, "../../../syntaxes");

/** Extract type names from a regex alternation like \b(array|bool|int)\b in YAML content. */
function extractTypesFromRegex(content: string, pattern: RegExp): string[] {
    const types = new Set<string>();
    let match: RegExpExecArray | null;
    const globalPattern = new RegExp(pattern.source, "g");
    while ((match = globalPattern.exec(content)) !== null) {
        const alternation = match[1];
        for (const type of alternation!.split("|")) {
            types.add(type.trim());
        }
    }
    return [...types].sort();
}

describe("JSDoc type sync", () => {
    describe("docstring grammar matches canonical list", () => {
        const content = readFileSync(path.join(SYNTAXES_DIR, "bgforge-mls-docstring.tmLanguage.yml"), "utf-8");

        it("type repository contains exactly ALL_JSDOC_TYPE_NAMES", () => {
            // The #type repository has a single regex: \b(array|any|...|string)\b
            const typeRepoTypes = extractTypesFromRegex(content, /- match: \\b\(([^)]+)\)\\b/m);
            expect(typeRepoTypes).toEqual([...ALL_JSDOC_TYPE_NAMES].sort());
        });

        it("brace-less param pattern contains exactly ALL_JSDOC_TYPE_NAMES", () => {
            // The brace-less @param pattern has types in a regex alternation
            const paramLine = content.split("\n").find((l) => l.includes("@arg|@param)\\s+(") && !l.includes("{"));
            expect(paramLine).toBeDefined();
            const match = paramLine!.match(/\(([^)]+)\)\\s\+\(\\w\+\)/);
            expect(match).toBeTruthy();
            const types = match![1]!.split("|").sort();
            expect(types).toEqual([...ALL_JSDOC_TYPE_NAMES].sort());
        });

        it("brace-less ret patterns contain exactly ALL_JSDOC_TYPE_NAMES", () => {
            // Both braceless ret patterns (unnamed: @ret type\b, named: @ret type name)
            // must use the same type alternation as ALL_JSDOC_TYPE_NAMES.
            const retLines = content
                .split("\n")
                .filter((l) => l.includes("@ret|@return|@returns)\\s+(") && !l.includes("{"));
            expect(retLines.length).toBeGreaterThanOrEqual(1);
            for (const retLine of retLines) {
                const match = retLine.match(/\(@ret\|@return\|@returns\)\\s\+\(([^)]+)\)/);
                expect(match).toBeTruthy();
                const types = match![1]!.split("|").sort();
                expect(types).toEqual([...ALL_JSDOC_TYPE_NAMES].sort());
            }
        });
    });

    describe("weidu-types.ts keys match WEIDU_JSDOC_TYPE_NAMES", () => {
        it("WEIDU_JSDOC_TYPE_NAMES are a subset of WEIDU_JSDOC_TYPES keys", () => {
            for (const type of WEIDU_JSDOC_TYPE_NAMES) {
                expect(WEIDU_JSDOC_TYPES.has(type)).toBe(true);
            }
        });

        it("WEIDU_JSDOC_TYPES includes bit with int category metadata", () => {
            expect(WEIDU_JSDOC_TYPES.get("bit")).toEqual({
                detail: "Bit type",
                category: "int",
            });
        });

        it("WEIDU_JSDOC_TYPES extra keys are compound types only", () => {
            // Compound types (containing spaces, e.g. "resref offset") are valid in braced
            // @type annotations but not in braceless @param/@ret patterns, so they appear
            // in the completion map but not in the single-word type name list.
            const nameSet = new Set(WEIDU_JSDOC_TYPE_NAMES);
            const extraKeys = [...WEIDU_JSDOC_TYPES.keys()].filter((k) => !nameSet.has(k));
            for (const key of extraKeys) {
                expect(key).toContain(" ");
            }
        });
    });

    describe("fallout-types.ts keys match FALLOUT_JSDOC_TYPE_NAMES", () => {
        it("FALLOUT_JSDOC_TYPES map keys equal FALLOUT_JSDOC_TYPE_NAMES", () => {
            const mapKeys = [...FALLOUT_JSDOC_TYPES.keys()].sort();
            expect(mapKeys).toEqual([...FALLOUT_JSDOC_TYPE_NAMES].sort());
        });
    });

    describe("JSDoc tag sync", () => {
        const content = readFileSync(path.join(SYNTAXES_DIR, "bgforge-mls-docstring.tmLanguage.yml"), "utf-8");
        const parserContent = readFileSync(path.resolve(__dirname, "../../src/shared/jsdoc.ts"), "utf-8");

        it("grammar param patterns use exactly JSDOC_PARAM_TAGS", () => {
            // Grammar uses (@arg|@param) in match patterns
            const paramAlternations = content.match(/\(@([\w|@]+)\)/g) ?? [];
            const grammarParamTags = new Set<string>();
            for (const alt of paramAlternations) {
                const inner = alt.slice(1, -1); // strip parens
                for (const t of inner.split("|")) {
                    if (t.startsWith("@") && (t === "@arg" || t === "@param")) {
                        grammarParamTags.add(t.slice(1));
                    }
                }
            }
            expect([...grammarParamTags].sort()).toEqual([...JSDOC_PARAM_TAGS].sort());
        });

        it("grammar return patterns use exactly JSDOC_RETURN_TAGS", () => {
            const returnAlternations = content.match(/\(@([\w|@]+)\)/g) ?? [];
            const grammarReturnTags = new Set<string>();
            for (const alt of returnAlternations) {
                const inner = alt.slice(1, -1); // strip parens
                for (const t of inner.split("|")) {
                    if (t.startsWith("@") && (t === "@ret" || t === "@return" || t === "@returns")) {
                        grammarReturnTags.add(t.slice(1));
                    }
                }
            }
            expect([...grammarReturnTags].sort()).toEqual([...JSDOC_RETURN_TAGS].sort());
        });

        it("parser param patterns use exactly JSDOC_PARAM_TAGS", () => {
            // Parser uses @(?:arg|param) in regex patterns
            const matches = [...parserContent.matchAll(/@\(\?:(arg\|param|param\|arg)\)/g)];
            expect(matches.length).toBeGreaterThan(0);
            const parserTags = matches[0]![1]!.split("|").sort();
            expect(parserTags).toEqual([...JSDOC_PARAM_TAGS].sort());
        });

        it("parser return patterns use exactly JSDOC_RETURN_TAGS", () => {
            // Parser uses @(?:ret|return|returns) in regex patterns
            const matches = [...parserContent.matchAll(/@\(\?:([\w|]+)\)\\s/g)].filter((m) => m[1]!.includes("ret"));
            expect(matches.length).toBeGreaterThan(0);
            const parserTags = matches[0]![1]!.split("|").sort();
            expect(parserTags).toEqual([...JSDOC_RETURN_TAGS].sort());
        });

        it("completions offer exactly ALL_JSDOC_TAG_NAMES", () => {
            const completionContent = readFileSync(
                path.resolve(__dirname, "../../src/shared/jsdoc-completions.ts"),
                "utf-8",
            );
            // Completions use JSDOC_PARAM_TAGS, JSDOC_RETURN_TAGS, JSDOC_STANDALONE_TAGS
            // from the canonical source, so if it compiles, it's in sync.
            // But verify it actually imports all three tag lists.
            expect(completionContent).toContain("JSDOC_PARAM_TAGS");
            expect(completionContent).toContain("JSDOC_RETURN_TAGS");
            expect(completionContent).toContain("JSDOC_STANDALONE_TAGS");
        });
    });

    describe("canonical lists are consistent", () => {
        it("custom types are a subset of ALL_JSDOC_TYPE_NAMES", () => {
            for (const type of CUSTOM_JSDOC_TYPE_NAMES) {
                expect(ALL_JSDOC_TYPE_NAMES).toContain(type);
            }
        });

        it("fallout types are a subset of ALL_JSDOC_TYPE_NAMES", () => {
            for (const type of FALLOUT_JSDOC_TYPE_NAMES) {
                expect(ALL_JSDOC_TYPE_NAMES).toContain(type);
            }
        });

        it("weidu types are a subset of ALL_JSDOC_TYPE_NAMES", () => {
            for (const type of WEIDU_JSDOC_TYPE_NAMES) {
                expect(ALL_JSDOC_TYPE_NAMES).toContain(type);
            }
        });

        it("ALL_JSDOC_TYPE_NAMES has no duplicates", () => {
            const unique = new Set(ALL_JSDOC_TYPE_NAMES);
            expect(unique.size).toBe(ALL_JSDOC_TYPE_NAMES.length);
        });

        it("ALL_JSDOC_TYPE_NAMES is sorted", () => {
            const sorted = [...ALL_JSDOC_TYPE_NAMES].sort();
            expect(ALL_JSDOC_TYPE_NAMES).toEqual(sorted);
        });
    });
});
