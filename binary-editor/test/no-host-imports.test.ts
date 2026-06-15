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

describe("core boundary", () => {
    it("no src file imports vscode, vscode-languageserver, or a DOM lib", () => {
        const offenders: string[] = [];
        for (const file of tsFiles(SRC)) {
            const text = fs.readFileSync(file, "utf8");
            if (/from ["'](vscode|vscode-languageserver)/.test(text) || /document\.|window\./.test(text)) {
                offenders.push(path.relative(SRC, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
