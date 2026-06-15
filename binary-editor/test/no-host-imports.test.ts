import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");

function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return tsFiles(p);
        return e.name.endsWith(".ts") ? [p] : [];
    });
}

// A host/LSP module import (`from "vscode"`, `from "vscode-languageserver-protocol"`, ...).
const HOST_IMPORT = /from ["'](vscode|vscode-languageserver)/;
// DOM globals used AS globals - `document.x`, `window[...]`, `globalThis.document`. The negative lookbehind
// excludes member access on an unrelated object (`node.document`, `parsedWindow.x`), which the prior bare
// `/document\.|window\./` flagged as false positives; `[.[]` also catches bracket access the prior `\.` missed.
const DOM_GLOBAL = /(?<![.\w])(?:window|document|globalThis)\s*[.[]/;

describe("core boundary", () => {
    it("no src file imports vscode, vscode-languageserver, or a DOM lib", () => {
        const offenders: string[] = [];
        for (const file of tsFiles(SRC)) {
            const text = fs.readFileSync(file, "utf8");
            if (HOST_IMPORT.test(text) || DOM_GLOBAL.test(text)) {
                offenders.push(path.relative(SRC, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
