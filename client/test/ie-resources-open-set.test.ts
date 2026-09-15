/**
 * Opening a whole animation set, the one way both surfaces reach one: the gallery's open button and the
 * editor's own set picker. What it has to get right is the tab's identity - the label a reader recognises
 * in the path, and the id in the query, which is what actually decides which set opens.
 */
import { describe, expect, it, vi } from "vitest";
import type { AnimationSet } from "@bgforge/animation";

const { executeCommandMock } = vi.hoisted(() => ({ executeCommandMock: vi.fn() }));

vi.mock("vscode", () => ({
    Uri: {
        from: (parts: { scheme: string; path: string; query: string }) => parts,
    },
    commands: { executeCommand: executeCommandMock },
}));

const { openAnimationSet } = await import("../src/ie-resources/open-set");

const SET: AnimationSet = {
    id: 0x6004,
    code: "CLERIC_GNOME",
    name: "CLERIC_MALE_GNOME",
    prefixByArmour: new Map([[1, "CDMB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "character" },
};

/** The URI the last `vscode.open` was handed. */
function opened(): { scheme: string; path: string; query: string } {
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const [command, uri] = executeCommandMock.mock.calls[0] ?? [];
    expect(command).toBe("vscode.open");
    return uri as { scheme: string; path: string; query: string };
}

describe("openAnimationSet", () => {
    it("labels the tab with the set's own name, and carries the id", async () => {
        executeCommandMock.mockReset();

        await openAnimationSet(() => [SET], "/games/bgee", 0x6004);

        expect(opened()).toEqual({
            scheme: "bgforge-ie-resource",
            path: "/CLERIC_MALE_GNOME.animset",
            query: "g=%2Fgames%2Fbgee&a=6004",
        });
    });

    it("opens an id the install declares nothing for under its number", async () => {
        executeCommandMock.mockReset();

        await openAnimationSet(() => [SET], "/games/bgee", 0x9000);

        expect(opened().path).toBe("/9000.animset");
    });

    // An install whose animations cannot be listed at all is the same case as one declaring nothing:
    // the address is still openable, and the editor is where the reader learns there is no such set.
    it("opens by number when the install lists no animations", async () => {
        executeCommandMock.mockReset();

        await openAnimationSet(() => undefined, "/games/bgee", 0x6004);

        expect(opened().path).toBe("/6004.animset");
    });
});
