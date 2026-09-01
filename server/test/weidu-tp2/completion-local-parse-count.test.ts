/**
 * One completion request parses the document's local symbols once, however many items it decorates.
 *
 * `applySnippets` needs a symbol per candidate, and the obvious shape - look each one up as you map - is
 * quadratic whenever the lookup cannot use its cache, which is every call whose document version is unknown
 * (`TextCache.getOrParse` bypasses the cache on `undefined`). It then re-parses the whole file per item: a
 * request against EET's 159KB `macros.tph` measured 7.4s, 93% of it in that repeated parse.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

const parses = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

// Counts the real parse rather than replacing it: the assertion is how OFTEN the document is parsed, and a
// stub would remove the local symbols the request under test is meant to decorate.
vi.mock("../../src/weidu-tp2/header-parser", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/weidu-tp2/header-parser")>();
    return {
        ...actual,
        parseFile: (...args: Parameters<typeof actual.parseFile>) => {
            parses.count++;
            return actual.parseFile(...args);
        },
    };
});

import { initParser } from "../../../shared/parsers/weidu-tp2";
import { normalizeUri } from "../../src/core/normalized-uri";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";

const URI = normalizeUri("file:///parse-count.tp2");

/** Enough local functions that a per-item parse is unmistakable in the count. */
const LOCAL_FUNCTIONS = 30;
const LINES_PER_FUNCTION = 4;
const TEXT = `${Array.from(
    { length: LOCAL_FUNCTIONS },
    (_, i) => `DEFINE_ACTION_FUNCTION local_f_${i}\nBEGIN\n  OUTER_SET local_v_${i} = 1\nEND\n`,
).join("")}COPY_EXISTING ~a.itm~ ~override~\n`;

/** The start of a structural keyword - the code position the corpus sweep probes. */
const CODE_POSITION = { line: LOCAL_FUNCTIONS * LINES_PER_FUNCTION, character: 0 };

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2 completion cost", () => {
    it("parses local symbols once per request, not once per completion item", () => {
        parses.count = 0;
        // No document version, as every caller outside an open editor session has: the cache cannot absorb
        // a repeated lookup, so the count is exactly how many times the code asked for the parse.
        const items = weiduTp2Provider.filterCompletions!([], TEXT, CODE_POSITION, URI);

        // Not vacuous: the request must actually have items to decorate, or one parse proves nothing.
        expect(items.filter((item) => item.label.startsWith("local_f_"))).toHaveLength(LOCAL_FUNCTIONS);
        expect(parses.count).toBe(1);
    });
});
