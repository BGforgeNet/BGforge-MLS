/**
 * The game-resource filesystem bridge, and the confirmation that guards a destructive save.
 *
 * Every editor's write into an open game - the decompiled-script view, the binary editor, the dialog editor -
 * arrives here, so this is where "replacing a file in override needs the user's consent" is decided once for
 * all of them. The cases below are as much about when the prompt STAYS AWAY as when it appears: a guard that
 * interrupts an ordinary save is one people learn to click through.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
    class FakeUri {
        readonly scheme: string;
        readonly path: string;
        readonly query: string;
        constructor(scheme: string, uriPath: string, query = "") {
            this.scheme = scheme;
            this.path = uriPath;
            this.query = query;
        }
        get fsPath() {
            return this.path;
        }
        toString() {
            return this.query ? `${this.scheme}:${this.path}?${this.query}` : `${this.scheme}:${this.path}`;
        }
    }
    /** Answers the modal with this label, or undefined for a dismissal. */
    const warning = { answer: undefined as string | undefined, calls: [] as { message: string; detail: string }[] };
    return { FakeUri, warning };
});

vi.mock("vscode", () => {
    class FileSystemError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "FileSystemError";
        }
        static FileNotFound(uri: unknown) {
            return new FileSystemError(`FileNotFound: ${String(uri)}`);
        }
    }
    return {
        Uri: h.FakeUri,
        EventEmitter: class {
            event = () => ({ dispose() {} });
            fire() {}
            dispose() {}
        },
        Disposable: class {
            dispose() {}
        },
        FileSystemError,
        FileType: { File: 1 },
        FileChangeType: { Changed: 1 },
        window: {
            showWarningMessage: (message: string, options: { detail: string }, ..._items: string[]) => {
                h.warning.calls.push({ message, detail: options.detail });
                return Promise.resolve(h.warning.answer);
            },
        },
    };
});

vi.mock("../src/logging", () => ({ conlog: () => {} }));

const { GameResourceFileSystemProvider } = await import("../src/ie-resources/fs-provider");

const GAME_DIR = "/games/bg2";
const BYTES = Uint8Array.from([1, 2, 3]);

/** A stand-in game recording what was written, with `looseFile`/`auxFile` under the test's control. */
function fakeGame(existing: { loose?: string; aux?: string } = {}) {
    const writes: string[] = [];
    return {
        writes,
        game: {
            looseFile: () => existing.loose,
            auxFile: () => existing.aux,
            write: (resref: string, type: number | string) => writes.push(`resource:${resref}.${String(type)}`),
            writeAuxFile: (name: string) => writes.push(`aux:${name}`),
            read: () => BYTES,
            readAuxFile: () => BYTES,
        } as never,
    };
}

function provider(game: unknown) {
    return new GameResourceFileSystemProvider({ gameAt: () => game } as never);
}

/** `itm` resolves to a resType, so it takes the resource path; `json` has none and is an aux sidecar. */
const uri = (name: string) => new h.FakeUri("bgforge-ie-resource", `/${name}`, `g=${GAME_DIR}`) as never;

describe("writing a game resource", () => {
    beforeEach(() => {
        h.warning.answer = undefined;
        h.warning.calls.length = 0;
    });

    it("writes with no prompt when nothing in override would be replaced", async () => {
        // The common case by far: the resource lives in a BIF, and the write creates an override copy that
        // shadows it. Nothing is destroyed - the archive still holds the original - so nothing is asked.
        const { game, writes } = fakeGame();
        await provider(game).writeFile(uri("item01.itm"), BYTES);

        expect(h.warning.calls).toEqual([]);
        expect(writes).toEqual(["resource:item01.1005"]);
    });

    it("asks before replacing a file already in override, and writes once confirmed", async () => {
        const { game, writes } = fakeGame({ loose: `${GAME_DIR}/override/item01.itm` });
        h.warning.answer = "Overwrite";
        await provider(game).writeFile(uri("item01.itm"), BYTES);

        expect(h.warning.calls).toHaveLength(1);
        expect(h.warning.calls[0]!.message).toContain("item01.itm");
        // The path is in the prompt: which of several installs, and which folder, is the whole question.
        expect(h.warning.calls[0]!.detail).toContain(`${GAME_DIR}/override/item01.itm`);
        expect(writes).toEqual(["resource:item01.1005"]);
    });

    it("writes nothing and fails the save when the prompt is dismissed", async () => {
        // Failing is the point: returning quietly would leave the tab clean over a file that never changed,
        // and the edit would be gone with nothing said.
        const { game, writes } = fakeGame({ loose: `${GAME_DIR}/override/item01.itm` });
        h.warning.answer = undefined;

        await expect(provider(game).writeFile(uri("item01.itm"), BYTES)).rejects.toThrow(/Save cancelled/);
        expect(writes).toEqual([]);
    });

    it("asks once per file, not on every save of it", async () => {
        // After the first confirmation the file in override is the one WE wrote, so re-asking would be
        // interrupting a save to warn about our own previous save.
        const { game, writes } = fakeGame({ loose: `${GAME_DIR}/override/item01.itm` });
        h.warning.answer = "Overwrite";
        const files = provider(game);

        await files.writeFile(uri("item01.itm"), BYTES);
        await files.writeFile(uri("item01.itm"), BYTES);
        await files.writeFile(uri("item01.itm"), BYTES);

        expect(h.warning.calls).toHaveLength(1);
        expect(writes).toHaveLength(3);
    });

    it("asks again for a different resource in the same session", async () => {
        const { game } = fakeGame({ loose: `${GAME_DIR}/override/whatever.itm` });
        h.warning.answer = "Overwrite";
        const files = provider(game);

        await files.writeFile(uri("item01.itm"), BYTES);
        await files.writeFile(uri("item02.itm"), BYTES);

        expect(h.warning.calls).toHaveLength(2);
    });

    it("asks again once the open game changes", async () => {
        // A different install has a different override folder, so consent given for one says nothing about
        // the file of the same name in the other.
        const { game } = fakeGame({ loose: `${GAME_DIR}/override/item01.itm` });
        h.warning.answer = "Overwrite";
        const files = provider(game);

        await files.writeFile(uri("item01.itm"), BYTES);
        files.clearCache();
        await files.writeFile(uri("item01.itm"), BYTES);

        expect(h.warning.calls).toHaveLength(2);
    });

    it("guards a sidecar the same way, since it lands in override too", async () => {
        // A `.json` snapshot has no resType, so it is written as a raw aux file - a different call, the same
        // folder and the same risk of replacing something another tool left there.
        const { game, writes } = fakeGame({ aux: `${GAME_DIR}/override/item01.json` });
        h.warning.answer = "Overwrite";
        await provider(game).writeFile(uri("item01.json"), BYTES);

        expect(h.warning.calls).toHaveLength(1);
        expect(writes).toEqual(["aux:item01.json"]);
    });
});
