import { describe, expect, it, vi } from "vitest";

/** Only `window.createQuickPick` and the warning are reached; the fake below stands in for the widget. */
const created: FakeQuickPick[] = [];
const warned: string[] = [];
vi.mock("vscode", () => ({
    window: {
        createQuickPick: () => {
            const pick = makeFakeQuickPick();
            created.push(pick);
            return pick;
        },
        showWarningMessage: (message: string) => {
            warned.push(message);
        },
    },
}));

// Imported after vi.mock so the mocked vscode is in place.
import { pickStrref, strrefPickItems, type StrrefPickItem } from "../src/ie-resources/strref-picker";
import type { StrrefMatch } from "../src/ie-resources/game-lookups";

interface FakeQuickPick {
    title?: string;
    placeholder?: string;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    items: StrrefPickItem[];
    selectedItems: StrrefPickItem[];
    shown: boolean;
    disposed: number;
    onDidChangeValue: (handler: (value: string) => void) => void;
    onDidAccept: (handler: () => void) => void;
    onDidHide: (handler: () => void) => void;
    show: () => void;
    hide: () => void;
    dispose: () => void;
    type: (value: string) => void;
    accept: (item?: StrrefPickItem) => void;
    dismiss: () => void;
}

function makeFakeQuickPick(): FakeQuickPick {
    const handlers: { change?: (v: string) => void; accept?: () => void; hide?: () => void } = {};
    const pick: FakeQuickPick = {
        items: [],
        selectedItems: [],
        shown: false,
        disposed: 0,
        onDidChangeValue: (handler) => (handlers.change = handler),
        onDidAccept: (handler) => (handlers.accept = handler),
        onDidHide: (handler) => (handlers.hide = handler),
        show: () => {
            pick.shown = true;
        },
        // The real widget fires onDidHide whenever it leaves the screen, however it got there.
        hide: () => {
            pick.shown = false;
            handlers.hide?.();
        },
        dispose: () => {
            pick.disposed++;
        },
        type: (value) => handlers.change?.(value),
        accept: (item) => {
            if (item) pick.selectedItems = [item];
            handlers.accept?.();
        },
        dismiss: () => pick.hide(),
    };
    return pick;
}

const LINES: Record<number, string> = { 12: "Ring of Protection +1", 99: "", 6348: "Sword of Chaos" };
const lookup = (strref: number) => LINES[strref];

const matches: StrrefMatch[] = [
    { strref: 12, text: "Ring of Protection +1" },
    { strref: 6348, text: "Sword of Chaos" },
];

describe("strrefPickItems", () => {
    it("offers each match by its text, with the number that will be stored", () => {
        const items = strrefPickItems("ring", matches, lookup);
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ label: "Ring of Protection +1", description: "#12", strref: 12 });
        expect(items[1]).toMatchObject({ label: "Sword of Chaos", description: "#6348", strref: 6348 });
    });

    it("always shows its items, since the search already decided what matches", () => {
        // Without this the client re-filters the list against the typed text and hides hits that matched on
        // case or on a part of the string the typed text does not prefix.
        expect(strrefPickItems("ring", matches, lookup).every((item) => item.alwaysShow)).toBe(true);
    });

    it("offers the strref itself first when the query is a number, for someone who knows it", () => {
        const items = strrefPickItems("6348", [], lookup);
        expect(items[0]).toMatchObject({ label: "Sword of Chaos", description: "#6348", strref: 6348 });
    });

    it("does not offer a number twice when the text search found it too", () => {
        const items = strrefPickItems("6348", matches, lookup);
        expect(items.filter((item) => item.strref === 6348)).toHaveLength(1);
        expect(items[0]?.strref).toBe(6348);
    });

    it("offers a number whose entry is empty, labelling it rather than showing a blank row", () => {
        const items = strrefPickItems("99", [], lookup);
        expect(items[0]?.strref).toBe(99);
        expect(items[0]?.label).not.toBe("");
    });

    it("does not offer a number the string table has no entry for", () => {
        expect(strrefPickItems("999999", [], lookup)).toEqual([]);
    });

    it("treats a query that merely starts with digits as text, not a number", () => {
        expect(strrefPickItems("12 gauge", [], lookup)).toEqual([]);
    });

    it("shows a multi-line string on one row, so the list stays scannable", () => {
        const multiline: StrrefMatch[] = [{ strref: 1, text: "First line\nsecond line" }];
        expect(strrefPickItems("line", multiline, lookup)[0]?.label).toBe("First line second line");
    });
});

describe("pickStrref", () => {
    const uri = { scheme: "bgforge-game" } as never;
    const search = (_uri: unknown, query: string) =>
        matches.filter((match) => match.text.toLowerCase().includes(query.toLowerCase()));

    function open() {
        created.length = 0;
        warned.length = 0;
        const result = pickStrref(search as never, lookup, uri);
        return { result, pick: created[0]! };
    }

    it("says no game is open rather than showing an empty list that blames the query", async () => {
        created.length = 0;
        warned.length = 0;
        // What a closed game answers with: no strings for any query, the empty one included.
        const result = await pickStrref((() => []) as never, () => undefined, uri);
        expect(result).toBeUndefined();
        expect(warned).toHaveLength(1);
        expect(warned[0]).toMatch(/game/i);
        // No widget is created at all, so there is nothing on screen for the user to dismiss.
        expect(created).toHaveLength(0);
    });

    it("resolves to the chosen string's number", async () => {
        const { result, pick } = open();
        pick.accept(pick.items.find((item) => item.strref === 6348));
        await expect(result).resolves.toBe(6348);
    });

    it("resolves to undefined when dismissed without choosing", async () => {
        const { result, pick } = open();
        pick.dismiss();
        await expect(result).resolves.toBeUndefined();
    });

    it("re-runs the search as the query changes", () => {
        const { pick } = open();
        pick.type("sword");
        expect(pick.items.map((item) => item.strref)).toEqual([6348]);
        pick.type("ring");
        expect(pick.items.map((item) => item.strref)).toEqual([12]);
    });

    it("shows the table's opening strings before anything is typed", () => {
        const { pick } = open();
        expect(pick.items.map((item) => item.strref)).toEqual([12, 6348]);
        expect(pick.shown).toBe(true);
    });

    it("leaves the client's own filtering off, so a hit cannot be hidden twice over", () => {
        const { pick } = open();
        expect(pick.matchOnDescription).toBe(false);
        expect(pick.matchOnDetail).toBe(false);
    });

    it("disposes the widget exactly once, whether the pick was accepted or dismissed", async () => {
        const accepted = open();
        accepted.pick.accept(accepted.pick.items[0]);
        await accepted.result;
        expect(accepted.pick.disposed).toBe(1);

        const dismissed = open();
        dismissed.pick.dismiss();
        await dismissed.result;
        expect(dismissed.pick.disposed).toBe(1);
    });
});
