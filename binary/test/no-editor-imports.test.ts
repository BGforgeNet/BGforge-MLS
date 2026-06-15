import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the lower edge of the binary-editor dependency direction: the parser/codec layer
// (@bgforge/binary) must never import the layout/session layer (@bgforge/binary-editor). The
// dependency runs one way only - binary-editor depends on binary, never the reverse - so the
// parser stays reusable (CLI, snapshots, other consumers) with zero knowledge of the editor.
// Today this holds by convention with only doc comments asserting it; this test makes it a gate.
const SRC = path.resolve(__dirname, "../src");

function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return tsFiles(p);
        return e.name.endsWith(".ts") ? [p] : [];
    });
}

// Matches an `@bgforge/binary-editor` module specifier in an import/export/dynamic-import position.
const EDITOR_IMPORT = /["']@bgforge\/binary-editor(?=["'/])/;

describe("package boundary", () => {
    it("no binary src file imports @bgforge/binary-editor (parser stays pure)", () => {
        const offenders: string[] = [];
        for (const file of tsFiles(SRC)) {
            const text = fs.readFileSync(file, "utf8");
            if (EDITOR_IMPORT.test(text)) {
                offenders.push(path.relative(SRC, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
