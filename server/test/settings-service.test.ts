/**
 * Unit tests for settings-service.ts - settings holder that breaks circular dependency.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { initSettingsService, getDocumentSettings } from "../src/settings-service";
import { defaultSettings } from "../src/settings";

describe("settings-service", () => {
    beforeEach(() => {
        // Reset by initializing with undefined to clear internal state for test isolation
        initSettingsService(undefined as unknown as Parameters<typeof initSettingsService>[0]);
    });

    it("throws if getDocumentSettings called before init", () => {
        expect(() => getDocumentSettings("file:///test.ts")).toThrow("Settings service not initialized");
    });

    it("delegates to the registered getter after init", async () => {
        const mockSettings = { ...defaultSettings, validate: "saveAndType" as const };
        const getter = (_resource: string) => Promise.resolve(mockSettings);
        initSettingsService(getter);

        const result = await getDocumentSettings("file:///test.ts");
        expect(result).toBe(mockSettings);
    });

    it("passes resource URI to the getter", async () => {
        const calls: string[] = [];
        const getter = (resource: string) => {
            calls.push(resource);
            return Promise.resolve(defaultSettings);
        };
        initSettingsService(getter);

        await getDocumentSettings("file:///my-file.tp2");
        expect(calls).toEqual(["file:///my-file.tp2"]);
    });
});
