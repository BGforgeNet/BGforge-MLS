/**
 * Parse time on block comments that never close, through the real parser modules.
 *
 * An opener with no closer is known to be unclosed only at the end of the input. A lexer that gives up there and is
 * asked again at the next unclosed opener re-reads the same tail per opener: a run of them takes time quadratic in its
 * length. That holds for a nesting comment read by an external scanner and for a regex comment token alike, and also
 * where the parser recovers between the openers rather than inside the run. Before the fix each input below took over
 * 20 times the bound, except the one-per-item inputs of the nesting grammars: those took a few times the bound in a
 * scanner that ended each comment at its item but still read to the end of the input for every opener.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
import * as ssl from "@bgforge/shared/parsers/fallout-ssl";
import * as baf from "@bgforge/shared/parsers/weidu-baf";
import * as d from "@bgforge/shared/parsers/weidu-d";
import * as tp2 from "@bgforge/shared/parsers/weidu-tp2";

/** Generous for a linear parse of the inputs below, which takes a few milliseconds. */
const BOUND_MS = 500;

interface ParserModule {
    initParser: () => Promise<void>;
    parseWithCache: (text: string) => { rootNode: { hasError: boolean } } | null;
}

interface Input {
    readonly name: string;
    readonly text: string;
}

interface Case {
    readonly grammar: string;
    readonly mod: ParserModule;
    /** A small valid input, parsed first so the timed parse does not pay for compiling the grammar's lexer. */
    readonly warmup: string;
    readonly inputs: readonly Input[];
}

/** Sized per grammar, since each grammar's quadratic cost per opener differs. */
const openerRun = (count: number): Input => ({ name: "a long run of unclosed openers", text: "/* ".repeat(count) });

const CASES: readonly Case[] = [
    {
        grammar: "weidu-tp2",
        mod: tp2,
        warmup: "BACKUP ~a~\n",
        inputs: [
            openerRun(5000),
            // `/` is a valid token after a value, so the parser recovers between the openers, outside the run.
            { name: "unclosed openers after a value", text: `AUTHOR ~a~ ${"/* a ".repeat(11000)}` },
            // Each unclosed comment ends before the next component, so each opener is a separate scan.
            { name: "one unclosed opener per component", text: "BEGIN ~c~\nCOPY ~x~ ~y~ /* a\n".repeat(1500) },
            // A closer below pairs with a later opener, never with these, but each opener has to know that.
            {
                name: "one unclosed opener per component, a closed comment below",
                text: `${"BEGIN ~c~\n/* a\n".repeat(5000)}/* closed */\n`,
            },
            {
                name: "one unclosed opener per component, each holding a closed comment",
                text: "BEGIN ~c~\n/* a /* b */\n".repeat(5000),
            },
        ],
    },
    {
        grammar: "weidu-d",
        mod: d,
        warmup: "BEGIN a\n",
        inputs: [
            openerRun(5000),
            // The parser recovers between the openers here, outside the run.
            { name: "unclosed openers after a dialog header", text: `BEGIN ~d~ ${"/* a ".repeat(5500)}` },
            {
                name: "one unclosed opener per state, a closed comment below",
                text: `BEGIN ~d~\n${"IF ~~ s\nSAY ~x~ /* a\nEND\n".repeat(4500)}/* closed */\n`,
            },
        ],
    },
    {
        grammar: "weidu-baf",
        mod: baf,
        warmup: "IF\n  True()\nTHEN\n  RESPONSE #100\n    NoAction()\nEND\n",
        inputs: [
            openerRun(14000),
            // Each unclosed comment ends before its block's END, so each opener is a separate scan.
            {
                name: "one unclosed opener per block",
                text: "IF\n  True()\nTHEN\n  RESPONSE #100\n    NoAction() /* a\nEND\n".repeat(2000),
            },
            {
                name: "one unclosed opener per block, a closed comment below",
                text: `${"IF\n  True()\nTHEN\n  RESPONSE #100\n    NoAction() /* a\nEND\n".repeat(2600)}/* closed */\n`,
            },
        ],
    },
    {
        grammar: "fallout-ssl",
        mod: ssl,
        warmup: "procedure start begin end\n",
        inputs: [
            openerRun(14000),
            // Each unclosed comment ends before its procedure's `end`, so each opener is a separate scan.
            { name: "one unclosed opener per procedure", text: "procedure p begin\n  /* a\nend\n".repeat(2500) },
        ],
    },
];

for (const { grammar, mod, warmup, inputs } of CASES) {
    describe(`${grammar}: unclosed block comments`, () => {
        beforeAll(async () => {
            await mod.initParser();
            mod.parseWithCache(warmup);
        });

        for (const { name, text } of inputs) {
            it(`parses ${name} in linear time, still reporting the error`, () => {
                let tree: ReturnType<ParserModule["parseWithCache"]> | undefined;
                const elapsed = cpuTimeMs(() => {
                    tree = mod.parseWithCache(text);
                });

                expect(tree?.rootNode.hasError).toBe(true);
                expect(elapsed).toBeLessThan(BOUND_MS);
            });
        }
    });
}
