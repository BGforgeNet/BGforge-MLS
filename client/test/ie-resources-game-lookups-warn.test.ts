/**
 * An install that cannot be read must not look exactly like "no game": each resolver still answers as if
 * there were none, but says why once per install in the output channel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ Uri: { from: (parts: unknown) => parts } }));

const { conlogMock } = vi.hoisted(() => ({ conlogMock: vi.fn() }));
vi.mock("../src/logging", () => ({ conlog: conlogMock }));

import {
    createEngineResolver,
    createResourceBytesResolver,
    createStrrefResolver,
    createStrrefSearch,
} from "../src/ie-resources/game-lookups";
import { GAME_RESOURCE_SCHEME } from "../src/ie-resources/uri";

const gameUri = (dir: string) =>
    ({ scheme: GAME_RESOURCE_SCHEME, path: "/SW1H01.itm", query: `g=${encodeURIComponent(dir)}` }) as never;

/** An install whose open fails, as a corrupt `chitin.key` does. */
const corrupt = {
    gameAt: (dir: string): never => {
        throw new Error(`bad chitin.key in ${dir}`);
    },
};

beforeEach(() => {
    conlogMock.mockClear();
});

describe("game lookups over an unreadable install", () => {
    it("answers as if there were no game, and warns once per install", () => {
        const resolve = createStrrefResolver(corrupt);

        expect(resolve(gameUri("/games/bg2"), 1)).toBeUndefined();
        expect(resolve(gameUri("/games/bg2"), 2)).toBeUndefined();
        expect(conlogMock.mock.calls).toEqual([
            ["ieResources: strref lookup cannot read the game at /games/bg2: bad chitin.key in /games/bg2", "warn"],
        ]);

        resolve(gameUri("/games/iwd"), 1);
        expect(conlogMock).toHaveBeenCalledTimes(2);
        expect(conlogMock).toHaveBeenLastCalledWith(
            "ieResources: strref lookup cannot read the game at /games/iwd: bad chitin.key in /games/iwd",
            "warn",
        );
    });

    it("warns for each resolver that fails, since each is a different lookup the user loses", () => {
        createStrrefResolver(corrupt)(gameUri("/games/bg2"), 1);
        createEngineResolver(corrupt)(gameUri("/games/bg2"));

        expect(conlogMock.mock.calls.map(([line]) => (line as string).split(" cannot")[0])).toEqual([
            "ieResources: strref lookup",
            "ieResources: engine lookup",
        ]);
    });

    it("warns for a failing async search too", async () => {
        const failingSearch = {
            gameAt: () => ({
                tlk: () => ({
                    get: () => undefined,
                    search: () => Promise.reject(new Error("truncated dialog.tlk")),
                }),
            }),
        } as never;

        expect(await createStrrefSearch(failingSearch)(gameUri("/games/bg2"), "ring")).toEqual([]);
        expect(conlogMock).toHaveBeenCalledWith(
            "ieResources: strref search cannot read the game at /games/bg2: truncated dialog.tlk",
            "warn",
        );
    });

    it("stays silent for a resource the install simply lacks", () => {
        const readable = {
            gameAt: () => ({
                read: (resref: string, ext: string): never => {
                    throw new Error(`no ${resref}.${ext}`);
                },
            }),
        } as never;

        expect(createResourceBytesResolver(readable)(gameUri("/games/bg2"), "MISSING", "BAM")).toBeUndefined();
        expect(conlogMock).not.toHaveBeenCalled();
    });

    it("stays silent when another install is open", () => {
        const elsewhere = { gameAt: () => undefined };

        expect(createStrrefResolver(elsewhere)(gameUri("/games/bg2"), 1)).toBeUndefined();
        expect(conlogMock).not.toHaveBeenCalled();
    });
});
