/**
 * Unit tests for Translation service.
 * Tests TSSL (.msg) and TBAF (.tra) translation support: hover, inlay hints, go-to-definition, and find-references.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules to avoid LSP connection issues
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
}));

vi.mock("../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

/**
 * Tracks fs.renameSync/writeFileSync calls so the atomic write-back test can assert HOW
 * writeMessages wrote the file, not just what ended up on disk. `vi.spyOn(fs, "...")` can't
 * intercept these because translation.ts (and this file) import fs via `import * as fs from
 * "fs"`, and an ES module namespace object's properties are non-configurable - vi.spyOn throws
 * "Cannot redefine property". A hoisted vi.mock replaces the resolved module for every
 * importer instead (regardless of import style), so it works here; every other fs function is
 * passed straight through to the real implementation, so the other ~70 tests in this file are
 * unaffected.
 */
const fsCallLog = { renameSync: [] as Array<[string, string]>, writeFileSyncDestPaths: new Set<string>() };
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike) => {
            fsCallLog.renameSync.push([String(oldPath), String(newPath)]);
            return actual.renameSync(oldPath, newPath);
        },
        writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
            fsCallLog.writeFileSyncDestPaths.add(String(args[0]));
            return actual.writeFileSync(...args);
        },
    };
});

import { DiagnosticSeverity } from "vscode-languageserver/node";
import { Translation, UnsupportedEncodingCharacterError } from "../src/translation";
import { project as loadProjectSettings, type ProjectTraSettings } from "../src/settings";

describe("Translation", () => {
    let tempDir: string;
    let translation: Translation;

    beforeEach(() => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-"));

        // Create test .msg file (Fallout format)
        const msgContent = `{100}{}{ Hello from msg }
{101}{}{ Message 101 }
{102}{}{ Test message }`;
        fs.writeFileSync(path.join(tempDir, "test.msg"), msgContent);

        // Create test .tra file (WeiDU format)
        const traContent = `@100 = ~Hello from tra~
@101 = ~Translation 101~
@102 = ~Test translation~`;
        fs.writeFileSync(path.join(tempDir, "test.tra"), traContent);

        // Create placeholder source files (needed for isSubpath check)
        fs.writeFileSync(path.join(tempDir, "test.tssl"), "");
        fs.writeFileSync(path.join(tempDir, "test.tbaf"), "");
        fs.writeFileSync(path.join(tempDir, "test.td"), "");
        fs.writeFileSync(path.join(tempDir, "test.ts"), "");

        const settings: ProjectTraSettings = {
            directory: tempDir,
            auto_tra: true,
        };
        translation = new Translation(settings, tempDir);
    });

    afterEach(() => {
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe("initialization", () => {
        it("loads .msg and .tra files from directory", async () => {
            await translation.init();
            expect(translation.initialized).toBe(true);
        });
    });

    describe("writeMessages (.msg format)", () => {
        it("persists a .msg text edit to disk via the format-aware writer", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;

            const result = translation.writeMessages(uri, text, "typescript", { "100": "Edited msg!" });

            // Before the format-aware fix this used the .tra rewriter, which never matches a
            // {id}{sound}{text} line, so the write silently no-op'd (changed=false, file intact).
            expect(result.changed).toBe(true);
            const onDisk = fs.readFileSync(path.join(tempDir, "test.msg"), "utf8");
            expect(onDisk).toContain("{100}{}{Edited msg!}");
            // Untouched entries stay byte-for-byte.
            expect(onDisk).toContain("{101}{}{ Message 101 }");
        });

        it("appends a new .msg id while rewriting an existing one", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;

            // 100 already exists (rewrite); 500 is new (append).
            const result = translation.writeMessages(uri, text, "typescript", { "100": "Edited!", "500": "Brand new" });

            expect(result.changed).toBe(true);
            const onDisk = fs.readFileSync(path.join(tempDir, "test.msg"), "utf8");
            expect(onDisk).toContain("{100}{}{Edited!}"); // existing id rewritten
            expect(onDisk).toContain("{500}{}{Brand new}"); // new id appended
            expect(onDisk).toContain("{101}{}{ Message 101 }"); // untouched entry intact
        });

        it("creates the .msg when it does not exist yet (from-scratch dialog persistence)", async () => {
            // A from-scratch dialog references @N ids whose .msg has never been written. writeMessages must
            // CREATE it (was: readFileSync ENOENT -> NO_WRITE, silently dropping the text) in the resolved tra
            // dir, which exists here.
            await translation.init();
            const uri = `file://${tempDir}/scratch.tssl`;
            const text = `/** @tra scratch.msg */\nconst x = mstr(100);`;
            const msgPath = path.join(tempDir, "scratch.msg");
            expect(fs.existsSync(msgPath)).toBe(false);

            const result = translation.writeMessages(uri, text, "typescript", {
                "100": "First line",
                "101": "An option",
            });

            expect(result.changed).toBe(true);
            expect(fs.existsSync(msgPath)).toBe(true);
            const onDisk = fs.readFileSync(msgPath, "utf8");
            expect(onDisk).toContain("{100}{}{First line}");
            expect(onDisk).toContain("{101}{}{An option}");
        });

        it("bootstraps data/text/english/dialog + .bgforge.yml for a from-scratch SSL dialog with no tra dir", async () => {
            // With no existing tra dir, an SSL dialog's .msg must land where the loader will scan it on reopen -
            // the Fallout dialog convention path - and .bgforge.yml is written recording that dir (a sibling next
            // to the .ssl would never be scanned; see getMessages/loadDir).
            const t = new Translation({ directory: path.join(tempDir, "no-such-tra"), auto_tra: true }, tempDir);
            await t.init();
            const uri = `file://${tempDir}/lonely.tssl`;
            const text = `const x = mstr(100);`; // no @tra comment -> auto_tra basename -> lonely.msg

            const result = t.writeMessages(uri, text, "typescript", { "100": "Dialog text" });

            expect(result.changed).toBe(true);
            const msgPath = path.join(tempDir, "data/text/english/dialog", "lonely.msg");
            expect(fs.existsSync(msgPath)).toBe(true);
            expect(fs.readFileSync(msgPath, "utf8")).toContain("{100}{}{Dialog text}");
            // .bgforge.yml created, recording the directory so the next session's loadDir scans it.
            const cfg = path.join(tempDir, ".bgforge.yml");
            expect(fs.existsSync(cfg)).toBe(true);
            expect(fs.readFileSync(cfg, "utf8")).toContain("data/text/english/dialog");
        });

        it("does not overwrite an existing .bgforge.yml when bootstrapping the dialog dir", async () => {
            // ensureTraConfig only CREATES a missing config; a project's existing .bgforge.yml is left intact.
            const cfg = path.join(tempDir, ".bgforge.yml");
            fs.writeFileSync(cfg, "mls:\n  validate: true\n");
            const t = new Translation({ directory: path.join(tempDir, "no-such-tra"), auto_tra: true }, tempDir);
            await t.init();
            const uri = `file://${tempDir}/lonely.tssl`;
            t.writeMessages(uri, `const x = mstr(100);`, "typescript", { "100": "Dialog text" });

            expect(fs.readFileSync(cfg, "utf8")).toBe("mls:\n  validate: true\n"); // untouched
            expect(fs.existsSync(path.join(tempDir, "data/text/english/dialog", "lonely.msg"))).toBe(true); // msg still written
        });

        it("round-trips on reopen: a fresh service reads the written .bgforge.yml and resolves @N", async () => {
            // The reopen-resolution guarantee: after a from-scratch save writes the .msg + records the dir in
            // .bgforge.yml, a NEW service configured from that same config (settings.project reads it) loads the
            // dir via loadDir and getMessages - the one path shared by the dialog editor / hover / inlay -
            // resolves the text. This is the end-to-end proof that the bootstrapped dir is discoverable.
            const t1 = new Translation({ directory: path.join(tempDir, "no-such-tra"), auto_tra: true }, tempDir);
            await t1.init();
            const uri = `file://${tempDir}/greeter.tssl`;
            const text = `const x = mstr(100);`;
            t1.writeMessages(uri, text, "typescript", { "100": "Hello there." });

            // Reopen: settings.project reads the .bgforge.yml the save just wrote (directory -> data/text/english/dialog).
            const settings = loadProjectSettings(tempDir);
            expect(settings.translation.directory).toBe("data/text/english/dialog");
            const t2 = new Translation(settings.translation, tempDir);
            await t2.init();
            expect(t2.getMessages(uri, text, "typescript")["100"]).toBe("Hello there.");
        });
    });

    describe("TSSL support (.msg format)", () => {
        it("returns hover for mstr() reference in .tssl file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from msg"),
            });
        });

        it("returns hover for NOption() reference in .tssl file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nNOption(101, "node", 1);`;
            const hover = translation.getHover(uri, "typescript", "NOption(101", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Message 101"),
            });
        });

        it("returns hover for both floater_rand() ids in .tssl file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nfloater_rand(101, 102);`;
            const firstHover = translation.getHover(uri, "typescript", "floater_rand(101", text);
            const secondHover = translation.getHover(uri, "typescript", "floater_rand(102", text);

            expect(firstHover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Message 101"),
            });
            expect(secondHover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Test message"),
            });
        });

        it("returns inlay hints for .tssl file including both floater_rand() ids", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);\nfloater_rand(101, 102);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(3);
            expect(hints[0]?.label).toContain("Hello from msg");
            expect(hints[1]?.label).toContain("Message 101");
            expect(hints[2]?.label).toContain("Test message");
        });

        it("preserves source order for mixed same-line msg inlay hints", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nfloater_rand(101, 102); mstr(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(3);
            expect(hints[0]?.label).toContain("Message 101");
            expect(hints[1]?.label).toContain("Test message");
            expect(hints[2]?.label).toContain("Hello from msg");
        });

        it("does not return hover for @123 in .tssl file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = @100;`;
            // @100 is tra format, should not match in tssl (which uses msg format)
            const hover = translation.getHover(uri, "typescript", "@100", text);

            // Should be null because tssl uses msg format, not tra format
            expect(hover).toBeNull();
        });
    });

    describe("TBAF support (.tra format with tra() syntax)", () => {
        it("returns hover for tra(123) reference in .tbaf file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tbaf`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const hover = translation.getHover(uri, "typescript", "tra(100)", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from tra"),
            });
        });

        it("returns inlay hints for .tbaf file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tbaf`;
            const text = `/** @tra test.tra */\nconst x = tra(100);\nconst y = tra(101);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(2);
            expect(hints[0]?.label).toContain("Hello from tra");
            expect(hints[1]?.label).toContain("Translation 101");
        });

        it("does not return hover for mstr() in .tbaf file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tbaf`;
            const text = `/** @tra test.tra */\nconst x = mstr(100);`;
            // mstr() is msg format, should not match in tbaf (which uses tra() format)
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            // Should be null because tbaf uses tra() format, not msg format
            expect(hover).toBeNull();
        });

        it("does not return hover for @123 in .tbaf file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tbaf`;
            const text = `/** @tra test.tra */\nconst x = @100;`;
            // @123 is WeiDU format, TBAF uses tra(123)
            const hover = translation.getHover(uri, "typescript", "@100", text);

            expect(hover).toBeNull();
        });
    });

    describe("TD support (.tra format with tra() syntax)", () => {
        it("returns hover for tra(123) reference in .td file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.td`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const hover = translation.getHover(uri, "typescript", "tra(100)", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from tra"),
            });
        });

        it("returns inlay hints for .td file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.td`;
            const text = `/** @tra test.tra */\nconst x = tra(100);\nconst y = tra(101);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(2);
            expect(hints[0]?.label).toContain("Hello from tra");
            expect(hints[1]?.label).toContain("Translation 101");
        });

        it("does not return hover for mstr() in .td file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.td`;
            const text = `/** @tra test.tra */\nconst x = mstr(100);`;
            // mstr() is msg format, should not match in td (which uses tra() format)
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            // Should be null because td uses tra() format, not msg format
            expect(hover).toBeNull();
        });
    });

    describe("regular typescript files (.ts)", () => {
        it("returns hover for .ts files with @tra comment referencing .msg", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from msg"),
            });
        });

        it("returns hover for .ts files with @tra comment referencing .tra", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const hover = translation.getHover(uri, "typescript", "tra(100)", text);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from tra"),
            });
        });

        it("returns inlay hints for .ts files with @tra comment referencing .msg", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(1);
            expect(hints[0]?.label).toContain("Hello from msg");
        });

        it("returns inlay hints for .ts files with @tra comment referencing .tra", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(1);
            expect(hints[0]?.label).toContain("Hello from tra");
        });

        it("auto-matches .ts files without @tra comment when translation files are loaded", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            // No @tra comment - should auto-detect from loaded .msg files
            const text = `const x = mstr(100);`;
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            // Auto-matches test.msg since msg and tra are never mixed
            expect(hover).not.toBeNull();
            expect(hover?.contents).toMatchObject({
                kind: "markdown",
                value: expect.stringContaining("Hello from msg"),
            });
        });

        it("returns inlay hints for .ts files without @tra comment when translation files are loaded", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.ts`;
            const text = `const x = mstr(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints.length).toBe(1);
            expect(hints[0]?.label).toContain("Hello from msg");
        });
    });

    describe("auto_tra disabled", () => {
        it("requires explicit @tra comment when auto_tra is false", async () => {
            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: false,
            };
            const strictTranslation = new Translation(settings, tempDir);
            await strictTranslation.init();

            // Without @tra comment, should not resolve
            const uri = `file://${tempDir}/test.tssl`;
            const textWithoutComment = `const x = mstr(100);`;
            const hover = strictTranslation.getHover(uri, "typescript", "mstr(100", textWithoutComment);

            expect(hover).toBeNull();

            // With @tra comment, should resolve
            const textWithComment = `/** @tra test.msg */\nconst x = mstr(100);`;
            const hoverWithComment = strictTranslation.getHover(uri, "typescript", "mstr(100", textWithComment);

            expect(hoverWithComment).not.toBeNull();
        });
    });

    describe("edge cases: empty and special strings", () => {
        it("loads empty translation string @0 = ~~", async () => {
            // Create a .tra with an empty string entry
            const traWithEmpty = `@0 = ~~\n@1 = ~non-empty~`;
            fs.writeFileSync(path.join(tempDir, "empty.tra"), traWithEmpty);

            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const uri = `file://${tempDir}/empty.tbaf`;
            fs.writeFileSync(path.join(tempDir, "empty.tbaf"), "");
            const text = `/** @tra empty.tra */\nconst x = tra(0);`;

            // Empty string should still resolve (not be skipped)
            const hover = t.getHover(uri, "typescript", "tra(0)", text);
            expect(hover).not.toBeNull();
        });

        it("loads .msg with empty text field {100}{}{}", async () => {
            const msgWithEmpty = `{100}{}{}\n{101}{}{Non-empty}`;
            fs.writeFileSync(path.join(tempDir, "empty.msg"), msgWithEmpty);

            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const uri = `file://${tempDir}/empty.tssl`;
            fs.writeFileSync(path.join(tempDir, "empty.tssl"), "");
            const text = `/** @tra empty.msg */\nconst x = mstr(100);`;

            // Empty msg entry should still resolve
            const hover = t.getHover(uri, "typescript", "mstr(100", text);
            expect(hover).not.toBeNull();
        });
    });

    describe("edge cases: non-existent directory", () => {
        it("handles non-existent translation directory gracefully", async () => {
            const settings: ProjectTraSettings = {
                directory: "/nonexistent/dir/that/does/not/exist",
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);

            // Should not throw
            await t.init();
            expect(t.initialized).toBe(true);
        });

        it("returns null hover after init with non-existent directory", async () => {
            const settings: ProjectTraSettings = {
                directory: "/nonexistent/dir",
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const hover = t.getHover(uri, "typescript", "mstr(100", text);

            expect(hover).toBeNull();
        });

        it("returns empty inlay hints after init with non-existent directory", async () => {
            const settings: ProjectTraSettings = {
                directory: "/nonexistent/dir",
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = t.getInlayHints(uri, "typescript", text, range);

            expect(hints).toEqual([]);
        });
    });

    describe("edge cases: uninitialized service", () => {
        it("returns null hover when not initialized", () => {
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const hover = translation.getHover(uri, "typescript", "mstr(100", text);

            expect(hover).toBeNull();
        });

        it("returns empty inlay hints when not initialized", () => {
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "typescript", text, range);

            expect(hints).toEqual([]);
        });

        it("does nothing on reloadFile when not initialized", () => {
            const uri = `file://${tempDir}/test.tra`;
            // Should not throw
            translation.reloadFile(uri, "weidu-tra", "@100 = ~test~");
        });

        it("returns empty messages when not initialized", () => {
            const uri = `file://${tempDir}/test.ssl`;
            const messages = translation.getMessages(uri, "// @tra test.msg");

            expect(messages).toEqual({});
        });
    });

    describe("edge cases: multi-line .tra entries", () => {
        it("does not match multi-line entries with current regex", async () => {
            // The regex /@(\d+)\s*=\s*~([^~]*)~/gm uses [^~]* which matches across lines
            // This is actually a feature, not a bug - WeiDU supports multi-line .tra entries
            const multiLineTra = `@100 = ~This is a
multi-line
translation~`;
            fs.writeFileSync(path.join(tempDir, "multi.tra"), multiLineTra);

            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const uri = `file://${tempDir}/multi.tbaf`;
            fs.writeFileSync(path.join(tempDir, "multi.tbaf"), "");
            const text = `/** @tra multi.tra */\nconst x = tra(100);`;
            const hover = t.getHover(uri, "typescript", "tra(100)", text);

            // [^~]* matches across lines since the regex has /gm flag
            // and [^~]* doesn't restrict to single line
            expect(hover).not.toBeNull();
            if (hover) {
                const content = (hover.contents as { value: string }).value;
                expect(content).toContain("multi-line");
            }
        });
    });

    describe("getDefinition", () => {
        it("returns location for mstr(100) in TSSL file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(100", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.msg");
            expect(result!.range.start.line).toBe(0);
            expect(result!.range.start.character).toBe(0);
        });

        it("returns correct line for non-first entry mstr(101)", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(101);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(101", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.msg");
            expect(result!.range.start.line).toBe(1);
        });

        it("returns location for tra(100) in TBAF file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tbaf`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const result = translation.getDefinition(uri, "typescript", "tra(100)", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.tra");
            expect(result!.range.start.line).toBe(0);
        });

        it("returns location for tra(100) in TD file", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.td`;
            const text = `/** @tra test.tra */\nconst x = tra(100);`;
            const result = translation.getDefinition(uri, "typescript", "tra(100)", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.tra");
            expect(result!.range.start.line).toBe(0);
        });

        it("returns location for @100 in weidu-baf file", async () => {
            await translation.init();

            fs.writeFileSync(path.join(tempDir, "test.baf"), "");
            const uri = `file://${tempDir}/test.baf`;
            const text = `// @tra test.tra\nIF\n  Global("test","GLOBAL",0)\nTHEN\n  RESPONSE #100\n    DisplayStringHead(Myself,@100)\nEND`;
            const result = translation.getDefinition(uri, "weidu-baf", "@100", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.tra");
            expect(result!.range.start.line).toBe(0);
        });

        it("returns null for non-existent entry mstr(999)", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(999);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(999", text);

            expect(result).toBeNull();
        });

        it("returns null when translation file is not loaded", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra nonexistent.msg */\nconst x = mstr(100);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(100", text);

            expect(result).toBeNull();
        });

        it("returns null when not initialized", () => {
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(100", text);

            expect(result).toBeNull();
        });

        it("returns URI with correct absolute file path", async () => {
            await translation.init();

            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const result = translation.getDefinition(uri, "typescript", "mstr(100", text);

            expect(result).not.toBeNull();
            // URI should be file:// + absolute path to test.msg in the tempDir
            expect(result!.uri).toBe(`file://${path.join(tempDir, "test.msg")}`);
        });

        it("returns location for mstr(100) in fallout-ssl file", async () => {
            await translation.init();

            fs.writeFileSync(path.join(tempDir, "test.ssl"), "");
            const uri = `file://${tempDir}/test.ssl`;
            const text = `// @tra test.msg\nconst x = mstr(100);`;
            const result = translation.getDefinition(uri, "fallout-ssl", "mstr(100", text);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain("test.msg");
            expect(result!.range.start.line).toBe(0);
        });
    });

    describe("getReferences", () => {
        it("finds references to a .tra entry from .baf consumer files", async () => {
            // Create a .baf file that references @100
            const bafContent = `IF\n  Global("test","GLOBAL",0)\nTHEN\n  RESPONSE #100\n    DisplayStringHead(Myself,@100)\nEND`;
            fs.writeFileSync(path.join(tempDir, "test.baf"), bafContent);

            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            // Cursor on @100 in the tra file (line 0, character 0)
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refs.length).toBe(1);
            expect(refs[0]!.uri).toContain("test.baf");
        });

        it("finds references to a .msg entry from .ssl consumer files", async () => {
            // Create a .ssl file that references mstr(100)
            const sslContent = `procedure start begin\n  display_msg(mstr(100));\nend`;
            fs.writeFileSync(path.join(tempDir, "test.ssl"), sslContent);

            await translation.init();

            const msgUri = `file://${tempDir}/test.msg`;
            // Cursor on {100} in the msg file (line 0, character 0)
            const refs = await translation.getReferences(msgUri, "fallout-msg", { line: 0, character: 0 }, false);

            expect(refs.length).toBe(1);
            expect(refs[0]!.uri).toContain("test.ssl");
        });

        it("includes declaration when includeDeclaration is true", async () => {
            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "test.baf"), bafContent);

            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, true);

            // Should include both the declaration in test.tra and the reference in test.baf
            expect(refs.length).toBe(2);
            expect(refs.some((r) => r.uri.includes("test.tra"))).toBe(true);
            expect(refs.some((r) => r.uri.includes("test.baf"))).toBe(true);
        });

        it("finds references when cursor is on the string value", async () => {
            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "test.baf"), bafContent);

            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            // Cursor on "Hello" in "@100 = ~Hello from tra~" (line 0, character 10)
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 10 }, false);

            expect(refs.length).toBe(1);
            expect(refs[0]!.uri).toContain("test.baf");
        });

        it("finds references to multiline .tra entry values", async () => {
            const multiTra = `@100 = ~This is a\nmulti-line\ntranslation~`;
            fs.writeFileSync(path.join(tempDir, "multi.tra"), multiTra);
            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "multi.baf"), bafContent);

            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const traUri = `file://${tempDir}/multi.tra`;
            // Cursor on "multi-line" (line 1)
            const refs = await t.getReferences(traUri, "weidu-tra", { line: 1, character: 3 }, false);

            expect(refs.length).toBe(1);
            expect(refs[0]!.uri).toContain("multi.baf");
        });

        it("finds multiple MSG function references (mstr, NOption, etc.)", async () => {
            const sslContent = `procedure start begin\n  display_msg(mstr(100));\n  NOption(100, "node", 1);\nend`;
            fs.writeFileSync(path.join(tempDir, "test.ssl"), sslContent);

            await translation.init();

            const msgUri = `file://${tempDir}/test.msg`;
            const refs = await translation.getReferences(msgUri, "fallout-msg", { line: 0, character: 0 }, false);

            expect(refs.length).toBe(2);
        });

        it("finds tra() references from transpiler files", async () => {
            const tbafContent = `/** @tra test.tra */\nconst x = tra(100);`;
            fs.writeFileSync(path.join(tempDir, "test.tbaf"), tbafContent);

            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refs.length).toBe(1);
            expect(refs[0]!.uri).toContain("test.tbaf");
        });

        it("returns empty array when cursor is not on an entry", async () => {
            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            // Cursor on a blank line (beyond the entries)
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 10, character: 0 }, false);

            expect(refs).toEqual([]);
        });

        it("returns empty array when not initialized", async () => {
            const traUri = `file://${tempDir}/test.tra`;
            const refs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refs).toEqual([]);
        });

        it("does not match partial entry numbers (@10 should not match @100)", async () => {
            const traContent = `@10 = ~Entry ten~\n@100 = ~Entry hundred~`;
            fs.writeFileSync(path.join(tempDir, "partial.tra"), traContent);
            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "partial.baf"), bafContent);

            const settings: ProjectTraSettings = {
                directory: tempDir,
                auto_tra: true,
            };
            const t = new Translation(settings, tempDir);
            await t.init();

            const traUri = `file://${tempDir}/partial.tra`;
            // Cursor on @10 (line 0) - should NOT find @100 references
            const refs = await t.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refs).toEqual([]);
        });
    });

    describe("reloadConsumer", () => {
        it("adds consumer file to reverse index", async () => {
            await translation.init();

            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "new.baf"), bafContent);

            // Initially no consumers for test.tra (new.baf wasn't present at init)
            const traUri = `file://${tempDir}/test.tra`;
            const refsBefore = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            // After reloadConsumer, the file should be indexed
            const bafUri = `file://${tempDir}/new.baf`;
            const bafText = `/** @tra test.tra */\n${bafContent}`;
            translation.reloadConsumer(bafUri, bafText, "weidu-baf");

            const refsAfter = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refsAfter.length).toBeGreaterThan(refsBefore.length);
        });

        it("updates consumer mapping when @tra comment changes", async () => {
            // Create two tra files
            const tra2 = `@100 = ~Second tra~`;
            fs.writeFileSync(path.join(tempDir, "other.tra"), tra2);

            await translation.init();

            const bafUri = `file://${tempDir}/test.baf`;
            const bafContent = `DisplayStringHead(Myself,@100)`;
            fs.writeFileSync(path.join(tempDir, "test.baf"), bafContent);

            // Initially maps to test.tra by basename
            translation.reloadConsumer(bafUri, bafContent, "weidu-baf");

            // Now change @tra comment to point to other.tra - update both in-memory and on disk
            const bafContentWithComment = `/** @tra other.tra */\n${bafContent}`;
            fs.writeFileSync(path.join(tempDir, "test.baf"), bafContentWithComment);
            translation.reloadConsumer(bafUri, bafContentWithComment, "weidu-baf");

            const traUri = `file://${tempDir}/test.tra`;
            const otherUri = `file://${tempDir}/other.tra`;

            const testRefs = await translation.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);
            const otherRefs = await translation.getReferences(otherUri, "weidu-tra", { line: 0, character: 0 }, false);

            // Should no longer reference test.tra, should reference other.tra
            expect(testRefs.length).toBe(0);
            expect(otherRefs.length).toBe(1);
        });
    });

    describe("workspace boundary", () => {
        it("does not load translations when an absolute directory escapes the workspace root", async () => {
            // Place a translation file outside the workspace; configure Translation
            // with directory pointing there. The defense-in-depth check should
            // refuse to load entries from outside the workspace, so getHover finds
            // nothing even though the .tra file does exist on disk.
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-outside-"));
            try {
                fs.writeFileSync(path.join(outsideDir, "outside.tra"), "@500 = ~Should not be visible~");

                const escaping = new Translation({ directory: outsideDir, auto_tra: true }, tempDir);
                await escaping.init();

                const consumerUri = `file://${tempDir}/test.tbaf`;
                const text = `/** @tra outside.tra */\nconst x = tra(500);`;
                const hover = escaping.getHover(consumerUri, "typescript", "tra(500)", text);

                expect(hover).toBeNull();
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it("does not load translations when a relative directory escapes via '..'", async () => {
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-outside-"));
            try {
                fs.writeFileSync(path.join(outsideDir, "outside.tra"), "@600 = ~Should not be visible~");

                // Relative path from tempDir to outsideDir traverses '..'.
                const relativeEscape = path.relative(tempDir, outsideDir);
                const escaping = new Translation({ directory: relativeEscape, auto_tra: true }, tempDir);
                await escaping.init();

                const consumerUri = `file://${tempDir}/test.tbaf`;
                const text = `/** @tra outside.tra */\nconst x = tra(600);`;
                const hover = escaping.getHover(consumerUri, "typescript", "tra(600)", text);

                expect(hover).toBeNull();
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });
    });

    describe("reloadFile", () => {
        it("does not throw when reloading a .tra file within workspace", async () => {
            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            const newText = `@100 = ~Updated text~\n@200 = ~New entry~`;

            // Should not throw -- verifies the reload path works
            expect(() => translation.reloadFile(traUri, "weidu-tra", newText)).not.toThrow();
        });

        it("ignores files with unknown language ID", async () => {
            await translation.init();

            const traUri = `file://${tempDir}/test.tra`;
            const newText = `@100 = ~Updated text~`;

            // Non-translation langId should be silently ignored
            expect(() => translation.reloadFile(traUri, "typescript", newText)).not.toThrow();
        });

        it("reloads and fires the notify callback regardless of the process working directory", async () => {
            const notifyReload = vi.fn();
            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir, notifyReload);
            await t.init();

            const traUri = `file://${tempDir}/test.tra`;
            // Deliberately do NOT chdir into the workspace: a normally-spawned LSP server's CWD is
            // not the workspace root. getTraPath must resolve the reload path with path-math
            // (workspace root + resolveTraDir), not a CWD-relative realpath - otherwise
            // reloadFileLines silently no-ops and .tra/.msg reload-on-save is dead in production.
            expect(process.cwd()).not.toBe(tempDir);
            t.reloadFile(traUri, "weidu-tra", `@100 = ~Updated text~`);

            expect(notifyReload).toHaveBeenCalledTimes(1);
        });

        it("does not fire the reload-notify callback for a non-tra/msg file extension", async () => {
            const notifyReload = vi.fn();
            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir, notifyReload);
            await t.init();

            // langId is a translation-file langId, but the extension itself is not .tra/.msg, so
            // reloadFileLines' own extension check rejects it before any data is touched.
            const outsideUri = `file://${tempDir}/test.tssl`;
            t.reloadFile(outsideUri, "weidu-tra", `@100 = ~Updated text~`);

            expect(notifyReload).not.toHaveBeenCalled();
        });

        it("works without a reload-notify callback (optional constructor argument)", async () => {
            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();

            const traUri = `file://${tempDir}/test.tra`;
            expect(() => t.reloadFile(traUri, "weidu-tra", `@100 = ~Updated text~`)).not.toThrow();
        });
    });

    describe("writeMessages (atomic write-back)", () => {
        it("writes via a same-directory temp file + rename, leaving no temp file behind", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.tssl`;
            const text = `/** @tra test.msg */\nconst x = mstr(100);`;
            const destPath = path.join(tempDir, "test.msg");

            // Reset here, not in the shared beforeEach: fixture setup (creating test.msg/.tra
            // etc.) also calls writeFileSync on this same destPath, which would otherwise pollute
            // the log before the call under test even runs.
            fsCallLog.renameSync.length = 0;
            fsCallLog.writeFileSyncDestPaths.clear();

            const result = translation.writeMessages(uri, text, "typescript", { "100": "Atomic edit" });

            expect(result.changed).toBe(true);
            // Exactly one rename, from a temp path in the SAME directory, onto the destination.
            expect(fsCallLog.renameSync).toHaveLength(1);
            const [tempPath, renamedTo] = fsCallLog.renameSync[0]!;
            expect(path.dirname(tempPath)).toBe(path.dirname(destPath));
            expect(renamedTo).toBe(destPath);
            // writeFileSync itself never targeted the destination path directly - only the temp
            // path (renameSync is what puts content at the destination, atomically).
            expect(fsCallLog.writeFileSyncDestPaths.has(destPath)).toBe(false);
            expect(fsCallLog.writeFileSyncDestPaths.has(tempPath)).toBe(true);
            // The rename consumed the temp file - nothing named *.tmp remains on disk.
            const leftovers = fs.readdirSync(tempDir).filter((f) => f.endsWith(".tmp"));
            expect(leftovers).toEqual([]);
            // And the destination itself has the expected final content.
            expect(fs.readFileSync(destPath, "utf8")).toContain("{100}{}{Atomic edit}");
        });
    });

    describe("legacy-codepage support (windows-1252 fallback)", () => {
        /** Build raw file bytes: ASCII scaffolding around one explicit non-ASCII byte value. */
        function cp1252Bytes(...parts: Array<string | number>): Buffer {
            return Buffer.concat(
                parts.map((p) => (typeof p === "string" ? Buffer.from(p, "ascii") : Buffer.from([p]))),
            );
        }

        it("resolves a windows-1252 .tra file's accented text (read path)", async () => {
            // 0xE9 = 'e' with acute accent in both windows-1252 and Latin-1; not valid UTF-8 on its own.
            const raw = cp1252Bytes("@100 = ~Caf", 0xe9, "~\n@101 = ~Non-accented~");
            expect(() => new TextDecoder("utf-8", { fatal: true }).decode(raw)).toThrow();
            fs.writeFileSync(path.join(tempDir, "cp1252.tra"), raw);

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();

            fs.writeFileSync(path.join(tempDir, "cp1252.tbaf"), "");
            const uri = `file://${tempDir}/cp1252.tbaf`;
            const text = `/** @tra cp1252.tra */\nconst x = tra(100);`;
            const hover = t.getHover(uri, "typescript", "tra(100)", text);

            expect(hover).not.toBeNull();
            const value = (hover!.contents as { value: string }).value;
            expect(value).toContain("Café");
        });

        it("still resolves a UTF-8 .tra file's multi-byte text (read path unaffected)", async () => {
            // U+00E9 encoded as UTF-8 is the two bytes 0xC3 0xA9 - decodes as UTF-8, not windows-1252.
            const raw = Buffer.from("@100 = ~Café~\n@101 = ~Non-accented~", "utf8");
            fs.writeFileSync(path.join(tempDir, "utf8.tra"), raw);

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();

            fs.writeFileSync(path.join(tempDir, "utf8.tbaf"), "");
            const uri = `file://${tempDir}/utf8.tbaf`;
            const text = `/** @tra utf8.tra */\nconst x = tra(100);`;
            const hover = t.getHover(uri, "typescript", "tra(100)", text);

            expect(hover).not.toBeNull();
            expect((hover!.contents as { value: string }).value).toContain("Café");
        });

        it("round-trips a windows-1252 file byte-identically on save: untouched entries unchanged", async () => {
            // The accented byte lives in the UNTOUCHED entry (101); entry 100 (the one edited) is
            // plain ASCII. This way the post-save file staying non-UTF-8 actually proves entry
            // 101's original cp1252 byte survived, rather than merely reflecting that the new
            // text for entry 100 happens to be ASCII.
            const raw = cp1252Bytes("@100 = ~Original entry~\n@101 = ~Caf", 0xe9, " untouched~");
            const traPath = path.join(tempDir, "cp1252.tra");
            fs.writeFileSync(traPath, raw);

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();
            fs.writeFileSync(path.join(tempDir, "cp1252.tbaf"), "");
            const uri = `file://${tempDir}/cp1252.tbaf`;
            const text = `/** @tra cp1252.tra */\nconst x = tra(100);`;

            const result = t.writeMessages(uri, text, "typescript", { "100": "Edited only entry 100" });
            expect(result.changed).toBe(true);

            const updated = fs.readFileSync(traPath);
            // Still not valid UTF-8: round-tripped as windows-1252, not transcoded.
            expect(() => new TextDecoder("utf-8", { fatal: true }).decode(updated)).toThrow();
            // The untouched entry 101's line is byte-identical to the original, accented byte included.
            const line101 = "@101 = ~Caf";
            const originalLine = raw.subarray(raw.indexOf(line101, 0, "ascii"));
            const updatedLine = updated.subarray(updated.indexOf(line101, 0, "ascii"));
            expect(updatedLine).toEqual(originalLine);
        });

        it("refuses to save a windows-1252 file when the edit adds a character outside windows-1252", async () => {
            const raw = cp1252Bytes("@100 = ~Caf", 0xe9, "~\n@101 = ~Non-accented~");
            fs.writeFileSync(path.join(tempDir, "cp1252.tra"), raw);

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();
            fs.writeFileSync(path.join(tempDir, "cp1252.tbaf"), "");
            const uri = `file://${tempDir}/cp1252.tbaf`;
            const text = `/** @tra cp1252.tra */\nconst x = tra(100);`;

            // U+4E2D ("middle", CJK) is not representable in windows-1252.
            expect(() => t.writeMessages(uri, text, "typescript", { "100": "Not cp1252: 中" })).toThrow(
                UnsupportedEncodingCharacterError,
            );
            // Nothing was written: the file is untouched.
            expect(fs.readFileSync(path.join(tempDir, "cp1252.tra"))).toEqual(raw);
        });

        it("allows a UTF-8 file to gain any Unicode character (no windows-1252 constraint)", async () => {
            const raw = Buffer.from("@100 = ~Café~\n@101 = ~Non-accented~", "utf8");
            fs.writeFileSync(path.join(tempDir, "utf8.tra"), raw);

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();
            fs.writeFileSync(path.join(tempDir, "utf8.tbaf"), "");
            const uri = `file://${tempDir}/utf8.tbaf`;
            const text = `/** @tra utf8.tra */\nconst x = tra(100);`;

            const result = t.writeMessages(uri, text, "typescript", { "100": "Now with 中" });
            expect(result.changed).toBe(true);
            const updated = fs.readFileSync(path.join(tempDir, "utf8.tra"), "utf8");
            expect(updated).toContain("中");
        });

        it("a brand-new file (from-scratch save) defaults to UTF-8 encoding", async () => {
            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();
            fs.writeFileSync(path.join(tempDir, "scratch2.tbaf"), "");
            const uri = `file://${tempDir}/scratch2.tbaf`;
            const text = `/** @tra scratch2.tra */\nconst x = tra(100);`;

            const result = t.writeMessages(uri, text, "typescript", { "100": "Brand new 中" });
            expect(result.changed).toBe(true);
            const onDisk = fs.readFileSync(path.join(tempDir, "scratch2.tra"), "utf8");
            expect(onDisk).toContain("中");
        });
    });

    describe("consumer index concurrency (bounded async startup walk)", () => {
        it("indexes every consumer file correctly when the file count exceeds the concurrency bound", async () => {
            // WORKSPACE_SCAN_CONCURRENCY is 4; create more consumer files than that so the pLimit
            // fan-out in buildConsumerIndex must actually queue work, not just run everything at once.
            const traContent = `@100 = ~Shared entry~`;
            fs.writeFileSync(path.join(tempDir, "many.tra"), traContent);

            const N = 12;
            for (let i = 0; i < N; i++) {
                fs.writeFileSync(
                    path.join(tempDir, `consumer${i}.baf`),
                    `/** @tra many.tra */\nDisplayStringHead(Myself,@100)`,
                );
            }

            const t = new Translation({ directory: tempDir, auto_tra: true }, tempDir);
            await t.init();

            const traUri = `file://${tempDir}/many.tra`;
            const refs = await t.getReferences(traUri, "weidu-tra", { line: 0, character: 0 }, false);

            expect(refs.length).toBe(N);
            const files = new Set(refs.map((r) => r.uri));
            expect(files.size).toBe(N);
        });
    });

    describe("getDiagnostics (unresolved translation references)", () => {
        // beforeEach loads test.tra (@100/@101/@102) and test.msg (100/101/102) from tempDir.
        // A consumer whose basename is "test" auto-resolves to those via auto_tra.

        it("flags a @N ref with no entry as an Info diagnostic on the token", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            const diags = translation.getDiagnostics(uri, "weidu-d", "@999");

            expect(diags).toHaveLength(1);
            const d = diags[0]!;
            expect(d.severity).toBe(DiagnosticSeverity.Information);
            expect(d.source).toBe("BGforge MLS (translation)");
            expect(d.message).toBe("No translation entry 999 in test.tra.");
            // Underlines exactly the `@999` token.
            expect(d.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 4 } });
        });

        it("does not flag a @N reference inside a // line comment", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            // @999 has no entry, but it's commented out. Commenting dialog with // is ubiquitous in
            // WeiDU mods (real case: BG1NPC x#brint.d), so a commented ref must never be flagged.
            expect(translation.getDiagnostics(uri, "weidu-d", "// SAY @999")).toEqual([]);
        });

        it("does not flag a @N reference inside a /* */ block comment", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            expect(translation.getDiagnostics(uri, "weidu-d", "/* old:\n  @999\n*/")).toEqual([]);
        });

        it("emits nothing when every @N ref resolves", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            expect(translation.getDiagnostics(uri, "weidu-d", "@100 @101 @102")).toEqual([]);
        });

        it("flags only the missing ref among a mix", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            const diags = translation.getDiagnostics(uri, "weidu-d", "call @100;\ncall @999;");

            expect(diags).toHaveLength(1);
            expect(diags[0]!.range.start.line).toBe(1);
            expect(diags[0]!.message).toContain("999");
        });

        it("SUPPRESSES all refs when this document's translation file does not resolve", async () => {
            await translation.init();
            // basename "other" -> other.tra, which is not loaded -> file-missing -> silent.
            const uri = `file://${tempDir}/other.d`;
            expect(translation.getDiagnostics(uri, "weidu-d", "@100\n@999")).toEqual([]);
        });

        it("SUPPRESSES all refs when no translation data is loaded at all", async () => {
            const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-empty-"));
            try {
                const t = new Translation({ directory: emptyDir, auto_tra: true }, emptyDir);
                await t.init();
                const uri = `file://${emptyDir}/test.d`;
                expect(t.getDiagnostics(uri, "weidu-d", "@100\n@999")).toEqual([]);
            } finally {
                fs.rmSync(emptyDir, { recursive: true, force: true });
            }
        });

        it("flags an unresolved MSG-call ref (mstr) against a loaded .msg", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.ssl`;
            const diags = translation.getDiagnostics(uri, "fallout-ssl", "mstr(999)");

            expect(diags).toHaveLength(1);
            expect(diags[0]!.severity).toBe(DiagnosticSeverity.Information);
            expect(diags[0]!.message).toBe("No translation entry 999 in test.msg.");
        });

        it("does not flag a prefixed *mstr function (g_mstr/my_mstr read a different file)", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.ssl`;
            // g_mstr(x) = message_str(SCRIPT_GENERIC, x): a different function reading a generic file,
            // not this script's own .msg. The bare `mstr` alternative must not match inside `g_mstr(`
            // (ubiquitous in the real Fallout RP corpus: g_mstr(20000) etc.).
            expect(translation.getDiagnostics(uri, "fallout-ssl", "g_mstr(999)\nmy_mstr(999)")).toEqual([]);
        });

        it("emits nothing for a resolved MSG-call ref", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.ssl`;
            expect(translation.getDiagnostics(uri, "fallout-ssl", "NOption(100)")).toEqual([]);
        });

        it("re-derives per call: a fixed ref clears on the next invocation", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            expect(translation.getDiagnostics(uri, "weidu-d", "@999")).toHaveLength(1);
            expect(translation.getDiagnostics(uri, "weidu-d", "@100")).toEqual([]);
        });
    });

    describe("unified missing-reference handling across hover / inlay / diagnostic", () => {
        it("hover on a missing entry returns nothing - the diagnostic is the single signal", async () => {
            await translation.init();
            // test.tbaf exists on disk (hover's realpath guard) and auto-resolves to test.tra.
            const uri = `file://${tempDir}/test.tbaf`;
            // VS Code renders the diagnostic in the hover popup already; a message here would double it.
            expect(translation.getHover(uri, "typescript", "tra(999)", "tra(999)")).toBeNull();
        });

        it("inlay shows a preview for a resolved ref and nothing for a missing one", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } };
            const hints = translation.getInlayHints(uri, "weidu-d", "@100\n@999", range);
            // @100 resolves (line 0); @999 is missing and gets no inline error - the diagnostic surfaces it.
            expect(hints).toHaveLength(1);
            expect(hints[0]!.position.line).toBe(0);
        });

        it("inlay ignores a commented-out reference, like the diagnostic", async () => {
            await translation.init();
            const uri = `file://${tempDir}/test.d`;
            const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } };
            expect(translation.getInlayHints(uri, "weidu-d", "// @100", range)).toEqual([]);
        });
    });
});
