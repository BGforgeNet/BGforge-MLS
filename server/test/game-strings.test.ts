import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Tlk } from "@bgforge/binary/archive";

const warn = vi.fn();
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({ console: { log: vi.fn(), warn, error: vi.fn() } }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { GameStrings, type GameOpener } from "../src/ie-resources/game-strings";

/** A Tlk over a fixed string list; anything past the end is out of range, as a real TLK reports it. */
function fakeTlk(strings: string[]): Tlk {
    return {
        count: strings.length,
        languageId: 0,
        get: (strref) => (strref >= 0 && strref < strings.length ? strings[strref] : undefined),
        close: () => undefined,
    };
}

interface Opened {
    dir: string;
    encoding: string | undefined;
    closed: boolean;
}

/** Records every open so the tests can assert on reuse, re-open and close, and drive the failure paths. */
function harness(options: { strings?: string[]; tlk?: boolean; throwFor?: string } = {}) {
    const opens: Opened[] = [];
    const opener: GameOpener = (dir, encoding) => {
        if (options.throwFor !== undefined && dir === options.throwFor) {
            throw new Error(`chitin.key not found in ${dir}`);
        }
        const record: Opened = { dir, encoding, closed: false };
        opens.push(record);
        const tlk = options.tlk === false ? undefined : fakeTlk(options.strings ?? ["zero", "one", "two"]);
        return {
            tlk: () => tlk,
            close: () => {
                record.closed = true;
            },
        } as unknown as Game;
    };
    return { opens, opener };
}

const weidu = (gamePath: string, tlkEncoding = "") => ({ gamePath, tlkEncoding });

describe("GameStrings", () => {
    beforeEach(() => warn.mockClear());

    it("resolves a strref through the game's string table", () => {
        const h = harness({ strings: ["Gorion", "Imoen"] });
        const strings = new GameStrings(h.opener);
        expect(strings.resolve(1, weidu("/game"))).toBe("Imoen");
    });

    it("returns undefined when no game path is configured", () => {
        const h = harness();
        const strings = new GameStrings(h.opener);
        expect(strings.resolve(0, weidu(""))).toBeUndefined();
        expect(h.opens).toHaveLength(0);
    });

    it("opens the game once and reuses it across lookups", () => {
        const h = harness();
        const strings = new GameStrings(h.opener);
        strings.resolve(0, weidu("/game"));
        strings.resolve(1, weidu("/game"));
        strings.resolve(2, weidu("/game"));
        expect(h.opens).toHaveLength(1);
    });

    it("re-opens, closing the old game, when the game path changes", () => {
        const h = harness();
        const strings = new GameStrings(h.opener);
        strings.resolve(0, weidu("/bg1"));
        strings.resolve(0, weidu("/bg2"));
        expect(h.opens.map((o) => o.dir)).toEqual(["/bg1", "/bg2"]);
        expect(h.opens[0]?.closed).toBe(true);
    });

    it("re-opens when only the encoding changes, so correcting it takes effect without a restart", () => {
        const h = harness();
        const strings = new GameStrings(h.opener);
        strings.resolve(0, weidu("/game"));
        strings.resolve(0, weidu("/game", "windows-1251"));
        expect(h.opens.map((o) => o.encoding)).toEqual([undefined, "windows-1251"]);
    });

    it("passes an unset encoding as undefined, leaving the edition default to the library", () => {
        const h = harness();
        new GameStrings(h.opener).resolve(0, weidu("/game", ""));
        expect(h.opens[0]?.encoding).toBeUndefined();
    });

    it("returns undefined for a strref the table does not hold", () => {
        const h = harness({ strings: ["only"] });
        expect(new GameStrings(h.opener).resolve(9, weidu("/game"))).toBeUndefined();
    });

    it("returns undefined when the game has no string table", () => {
        const h = harness({ tlk: false });
        expect(new GameStrings(h.opener).resolve(0, weidu("/game"))).toBeUndefined();
    });

    it("degrades to undefined when the game cannot be opened, without retrying every lookup", () => {
        const h = harness({ throwFor: "/broken" });
        const strings = new GameStrings(h.opener);
        expect(strings.resolve(0, weidu("/broken"))).toBeUndefined();
        expect(strings.resolve(1, weidu("/broken"))).toBeUndefined();
        expect(h.opens).toHaveLength(0);
        // The path is reported once, not once per lookup - a document full of strrefs must not flood the log.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("/broken");
    });

    it("retries after a failed open once the game path changes", () => {
        const h = harness({ throwFor: "/broken" });
        const strings = new GameStrings(h.opener);
        strings.resolve(0, weidu("/broken"));
        expect(strings.resolve(0, weidu("/game"))).toBe("zero");
    });

    it("closes the open game on dispose", () => {
        const h = harness();
        const strings = new GameStrings(h.opener);
        strings.resolve(0, weidu("/game"));
        strings.dispose();
        expect(h.opens[0]?.closed).toBe(true);
    });
});
