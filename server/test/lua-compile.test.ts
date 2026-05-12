/**
 * Unit tests for lua-compile.ts.
 * Covers extension gating, luac output parsing, and missing-compiler handling.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
    execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);
vi.mock("fs", () => ({
    promises: {
        writeFile: (...args: unknown[]) => mockWriteFile(...args),
        unlink: (...args: unknown[]) => mockUnlink(...args),
    },
}));

const mockShowError = vi.fn();
vi.mock("../src/user-messages", () => ({
    showError: (...args: unknown[]) => mockShowError(...args),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
}));

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
}));

const mockSendParseResult = vi.fn();
vi.mock("../src/common", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/common")>();
    return {
        ...actual,
        sendParseResult: (...args: unknown[]) => mockSendParseResult(...args),
    };
});

const mockExtractLuaSegments = vi.fn();
const mockMapLuaLineToSource = vi.fn();
vi.mock("../src/core/menu-embedded", () => ({
    extractLuaSegments: (...args: unknown[]) => mockExtractLuaSegments(...args),
    mapLuaLineToSource: (...args: unknown[]) => mockMapLuaLineToSource(...args),
    buildCompiledLuaText: (segment: { lua: string; kind?: string }) => ({
        text:
            segment.kind === "expression" && segment.lua.includes("\n")
                ? `return (\n${segment.lua}\n)`
                : segment.kind === "expression"
                  ? `return (${segment.lua})`
                  : segment.lua,
        lineOffset: segment.kind === "expression" && segment.lua.includes("\n") ? 1 : 0,
    }),
}));

import { compile } from "../src/lua-compile";
import type { LuaSettings } from "../src/settings";
import { normalizeUri } from "../src/core/normalized-uri";

describe("lua-compile", () => {
    const LUA_URI = normalizeUri("file:///C:/tmp/test.lua");
    const MENU_URI = normalizeUri("file:///C:/tmp/ui.menu");
    const TXT_URI = normalizeUri("file:///C:/tmp/test.txt");

    const baseSettings: LuaSettings = {
        path: "/usr/bin/luac",
    };

    beforeEach(() => {
        vi.resetAllMocks();
        mockWriteFile.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
        mockExtractLuaSegments.mockReturnValue([
            {
                lua: "function display() end",
                sourceLineStart: 1,
                sourceLineEnd: 1,
                sourceUri: MENU_URI,
            },
        ]);
        mockMapLuaLineToSource.mockImplementation((luaLine, segment) => segment.sourceLineStart + (luaLine - 1));
    });

    function setupExecFile(err: unknown, stdout: string, stderr = "") {
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1];
            if (typeof cb === "function") {
                (cb as (error: unknown, out: string, errOut: string) => void)(err, stdout, stderr);
            }
        });
    }

    it("skips unsupported extensions", async () => {
        await compile(TXT_URI, baseSettings, true, "print('x')");

        expect(mockExecFile).not.toHaveBeenCalled();
        expect(mockSendParseResult).not.toHaveBeenCalled();
    });

    it("parses luac syntax errors from stderr and sends diagnostics", async () => {
        setupExecFile(new Error("exit code 1"), "", "luac: /tmp/tmp-lua.lua:3: unexpected symbol near 'end'");

        await compile(LUA_URI, baseSettings, false, "function x() end");

        expect(mockExecFile).toHaveBeenCalledTimes(1);
        expect(mockSendParseResult).toHaveBeenCalledTimes(1);
        const parseResult = mockSendParseResult.mock.calls[0]?.[0] as {
            errors: Array<{ line: number; message: string }>;
        };
        expect(parseResult.errors.length).toBe(1);
        expect(parseResult.errors[0]?.line).toBe(3);
        expect(parseResult.errors[0]?.message).toContain("unexpected symbol");
    });

    it("shows missing compiler error only in interactive mode", async () => {
        const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        setupExecFile(enoent, "", "");

        await compile(LUA_URI, baseSettings, true, "print('x')");

        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Lua compiler not found"));
    });

    it("extracts and compiles .menu files with line remapping", async () => {
        mockMapLuaLineToSource.mockImplementation((luaLine) => 5 + (luaLine - 1)); // Map lua line 3 → menu line 7
        setupExecFile(new Error("exit code 1"), "", "luac: /tmp/tmp-lua.lua:3: unexpected symbol near 'end'");

        const menuContent = "-- UI.MENU\nfunction display() end\nfunction x()\nend\nprint('test')\nend"; // 6 lines
        await compile(MENU_URI, baseSettings, false, menuContent);

        expect(mockExtractLuaSegments).toHaveBeenCalledWith(menuContent, MENU_URI);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
        expect(mockSendParseResult).toHaveBeenCalledTimes(1);

        const parseResult = mockSendParseResult.mock.calls[0]?.[0] as {
            errors: Array<{ line: number; message: string }>;
        };
        expect(parseResult.errors.length).toBe(1);
        expect(parseResult.errors[0]?.line).toBe(7); // Remapped from lua line 3
        expect(parseResult.errors[0]?.message).toContain("unexpected symbol");
    });

    it("sends diagnostics with original .menu URI after compilation", async () => {
        setupExecFile(null, "");

        const menuContent = "function test() print('hello') end";
        await compile(MENU_URI, baseSettings, false, menuContent);

        expect(mockSendParseResult).toHaveBeenCalledTimes(1);
        const callArgs = mockSendParseResult.mock.calls[0];
        expect(callArgs?.[1]).toBe(MENU_URI); // Second arg is the original URI
    });
});
