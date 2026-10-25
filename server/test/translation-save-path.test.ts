/**
 * The dialog editor's save path (`Translation.writeMessages`) edits the entries it is given and nothing else.
 * Entries are found the way the installer reads a `.tra` and the game loads a `.msg`, so a commented-out entry,
 * a text inside a string, a `"..."` or `%...%` value, a signed number or an audio field with a space is neither
 * missed nor corrupted, and every other byte of the file stays as it was.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
}));

vi.mock("../src/server", () => ({
    connection: {
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { Translation } from "../src/translation";
import { parseEntries } from "../src/translation/entries";

describe("Translation.writeMessages entry lookup", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-save-"));
        fs.writeFileSync(path.join(tempDir, "test.tssl"), "");
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /** Save `messages` into `name` (holding `content`) the way the editor does; returns the file afterwards. */
    async function save(name: "test.tra" | "test.msg", content: string, messages: Record<string, string>) {
        fs.writeFileSync(path.join(tempDir, name), content);
        const consumer = name === "test.tra" ? "test.tbaf" : "test.tssl";
        fs.writeFileSync(path.join(tempDir, consumer), "");
        const translation = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
        await translation.init();
        translation.writeMessages(`file://${tempDir}/${consumer}`, `/** @tra ${name} */\n`, "typescript", messages);
        return fs.readFileSync(path.join(tempDir, name), "utf8");
    }

    describe(".tra", () => {
        it("leaves a commented-out entry of the same number alone", async () => {
            const out = await save("test.tra", "// @1 = ~old~\n/* @1 = ~older~ */\n@1 = ~live~\n", { "1": "new" });
            expect(out).toBe("// @1 = ~old~\n/* @1 = ~older~ */\n@1 = ~new~\n");
        });

        it("does not write an entry that is only commented out, and appends it instead", async () => {
            const out = await save("test.tra", "// @7 = ~old~\n", { "7": "new" });
            expect(out).toBe("// @7 = ~old~\n@7 = ~new~\n");
        });

        it("rewrites a double-quoted value, keeping its quotes", async () => {
            const out = await save("test.tra", '@1 = "dq"\n@2 = ~x~\n', { "1": "new" });
            expect(out).toBe('@1 = "new"\n@2 = ~x~\n');
        });

        it("rewrites a percent value, keeping its delimiters", async () => {
            const out = await save("test.tra", "@1 = %pc%\n@2 = ~x~\n", { "1": "new" });
            expect(out).toBe("@1 = %new%\n@2 = ~x~\n");
        });

        it("rewrites a negative entry", async () => {
            const out = await save("test.tra", "@-5 = ~a~\n", { "-5": "b" });
            expect(out).toBe("@-5 = ~b~\n");
        });

        it("rewrites a five-tilde value that holds tildes", async () => {
            const out = await save("test.tra", "@1 = ~~~~~a ~ b~~~~~\n@2 = ~x~\n", { "1": "new" });
            expect(out).toBe("@1 = ~~~~~new~~~~~\n@2 = ~x~\n");
        });

        it("replaces a concatenated value whole", async () => {
            const out = await save("test.tra", '@1 = ~a~ ^ "b"\n@2 = ~x~\n', { "1": "new" });
            expect(out).toBe("@1 = ~new~\n@2 = ~x~\n");
        });

        it("keeps the sound and the female string of the entry it edits", async () => {
            const out = await save("test.tra", "@1 = ~m~ [S1] ~f~ [S2]\n", { "1": "new" });
            expect(out).toBe("@1 = ~new~ [S1] ~f~ [S2]\n");
        });

        it("does not read an entry out of a string, and appends the id instead", async () => {
            const text = '@1 = "has @9 = ~x~ inside"\n';
            const out = await save("test.tra", text, { "9": "new" });
            expect(out).toBe(`${text}@9 = ~new~\n`);
        });

        it("does not append an id that a double-quoted or percent entry already holds", async () => {
            const out = await save("test.tra", '@1 = "dq"\n@2 = %pc%\n', { "1": "dq", "2": "pc" });
            expect(out).toBe('@1 = "dq"\n@2 = %pc%\n');
        });

        it("picks a delimiter the new text does not contain", async () => {
            const out = await save("test.tra", '@1 = "dq"\n@2 = ~x~\n', { "1": 'say "hi"', "2": "a ~ b" });
            const entries = parseEntries(out, "tra");
            expect([entries.get("1")?.source, entries.get("2")?.source]).toEqual(['say "hi"', "a ~ b"]);
        });

        it("changes nothing but the edited entry in a file with comments, CRLF and odd spacing", async () => {
            const before = '/* top */\r\n@1   =   ~one~ [S]\r\n// @2 = ~no~\r\n@3 = "three"\r\n\r\n';
            const out = await save("test.tra", before, { "1": "ONE" });
            expect(out).toBe('/* top */\r\n@1   =   ~ONE~ [S]\r\n// @2 = ~no~\r\n@3 = "three"\r\n\r\n');
        });
    });

    describe(".msg", () => {
        it("rewrites an entry whose audio field holds a space, without adding a second entry", async () => {
            const out = await save("test.msg", "{800}{Weapon Damage}{Light}\n", { "800": "Heavy" });
            expect(out).toBe("{800}{Weapon Damage}{Heavy}\n");
        });

        it("rewrites an entry on a line starting with #, as the game loads it", async () => {
            const out = await save("test.msg", "# {200}{}{live}\n{100}{}{x}\n", { "200": "new" });
            expect(out).toBe("# {200}{}{new}\n{100}{}{x}\n");
        });

        it("rewrites a signed number by its value", async () => {
            const out = await save("test.msg", "{-5}{}{minus}\n{+6}{}{plus}\n", { "-5": "A", "6": "B" });
            expect(out).toBe("{-5}{}{A}\n{+6}{}{B}\n");
        });

        it("keeps the spaces of an audio field and everything between the groups", async () => {
            const before = "{1}{ a b }  {text}\n\n  {2}{}{two}\n";
            const out = await save("test.msg", before, { "1": "ONE" });
            expect(out).toBe("{1}{ a b }  {ONE}\n\n  {2}{}{two}\n");
        });

        it("does not append an id the file already holds under a space-padded audio field", async () => {
            const out = await save("test.msg", "{5}{x y}{same}\n", { "5": "same" });
            expect(out).toBe("{5}{x y}{same}\n");
        });
    });
});
