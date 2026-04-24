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

import { Translation } from "../src/translation";
import type { ProjectTraSettings } from "../src/settings";

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
            // Cursor on @10 (line 0) — should NOT find @100 references
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

            // Now change @tra comment to point to other.tra — update both in-memory and on disk
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
    });
});
