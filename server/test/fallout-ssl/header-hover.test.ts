/**
 * Tests for header-defined symbol hover in Fallout SSL.
 * Verifies that parseHeaderToSymbols and unified storage work correctly.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";

// Mock LSP connection before importing modules that use it
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err) => (err instanceof Error ? err.message : String(err)),
    findFiles: vi.fn(() => []),
}));

import { parseFile } from "../../src/fallout-ssl/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { initParser } from "../../src/fallout-ssl/parser";
import { falloutSslProvider } from "../../src/fallout-ssl/provider";
import type { ProviderContext } from "../../src/language-provider";
import type { MLSsettings } from "../../src/settings";

describe("fallout-ssl header symbol hover", () => {
    const testUri = "file:///mymod/headers/define.h";
    const workspaceRoot = "/mymod";

    beforeAll(async () => {
        await initParser();
    });

    beforeEach(async () => {
        // Initialize provider fresh for each test
        const mockContext: ProviderContext = {
            workspaceRoot,
            settings: {} as MLSsettings,
        };
        await falloutSslProvider.init(mockContext);
    });

    it("should parse header-defined constant macros", () => {
        const headerText = `
#define CURSOR_TARGETING    (2)
#define MAX_HEALTH          100
`;
        const symbols = parseHeaderToSymbols(testUri, headerText, workspaceRoot);

        // Find CURSOR_TARGETING symbol
        const cursorSymbol = symbols.find((s) => s.name === "CURSOR_TARGETING");
        expect(cursorSymbol).toBeDefined();
        expect(cursorSymbol?.hover.contents).toHaveProperty("kind", MarkupKind.Markdown);

        // Constant macros show just the value, not "NAME = value"
        const contents = cursorSymbol?.hover?.contents;
        expect(contents).toBeDefined();
        const hoverValue = (contents as { value: string }).value;
        expect(hoverValue).toContain("(2)");
        expect(hoverValue).toContain("headers/define.h");
    });

    it("should parse header-defined function-like macros", () => {
        const headerText = `
#define get_msg(x) message_str(SCRIPT_SELF, x)
`;
        const symbols = parseHeaderToSymbols(testUri, headerText, workspaceRoot);

        const getMsgSymbol = symbols.find((s) => s.name === "get_msg");
        expect(getMsgSymbol).toBeDefined();
        const contents = getMsgSymbol?.hover?.contents;
        expect(contents).toBeDefined();
        const hoverValue = (contents as { value: string }).value;
        expect(hoverValue).toContain("get_msg");
        expect(hoverValue).toContain("x");
    });

    it("resolveSymbol should return IndexedSymbol for header macros", async () => {
        const headerText = `
#define CURSOR_TARGETING    (2)
`;
        // Load header into unified storage via reloadFileData
        falloutSslProvider.reloadFileData!(testUri, headerText);

        // Test resolveSymbol
        const sslText = `
procedure test begin
    set_cursor_mode(CURSOR_TARGETING);
end
`;
        const sslUri = "file:///mymod/scripts/test.ssl";

        const resolved = falloutSslProvider.resolveSymbol!("CURSOR_TARGETING", sslText, sslUri);

        expect(resolved).toBeDefined();
        expect(resolved?.hover).toBeDefined();
        expect(resolved?.name).toBe("CURSOR_TARGETING");
    });

    it("resolveSymbol should include file path in hover for header symbols", async () => {
        const headerText = `
#define MY_CONSTANT    42
`;
        falloutSslProvider.reloadFileData!(testUri, headerText);

        const sslText = `variable x := MY_CONSTANT;`;
        const sslUri = "file:///mymod/scripts/test.ssl";

        const resolved = falloutSslProvider.resolveSymbol!("MY_CONSTANT", sslText, sslUri);

        expect(resolved).toBeDefined();
        const hoverValue = (resolved?.hover?.contents as { value: string })?.value;
        // Header symbols SHOULD show file path (unlike local symbols)
        expect(hoverValue).toContain("headers/define.h");
    });

    it("resolveSymbol should not fall back to unrelated source-file symbols", () => {
        const sourceUri = "file:///mymod/scripts/other.ssl";
        const sourceText = `
procedure shared_name begin
end
`;
        falloutSslProvider.reloadFileData!(sourceUri, sourceText);

        const currentText = `
procedure test begin
    shared_name();
end
`;
        const currentUri = "file:///mymod/scripts/test.ssl";

        const resolved = falloutSslProvider.resolveSymbol!("shared_name", currentText, currentUri);

        expect(resolved).toBeUndefined();
    });

    it("resolveSymbol should show relative path, not absolute realpath", async () => {
        const headerUri = "file:///home/user/mymod/headers/define.h";
        const headerText = `
#define TEST_CONST    123
`;
        // Re-init with different workspace root
        const mockContext: ProviderContext = {
            workspaceRoot: "/home/user/mymod",
            settings: {} as MLSsettings,
        };
        await falloutSslProvider.init(mockContext);

        falloutSslProvider.reloadFileData!(headerUri, headerText);

        const sslText = `variable x := TEST_CONST;`;
        const sslUri = "file:///home/user/mymod/scripts/test.ssl";

        const resolved = falloutSslProvider.resolveSymbol!("TEST_CONST", sslText, sslUri);

        expect(resolved).toBeDefined();

        // Check displayPath in source
        expect(resolved?.source.displayPath).toBe("headers/define.h");

        // Check hover doesn't contain absolute path
        const hoverValue = (resolved?.hover?.contents as { value: string })?.value;
        expect(hoverValue).not.toContain("/home/user");
        expect(hoverValue).toContain("headers/define.h");
    });

    it("reloadFileData should use relative path for headers", async () => {
        const mockContext: ProviderContext = {
            workspaceRoot: "/home/user/mymod",
            settings: {} as MLSsettings,
        };

        await falloutSslProvider.init(mockContext);

        // Simulate reloadFileData being called with absolute URI
        const headerUri = "file:///home/user/mymod/headers/test.h";
        const headerText = `
#define RELOAD_TEST    999
`;
        falloutSslProvider.reloadFileData!(headerUri, headerText);

        // Now check the symbol
        const sslText = `variable x := RELOAD_TEST;`;
        const sslUri = "file:///home/user/mymod/scripts/test.ssl";

        const resolved = falloutSslProvider.resolveSymbol!("RELOAD_TEST", sslText, sslUri);

        expect(resolved).toBeDefined();

        // The displayPath should be relative to workspace, not absolute
        expect(resolved?.source.displayPath).toBe("headers/test.h");

        // Hover should show relative path
        const hoverValue = (resolved?.hover?.contents as { value: string })?.value;
        expect(hoverValue).not.toContain("/home/user/mymod");
        expect(hoverValue).toContain("headers/test.h");
    });

    describe("getSymbolDefinition for header macros", () => {
        it("returns location for function-like macro from header", () => {
            const headerText = `#define floater(x) float_msg(self_obj, message_str(NAME,x), FLOAT_COLOR_NORMAL)`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("floater");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(0);
        });

        it("returns location for constant macro from header", () => {
            const headerText = `#define MAX_HP 100`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("MAX_HP");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
        });

        it("returns location for macro defined after blank lines", () => {
            const headerText = `
#define floater(x) float_msg(self_obj, message_str(NAME,x), FLOAT_COLOR_NORMAL)
`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("floater");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(1);
        });

        it("returns location for indented #define inside #ifndef guard", () => {
            const headerText = `#ifndef floater
   #define floater(x)           float_msg(self_obj, message_str(NAME,x), FLOAT_COLOR_NORMAL)
#endif`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("floater");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(1);
        });

        it("returns location for indented procedure", () => {
            const headerText = `#ifdef SOME_FLAG
   procedure guarded_proc begin end
#endif`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("guarded_proc");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(1);
        });

        it("returns location for procedure from header", () => {
            const headerText = `procedure my_helper begin end`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("my_helper");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
        });

        it("does not return location for procedure from unrelated source file", () => {
            const sourceUri = "file:///mymod/scripts/other.ssl";
            const sourceText = `procedure shared_name begin end`;
            falloutSslProvider.reloadFileData!(sourceUri, sourceText);

            const location = falloutSslProvider.getSymbolDefinition!("shared_name");
            expect(location).toBeNull();
        });

        it("returns location for variable from header", () => {
            const headerText = `variable my_global;`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("my_global");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(0);
        });

        it("returns location for export variable from header", () => {
            const headerText = `export variable shared_val;`;
            falloutSslProvider.reloadFileData!(testUri, headerText);

            const location = falloutSslProvider.getSymbolDefinition!("shared_val");
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(testUri);
            expect(location!.range.start.line).toBe(0);
        });
    });

    describe("hover within the .h file itself", () => {
        it("resolveSymbol should find procedure defined in the current .h file", () => {
            const headerText = `procedure roll_vs_stat(variable who, variable stat, variable mod) begin
   variable rnd = random(1, 100);
   return rnd;
end`;
            // No reloadFileData — test purely local lookup (text-based)
            const resolved = falloutSslProvider.resolveSymbol!("roll_vs_stat", headerText, testUri);

            expect(resolved).toBeDefined();
            expect(resolved?.hover).toBeDefined();
            expect(resolved?.name).toBe("roll_vs_stat");
        });

        it("resolveSymbol should find macro defined in the current .h file", () => {
            const headerText = `#define stat_success(x,y,z) (is_success(do_check(x,y,z)))`;
            const resolved = falloutSslProvider.resolveSymbol!("stat_success", headerText, testUri);

            expect(resolved).toBeDefined();
            expect(resolved?.hover).toBeDefined();
            expect(resolved?.name).toBe("stat_success");
        });

        it("resolveSymbol should find both macro and procedure in same .h file", () => {
            const headerText = `#define stat_success(x,y,z) (is_success(do_check(x,y,z)))

procedure roll_vs_stat(variable who, variable stat, variable mod) begin
   variable rnd = random(1, 100);
   return rnd;
end`;
            const macro = falloutSslProvider.resolveSymbol!("stat_success", headerText, testUri);
            const proc = falloutSslProvider.resolveSymbol!("roll_vs_stat", headerText, testUri);

            expect(macro).toBeDefined();
            expect(macro?.hover).toBeDefined();
            expect(proc).toBeDefined();
            expect(proc?.hover).toBeDefined();
        });

        it("resolveSymbol should find procedure with real-world .h content (stat_success + roll_vs_stat)", () => {
            // Reproduces exact user-reported case: macro works, procedure doesn't
            const headerText = `#define stat_success(x,y,z)                 (is_success(do_check(x,y,z)))

/**
 * Like \`roll_vs_skill\`, but for stat roll checks.
 * @arg {ObjectPtr} who Critter
 * @arg {int} stat STAT_*
 * @arg {int} mod Difficulty mod
 * @ret {int}
 */
procedure roll_vs_stat(variable who, variable stat, variable mod) begin
   variable rnd = random(1, 100);
   variable success = is_success(do_check(who, stat, mod));
   if success then begin
       if (rnd + (get_critter_stat(who, STAT_lu) - 5)) > 95 then return ROLL_CRITICAL_SUCCESS;
       else return ROLL_SUCCESS;
   end else begin
     if rnd > 95 then return ROLL_CRITICAL_FAILURE;
   end
   return ROLL_FAILURE;
end`;
            const macro = falloutSslProvider.resolveSymbol!("stat_success", headerText, testUri);
            const proc = falloutSslProvider.resolveSymbol!("roll_vs_stat", headerText, testUri);

            expect(macro).toBeDefined();
            expect(macro?.hover).toBeDefined();
            expect(proc).toBeDefined();
            expect(proc?.hover).toBeDefined();
        });
    });

    describe("## token-pasting in macro bodies", () => {
        it("resolveSymbol finds macro defined with ## token-pasting", () => {
            const headerText = `#define anim_to(x, type, dist)  animate_##type##_to_tile(dist)`;
            const resolved = falloutSslProvider.resolveSymbol!("anim_to", headerText, testUri);

            expect(resolved).toBeDefined();
            expect(resolved?.name).toBe("anim_to");
        });

        it("resolveSymbol finds procedures after a multiline macro with ## token-pasting", () => {
            // Regression: ## in a multiline macro body (with \\ continuation and begin/end)
            // used to create a giant ERROR node that swallowed all subsequent procedure
            // definitions, because error recovery consumed the 'end' keyword and the
            // define never properly terminated.
            const headerText = [
                "#define away_from_tile_type(x, type, dist)  if (anim_busy(self_obj) == false) then begin \\",
                "   global_temp := rotation_to_tile(x, self_tile); \\",
                "   animate_##type##_to_tile(tile_num_in_direction(self_tile, global_temp, dist)); \\",
                "end",
                "",
                "procedure roll_vs_stat(variable who, variable stat, variable mod) begin",
                "   return random(1, 100);",
                "end",
            ].join("\n");

            const resolved = falloutSslProvider.resolveSymbol!("roll_vs_stat", headerText, testUri);

            expect(resolved).toBeDefined();
            expect(resolved?.name).toBe("roll_vs_stat");
        });

        it("resolveSymbol finds both macro and procedure when multiline ## macro is present", () => {
            const headerText = [
                "#define away_from_tile_type(x, type, dist)  if (anim_busy(self_obj) == false) then begin \\",
                "   animate_##type##_to_tile(x); \\",
                "end",
                "",
                "#define stat_success(x,y,z)  (is_success(do_check(x,y,z)))",
                "",
                "procedure roll_vs_stat(variable who, variable stat, variable mod) begin",
                "   return random(1, 100);",
                "end",
            ].join("\n");

            const macro = falloutSslProvider.resolveSymbol!("stat_success", headerText, testUri);
            const proc = falloutSslProvider.resolveSymbol!("roll_vs_stat", headerText, testUri);

            expect(macro).toBeDefined();
            expect(proc).toBeDefined();
        });
    });

    it("getCompletions should return duplicates from multiple headers", async () => {
        const mockContext: ProviderContext = {
            workspaceRoot: "/mymod",
            settings: {} as MLSsettings,
        };
        await falloutSslProvider.init(mockContext);

        // Two headers define the same constant
        const headerA = "file:///mymod/headers/a.h";
        const headerB = "file:///mymod/headers/b.h";

        falloutSslProvider.reloadFileData!(headerA, "#define PIPBOY (0x400)");
        falloutSslProvider.reloadFileData!(headerB, "#define PIPBOY (0x400)");

        // getCompletions should return BOTH symbols
        const completions = falloutSslProvider.getCompletions!("file:///mymod/scripts/test.ssl");
        const pipboyCompletions = completions.filter((c) => c.label === "PIPBOY");

        // Both duplicates should be present
        expect(pipboyCompletions).toHaveLength(2);

        // Each should have different labelDetails.description showing source path
        const descriptions = pipboyCompletions.map((c) => c.labelDetails?.description);
        expect(descriptions).toContain("headers/a.h");
        expect(descriptions).toContain("headers/b.h");
    });
});
