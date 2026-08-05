/**
 * Inside a TP2 string only a `%var%` interpolation is valid, so completion there narrows to the variables.
 *
 * The selection is by CATEGORY rather than by completion kind, and this suite pins that: `looksLikeConstant`
 * gives an uppercase name the constant ICON, so a kind-based filter would drop `MOD_FOLDER` and every other
 * automatic - exactly the names interpolated into a path.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { type Position, CompletionItemKind } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { CompletionCategory, type Tp2CompletionItem } from "../../src/weidu-tp2/completion/types";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

const URI = normalizeUri("file:///t.tp2");

// The static and indexed halves of what getCompletions returns, one item each: a WeiDU automatic (uppercase,
// so it carries the constant icon), a variable indexed from another file, and an action that is not a variable.
const ITEMS: Tp2CompletionItem[] = [
    { label: "MOD_FOLDER", kind: CompletionItemKind.Constant, category: CompletionCategory.Vars },
    { label: "other_file_var", kind: CompletionItemKind.Variable, category: CompletionCategory.Vars },
    { label: "COPY_EXISTING", kind: CompletionItemKind.Function, category: CompletionCategory.Action },
];

const lines = [
    "BACKUP ~probe/backup~",
    "",
    "OUTER_SET my_counter = 3",
    "OUTER_SPRINT my_folder ~probe~",
    "",
    "BEGIN ~Probe component~",
    "COPY ~probe/x.itm~ ~override/x.itm~",
];
const text = lines.join("\n");
function at(line: number, token: string): Position {
    const source = lines[line];
    if (source === undefined) throw new Error(`no line ${line}`);
    const index = source.indexOf(token);
    if (index === -1) throw new Error(`no ${token} on line ${line}`);
    return { line, character: index + 1 };
}
const labelsAt = (position: Position): unknown[] =>
    (weiduTp2Provider.filterCompletions?.(ITEMS, text, position, URI) ?? []).map((item) => item.label);

describe("weidu-tp2 completion inside a string", () => {
    it("keeps the WeiDU automatic variables, whose uppercase names carry the constant icon", () => {
        expect(labelsAt(at(6, "override"))).toContain("MOD_FOLDER");
    });

    it("keeps a variable indexed from another file", () => {
        expect(labelsAt(at(6, "override"))).toContain("other_file_var");
    });

    it("keeps this file's own variables", () => {
        const labels = labelsAt(at(6, "override"));

        expect(labels).toContain("my_counter");
        expect(labels).toContain("my_folder");
    });

    it("drops the rest of the vocabulary", () => {
        expect(labelsAt(at(6, "override"))).not.toContain("COPY_EXISTING");
    });

    it("still offers the full vocabulary at a code position", () => {
        expect(labelsAt(at(6, "COPY"))).toContain("COPY_EXISTING");
    });
});
