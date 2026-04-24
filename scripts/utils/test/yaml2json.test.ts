/**
 * Tests for yaml2json module: tmLanguage YAML-to-JSON conversion
 * with name field inheritance.
 */

import { describe, expect, it } from "vitest";
import { expandRepository } from "../src/yaml2json.ts";

describe("expandRepository", () => {
    it("inherits name from parent to child patterns without name", () => {
        const data = {
            repository: {
                keywords: {
                    name: "keyword.control.lang",
                    patterns: [{ match: "\\b(begin)\\b" }, { match: "\\b(end)\\b" }],
                },
            },
        };
        const result = expandRepository(data);
        const patterns = result.repository!["keywords"]!.patterns!;
        expect(patterns[0]!.name).toBe("keyword.control.lang");
        expect(patterns[1]!.name).toBe("keyword.control.lang");
    });

    it("preserves existing name on child patterns", () => {
        const data = {
            repository: {
                keywords: {
                    name: "keyword.control.lang",
                    patterns: [{ match: "\\b(begin)\\b", name: "keyword.special.lang" }, { match: "\\b(end)\\b" }],
                },
            },
        };
        const result = expandRepository(data);
        const patterns = result.repository!["keywords"]!.patterns!;
        expect(patterns[0]!.name).toBe("keyword.special.lang");
        expect(patterns[1]!.name).toBe("keyword.control.lang");
    });

    it("skips entries without name", () => {
        const data = {
            repository: {
                comments: {
                    patterns: [{ match: "//.*", name: "comment.line" }],
                },
            },
        };
        const result = expandRepository(data);
        expect(result.repository!["comments"]!.patterns![0]!.name).toBe("comment.line");
    });

    it("skips entries without patterns", () => {
        const data = {
            repository: {
                other: {
                    name: "some.scope",
                    begin: "/*",
                    end: "*/",
                },
            },
        };
        const result = expandRepository(data);
        expect(result.repository!["other"]!.name).toBe("some.scope");
    });

    it("returns data as-is when no repository", () => {
        const data = { scopeName: "source.test" };
        const result = expandRepository(data);
        expect(result).toEqual({ scopeName: "source.test" });
    });

    it("does not mutate the original data", () => {
        const original = {
            repository: {
                kw: {
                    name: "keyword.lang",
                    patterns: [{ match: "\\b(x)\\b" }],
                },
            },
        };
        expandRepository(original);
        // Original should not have name added
        expect(original.repository.kw.patterns[0]).not.toHaveProperty("name");
    });
});
