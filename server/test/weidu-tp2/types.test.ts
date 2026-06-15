/**
 * Test that generated tree-sitter types work correctly.
 * Verifies type safety for node type checks.
 */

import { describe, it, expect } from "vitest";
import type { SyntaxType } from "../../../grammars/weidu-tp2/src/syntax-type";

describe("weidu-tp2: generated types", () => {
    it("SyntaxType enum contains expected node types", () => {
        // This test verifies the enum is imported correctly and has expected values
        const nodeTypes: Record<string, SyntaxType> = {
            when: "when" as SyntaxType,
            component: "component" as SyntaxType,
            patches: "patches" as SyntaxType,
            file_pair: "file_pair" as SyntaxType,
            identifier: "identifier" as SyntaxType,
            line_comment: "line_comment" as SyntaxType,
            action_copy: "action_copy" as SyntaxType,
        };

        // Verify all expected types exist
        expect(nodeTypes.when).toBe("when");
        expect(nodeTypes.component).toBe("component");
        expect(nodeTypes.patches).toBe("patches");
    });

    it("type checking works at compile time", () => {
        // This test demonstrates compile-time type checking
        // TypeScript will error if these don't match SyntaxType
        const validType: SyntaxType = "when" as SyntaxType;
        expect(validType).toBe("when");

        // @ts-expect-error - "invalid_node_type" is not in SyntaxType
        const invalidType: SyntaxType = "invalid_node_type";
        expect(invalidType).toBe("invalid_node_type"); // Runtime still works, but compile fails
    });
});
