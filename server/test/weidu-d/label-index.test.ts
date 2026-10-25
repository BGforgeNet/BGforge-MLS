/**
 * State labels through every language feature that keys on them: definition, references, rename, the document
 * outline and the workspace index. Each case is a label shape WeiDU resolves, so the features must agree on it:
 * states in a REPLACE block, a label written quoted in one place and bare in another, a CHAIN's entry label, and
 * the labels a CHAIN epilogue or a patch action's state list names.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Location, Position, Range } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "@bgforge/shared/parsers/weidu-d";
import { getDefinition } from "../../src/weidu-d/definition";
import { findReferences } from "../../src/weidu-d/references";
import { prepareRenameSymbol, renameSymbol } from "../../src/weidu-d/rename";
import { getDocumentSymbols } from "../../src/weidu-d/symbol";
import { parseFile } from "../../src/weidu-d/file-parser";
import { FileIndex } from "../../src/core/file-index";
import { normalizeUri } from "../../src/core/normalized-uri";

const URI = "file:///test.d";

beforeAll(async () => {
    await initParser();
});

/** Position of the `nth` occurrence of `needle` in `text`, `offset` characters in. */
function at(text: string, needle: string, nth = 0, offset = 0): Position {
    let index = -1;
    for (let i = 0; i <= nth; i++) {
        index = text.indexOf(needle, index + 1);
        if (index < 0) throw new Error(`occurrence ${nth} of ${needle} not found`);
    }
    const before = text.slice(0, index + offset);
    const line = before.split("\n").length - 1;
    return { line, character: before.length - before.lastIndexOf("\n") - 1 };
}

/** The text a range covers. */
function textOf(text: string, range: Range): string {
    const lines = text.split("\n");
    if (range.start.line !== range.end.line) throw new Error("multi-line range");
    return lines[range.start.line]!.slice(range.start.character, range.end.character);
}

/** Apply a rename's edits and return the new text. */
function applyRename(text: string, position: Position, newName: string): string {
    const edits = renameSymbol(text, position, newName, URI)?.changes?.[URI];
    if (!edits) throw new Error("rename returned no edits");
    const lines = text.split("\n");
    const sorted = [...edits].sort(
        (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character,
    );
    for (const edit of sorted) {
        const line = lines[edit.range.start.line]!;
        lines[edit.range.start.line] =
            line.slice(0, edit.range.start.character) + edit.newText + line.slice(edit.range.end.character);
    }
    return lines.join("\n");
}

/** Each reference as `line:text`, in source order. */
function refsAt(text: string, position: Position): string[] {
    return findReferences(text, position, URI, true)
        .map((loc) => loc.range)
        .sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character)
        .map((range) => `${range.start.line}:${textOf(text, range)}`);
}

describe("states in a REPLACE block", () => {
    const text = [
        "BEGIN ~x~",
        "IF ~~ THEN BEGIN q3 SAY ~q~ IF ~~ THEN EXIT END",
        "REPLACE ~dlg~",
        "IF ~~ THEN BEGIN r1 SAY ~a~ IF ~~ THEN GOTO r2 END",
        "IF ~~ THEN BEGIN r2 SAY ~b~ IF ~~ THEN EXTERN ~x~ q3 END",
        "END",
    ].join("\n");

    it("go to definition jumps from a GOTO to the state", () => {
        const def = getDefinition(text, URI, at(text, "GOTO r2", 0, 5));
        expect(def?.range.start).toEqual(at(text, "r2 SAY"));
    });

    it("references find the state and its GOTO", () => {
        expect(refsAt(text, at(text, "r2 SAY"))).toEqual(["3:r2", "4:r2"]);
    });

    it("an EXTERN inside the block is a reference to the other dialog's state", () => {
        expect(refsAt(text, at(text, "q3 SAY"))).toEqual(["1:q3", "4:q3"]);
    });

    it("rename edits the state and its GOTO", () => {
        expect(applyRename(text, at(text, "r2 SAY"), "zz")).toBe(text.replaceAll("r2", "zz"));
    });

    it("the workspace index holds the state", () => {
        const names = parseFile(URI, text).symbols.map((s) => s.name);
        expect(names).toEqual(["x:q3", "dlg:r1", "dlg:r2"]);
    });
});

describe("a label written quoted and bare is one label", () => {
    const text = [
        "BEGIN ~dlg~",
        "IF ~~ THEN BEGIN ~q1~ SAY ~a~ IF ~~ THEN GOTO q1 END",
        "IF ~~ THEN BEGIN q2 SAY ~b~ IF ~~ THEN GOTO ~q2~ END",
    ].join("\n");

    it("go to definition jumps from a bare GOTO to a quoted label", () => {
        const def = getDefinition(text, URI, at(text, "GOTO q1", 0, 5));
        expect(def?.range.start).toEqual(at(text, "~q1~"));
    });

    it("go to definition jumps from a quoted GOTO to a bare label", () => {
        const def = getDefinition(text, URI, at(text, "~q2~", 0, 1));
        expect(def?.range.start).toEqual(at(text, "q2 SAY"));
    });

    it("rename keeps the quotes and changes the name inside them", () => {
        expect(applyRename(text, at(text, "q2 SAY"), "zz")).toBe(
            text.replace("q2 SAY", "zz SAY").replace("~q2~", "~zz~"),
        );
    });

    it("the outline and the index name the label without its quotes", () => {
        expect(getDocumentSymbols(text).map((s) => s.name)).toEqual(["q1", "q2"]);
        expect(parseFile(URI, text).symbols.map((s) => s.name)).toEqual(["dlg:q1", "dlg:q2"]);
    });
});

describe("a CHAIN's entry label defines a state", () => {
    const text = [
        "BEGIN ~dlg~",
        "IF ~~ THEN BEGIN s1 SAY ~a~ IF ~~ THEN GOTO c1 END",
        "CHAIN ~dlg~ c1 ~x~ EXIT",
        "CHAIN IF ~t~ THEN ~dlg~ c2 ~y~ END ~dlg~ c1",
        "INTERJECT ~dlg~ s1 v == ~b~ ~z~ END ~dlg~ c2",
    ].join("\n");

    it("go to definition jumps from a GOTO to the CHAIN label", () => {
        const def = getDefinition(text, URI, at(text, "GOTO c1", 0, 5));
        expect(def?.range.start).toEqual(at(text, "c1 ~x~"));
    });

    it("the outline and the index list both CHAIN labels, not the INTERJECT's", () => {
        expect(getDocumentSymbols(text).map((s) => s.name)).toEqual(["s1", "c1", "c2"]);
        expect(parseFile(URI, text).symbols.map((s) => s.name)).toEqual(["dlg:s1", "dlg:c1", "dlg:c2"]);
    });

    it("an INTERJECT's label is a reference to the state it interjects into", () => {
        expect(refsAt(text, at(text, "s1 SAY"))).toEqual(["1:s1", "4:s1"]);
    });
});

describe("labels named by a CHAIN epilogue and by patch actions", () => {
    const text = [
        "BEGIN ~dlg~",
        "IF ~~ THEN BEGIN s1 SAY ~a~ IF ~~ THEN EXIT END",
        "IF ~~ THEN BEGIN s2 SAY ~b~ IF ~~ THEN EXIT END",
        "CHAIN ~dlg~ c1 ~x~ END IF ~~ THEN GOTO s1 IF ~~ THEN + s2",
        "ALTER_TRANS ~dlg~ BEGIN s1 s2 END BEGIN 0 END BEGIN TRIGGER ~x~ END",
        "ADD_STATE_TRIGGER ~dlg~ s1 ~t~ s2",
        "ADD_TRANS_ACTION ~dlg~ BEGIN s2 END BEGIN 0 END ~a~",
        "REPLACE_TRANS_TRIGGER ~dlg~ BEGIN s2 END BEGIN 0 END ~o~ ~n~",
    ].join("\n");

    it("references reach the epilogue's GOTO and every state list", () => {
        expect(refsAt(text, at(text, "s1 SAY"))).toEqual(["1:s1", "3:s1", "4:s1", "5:s1"]);
        expect(refsAt(text, at(text, "s2 SAY"))).toEqual(["2:s2", "3:s2", "4:s2", "5:s2", "6:s2", "7:s2"]);
    });

    it("rename leaves no label behind", () => {
        expect(applyRename(text, at(text, "s2 SAY"), "zz")).toBe(text.replaceAll("s2", "zz"));
    });
});

describe("a label defined in another file", () => {
    const defUri = "file:///def.d";
    const defText = "BEGIN ~dlgz~\nIF ~~ THEN BEGIN zz SAY ~a~ IF ~~ THEN EXIT END\n";
    const useText = "BEGIN ~me~\nIF ~~ THEN BEGIN m1 SAY ~b~ IF ~~ THEN EXTERN ~dlgz~ zz END\n";

    function indexOf(...files: [string, string][]): FileIndex {
        const index = new FileIndex("weidu-d");
        for (const [uri, text] of files) index.updateFile(normalizeUri(uri), parseFile(uri, text));
        return index;
    }

    it("go to definition jumps to the other file", () => {
        const index = indexOf([defUri, defText], [URI, useText]);
        const def = getDefinition(useText, URI, at(useText, "zz", 0, 1), (key) => index.symbols.lookupDefinition(key));
        expect(def).toEqual<Location>({
            uri: defUri,
            range: { start: at(defText, "zz SAY"), end: at(defText, "zz SAY", 0, 2) },
        });
    });

    it("references keep the reference under the cursor beside the other file's", () => {
        const index = indexOf([defUri, defText], [URI, useText]);
        const refs = findReferences(useText, at(useText, "zz", 0, 1), URI, true, index.refs);
        expect(refs.map((loc) => [loc.uri, loc.range.start.line]).sort()).toEqual([
            [defUri, 1],
            [URI, 1],
        ]);
    });
});

describe("rename accepts every bare label WeiDU accepts", () => {
    const text = "BEGIN ~dlg~\nIF ~~ THEN BEGIN s1 SAY ~a~ IF ~~ THEN GOTO s1 END\n";
    const position = at(text, "s1");

    it.each(["100", "4a", "KHPC1.1", "Quayle_Shar-Teel_1", "RR#ZA00"])("renames to %s", (name) => {
        expect(prepareRenameSymbol(text, position)?.placeholder).toBe("s1");
        expect(applyRename(text, position, name)).toBe(text.replaceAll("s1", name));
    });

    it.each(["END", "GOTO", "a b", "", "~x~"])("refuses %j", (name) => {
        expect(renameSymbol(text, position, name, URI)).toBeNull();
    });
});
