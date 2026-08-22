/**
 * Guard: IDENTIFIER_EXTRA_CHARS must match what each grammar's `identifier` rule actually accepts.
 *
 * The cursor word-scan in cursor-utils.ts is a second, regex-shaped statement of "what an identifier
 * looks like", separate from the grammar that owns that definition. Rather than resolve the duplication
 * architecturally (the scan also returns non-AST token forms like `tra(123)`, so it cannot simply read
 * the AST), this test pins the two together: for every candidate punctuation character it asks the real
 * parser whether `a<c>b` lexes as ONE identifier, and asserts the resulting set equals what the language
 * declares. A grammar widened without updating the map - or a map entry the grammar rejects - fails here.
 */

import { describe, expect, it, beforeAll } from "vitest";
import type { Node as SyntaxNode, Tree } from "web-tree-sitter";
import * as baf from "../../../shared/parsers/weidu-baf";
import * as d from "../../../shared/parsers/weidu-d";
import * as ssl from "../../../shared/parsers/fallout-ssl";
import * as tp2 from "../../../shared/parsers/weidu-tp2";
import { IDENTIFIER_EXTRA_CHARS } from "../../src/core/languages";
import { LANG_FALLOUT_SSL, LANG_WEIDU_BAF, LANG_WEIDU_D, LANG_WEIDU_TP2 } from "../../../shared/languages";

/** Every ASCII punctuation character a grammar could plausibly admit inside a name. */
const CANDIDATES = [..."-#$@!?.:;,'\"`~^&*+=/\\|<>%()[]{}"];

/** Wraps the candidate name in the smallest construct its language parses - none accept a bare name. */
interface LangCase {
    langId: string;
    parse: (text: string) => Tree | null;
    wrap: (name: string) => string;
}

const CASES: LangCase[] = [
    {
        langId: LANG_WEIDU_BAF,
        parse: baf.parseWithCache,
        wrap: (name) => `IF\n\tRace(Myself,${name})\nTHEN\n\tRESPONSE #100\n\t\tNoAction()\nEND\n`,
    },
    {
        langId: LANG_WEIDU_TP2,
        parse: tp2.parseWithCache,
        wrap: (name) => `BACKUP ~x~\nBEGIN ~t~\nLAUNCH_ACTION_MACRO ${name}\n`,
    },
    {
        langId: LANG_WEIDU_D,
        parse: d.parseWithCache,
        wrap: (name) => `BEGIN ~t~\nIF ~~ THEN BEGIN ${name}\n  SAY ~x~\n  IF ~~ THEN EXIT\nEND\n`,
    },
    {
        langId: LANG_FALLOUT_SSL,
        parse: ssl.parseWithCache,
        wrap: (name) => `procedure ${name} begin\nend\n`,
    },
];

/**
 * Node types the grammars use for a name. `state_label_alnum` is D's own, wider than its `identifier`
 * (state labels admit `.` and `-`) - the cursor scan is one flat regex with no idea which position it
 * is in, so it must span the widest name token a language can produce.
 */
const IDENTIFIER_TYPES = new Set(["identifier", "name", "state_label_alnum"]);

/** Depth-first search for a node of an identifier type whose text is exactly `name`. */
function findIdentifier(node: SyntaxNode, name: string): SyntaxNode | null {
    if (IDENTIFIER_TYPES.has(node.type) && node.text === name) {
        return node;
    }
    for (const child of node.children) {
        const found = child && findIdentifier(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

/** True when the grammar lexes `a<c>b` as a single identifier node - i.e. `c` belongs inside a name. */
function acceptsInsideName(testCase: LangCase, char: string): boolean {
    const name = `a${char}b`;
    const tree = testCase.parse(testCase.wrap(name));
    if (!tree || tree.rootNode.hasError) {
        return false;
    }
    return findIdentifier(tree.rootNode, name) !== null;
}

beforeAll(async () => {
    // One at a time: web-tree-sitter's shared transfer buffer forbids concurrent Language.load().
    await baf.initParser();
    await tp2.initParser();
    await d.initParser();
    await ssl.initParser();
});

describe("IDENTIFIER_EXTRA_CHARS matches the grammars", () => {
    it.each(CASES)("$langId declares exactly the characters its grammar admits", (testCase) => {
        const accepted = CANDIDATES.filter((char) => acceptsInsideName(testCase, char));
        const declared = [...(IDENTIFIER_EXTRA_CHARS[testCase.langId] ?? "")];

        expect(accepted.sort()).toEqual(declared.sort());
    });

    // The probe is only evidence if it can come back both ways: a broken wrapper would report an
    // empty accepted set for every language and the assertion above would then merely pin "declares
    // nothing" for the languages that declare nothing.
    it.each(CASES)("$langId: the probe accepts a plain name and rejects an obvious separator", (testCase) => {
        expect(acceptsInsideName(testCase, "_")).toBe(true);
        expect(acceptsInsideName(testCase, " ")).toBe(false);
    });
});
