/**
 * Tests for settings.ts - configuration management.
 *
 * Note: The project() function modifies a shared defaultProjectSettings object,
 * so we need to reset modules between tests for isolation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

// Mock the common module to suppress logs during tests
vi.mock("../src/common", () => ({
    conlog: vi.fn(),
}));

// Mock fs module with hoisted mock
const mockReadFileSync = vi.fn();
vi.mock("fs", () => ({
    default: {
        readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    },
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("settings", () => {
    describe("defaultSettings", () => {
        it("should have correct falloutSSL defaults", async () => {
            const { defaultSettings } = await import("../src/settings");
            expect(defaultSettings.falloutSSL.compilePath).toBe("");
            expect(defaultSettings.falloutSSL.compileOptions).toBe("-q -p -l -O2 -d -s -n");
            expect(defaultSettings.falloutSSL.outputDirectory).toBe("");
            expect(defaultSettings.falloutSSL.headersDirectory).toBe("");
            expect(defaultSettings.falloutSSL.compileOnValidate).toBe(true);
        });

        it("should have correct weidu defaults", async () => {
            const { defaultSettings } = await import("../src/settings");
            expect(defaultSettings.weidu.path).toBe("weidu");
            expect(defaultSettings.weidu.gamePath).toBe("");
        });

        it("should have correct validation defaults", async () => {
            const { defaultSettings } = await import("../src/settings");
            expect(defaultSettings.validate).toBe("saveAndType");
        });

        it("should be a valid MLSsettings object", async () => {
            const { defaultSettings } = await import("../src/settings");
            expect(defaultSettings).toHaveProperty("falloutSSL");
            expect(defaultSettings).toHaveProperty("weidu");
            expect(defaultSettings).toHaveProperty("validate");
        });

        it("should normalize partial settings by filling defaults", async () => {
            const { normalizeSettings } = await import("../src/settings");
            const settings = normalizeSettings({
                falloutSSL: { compilePath: "compile" },
                weidu: { gamePath: "/game" },
            });
            expect(settings.validate).toBe("saveAndType");
            expect(settings.debug).toBe(false);
            expect(settings.falloutSSL.compilePath).toBe("compile");
            expect(settings.falloutSSL.compileOptions).toBe("-q -p -l -O2 -d -s -n");
            expect(settings.weidu.path).toBe("weidu");
            expect(settings.weidu.gamePath).toBe("/game");
        });
    });

    describe("shouldValidateOnSave()", () => {
        it('returns true for "save" mode', async () => {
            const { shouldValidateOnSave } = await import("../src/settings");
            expect(shouldValidateOnSave("save")).toBe(true);
        });

        it('returns true for "saveAndType" mode', async () => {
            const { shouldValidateOnSave } = await import("../src/settings");
            expect(shouldValidateOnSave("saveAndType")).toBe(true);
        });

        it('returns false for "type" mode', async () => {
            const { shouldValidateOnSave } = await import("../src/settings");
            expect(shouldValidateOnSave("type")).toBe(false);
        });
    });

    describe("shouldValidateOnChange()", () => {
        it('returns true for "type" mode', async () => {
            const { shouldValidateOnChange } = await import("../src/settings");
            expect(shouldValidateOnChange("type")).toBe(true);
        });

        it('returns true for "saveAndType" mode', async () => {
            const { shouldValidateOnChange } = await import("../src/settings");
            expect(shouldValidateOnChange("saveAndType")).toBe(true);
        });

        it('returns false for "save" mode', async () => {
            const { shouldValidateOnChange } = await import("../src/settings");
            expect(shouldValidateOnChange("save")).toBe(false);
        });
    });

    describe("project()", () => {
        beforeEach(() => {
            mockReadFileSync.mockReset();
            vi.resetModules();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should return default settings when dir is undefined", async () => {
            const { project } = await import("../src/settings");
            const settings = project(undefined);
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(true);
            expect(mockReadFileSync).not.toHaveBeenCalled();
        });

        it("should return default settings when .bgforge.yml does not exist", async () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT: no such file or directory");
            });

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should parse translation.directory from .bgforge.yml", async () => {
            const yamlContent = `
mls:
  translation:
    directory: custom_tra
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("custom_tra");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should parse translation.auto_tra from .bgforge.yml", async () => {
            const yamlContent = `
mls:
  translation:
    auto_tra: false
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(false);
        });

        it("should parse both translation settings from .bgforge.yml", async () => {
            const yamlContent = `
mls:
  translation:
    directory: lang
    auto_tra: false
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("lang");
            expect(settings.translation.auto_tra).toBe(false);
        });

        it("should ignore invalid translation.directory type", async () => {
            const yamlContent = `
mls:
  translation:
    directory: 123
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
        });

        it("should ignore invalid translation.auto_tra type", async () => {
            const yamlContent = `
mls:
  translation:
    auto_tra: "yes"
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should handle empty yml file", async () => {
            mockReadFileSync.mockReturnValue("");

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should handle yml without mls section", async () => {
            const yamlContent = `
other:
  setting: value
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should handle yml with mls but without translation section", async () => {
            const yamlContent = `
mls:
  other:
    setting: value
`;
            mockReadFileSync.mockReturnValue(yamlContent);

            const { project } = await import("../src/settings");
            const settings = project("/some/path");
            expect(settings.translation.directory).toBe("tra");
            expect(settings.translation.auto_tra).toBe(true);
        });

        it("should read from correct path", async () => {
            mockReadFileSync.mockReturnValue("");

            const { project } = await import("../src/settings");
            project("/test/workspace");

            expect(mockReadFileSync).toHaveBeenCalledWith(
                path.join("/test/workspace", ".bgforge.yml"),
                "utf8"
            );
        });

        it("should not contaminate defaults between calls", async () => {
            const customYaml = `
mls:
  translation:
    directory: custom
    auto_tra: false
`;
            mockReadFileSync.mockReturnValue(customYaml);
            const { project } = await import("../src/settings");

            // First call with custom settings
            const first = project("/workspace1");
            expect(first.translation.directory).toBe("custom");
            expect(first.translation.auto_tra).toBe(false);

            // Second call with no .bgforge.yml should return clean defaults
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT");
            });
            const second = project("/workspace2");
            expect(second.translation.directory).toBe("tra");
            expect(second.translation.auto_tra).toBe(true);
        });
    });
});
