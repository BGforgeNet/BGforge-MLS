/**
 * Integration tests for generate-data CLI: exercises the full file I/O path.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("generate-data CLI", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".gen-cli-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("generates completion JSON carrying each item's documentation", () => {
        const inputYaml = `funcs:
  type: 3
  items:
    - name: my_func
      detail: "void my_func()"
      doc: "Does things."
`;
        const inputFile = path.join(tmpDir, "data.yml");
        const completionFile = path.join(tmpDir, "completion.json");
        fs.writeFileSync(inputFile, inputYaml, "utf8");

        execSync(
            `pnpm exec tsx scripts/utils/src/generate-data.ts -i "${inputFile}" --completion "${completionFile}" --tooltip-lang test-tooltip`,
            { cwd: process.cwd(), timeout: SPAWN_TIMEOUT_MS },
        );

        const completion = JSON.parse(fs.readFileSync(completionFile, "utf8"));
        expect(completion).toHaveLength(1);
        expect(completion[0].label).toBe("my_func");
        // The documentation lives on the completion item - this is what replaced the separate
        // hover.<lang>.json, and what core/static-loader.ts reads hover content out of.
        expect(completion[0].documentation.value).toContain("Does things.");
    });

    it("generates signature JSON when --signature is provided", () => {
        const inputYaml = `funcs:
  type: 3
  items:
    - name: f
      type: int
      doc: "A function."
      args:
        - name: x
          type: int
          doc: "value"
`;
        const inputFile = path.join(tmpDir, "data.yml");
        const completionFile = path.join(tmpDir, "completion.json");
        const signatureFile = path.join(tmpDir, "signature.json");
        fs.writeFileSync(inputFile, inputYaml, "utf8");

        execSync(
            `pnpm exec tsx scripts/utils/src/generate-data.ts -i "${inputFile}" --completion "${completionFile}" --signature "${signatureFile}" --tooltip-lang test-tooltip`,
            { cwd: process.cwd(), timeout: SPAWN_TIMEOUT_MS },
        );

        const sig = JSON.parse(fs.readFileSync(signatureFile, "utf8"));
        expect(sig["f"]).toBeDefined();
        expect(sig["f"].label).toBe("f(x)");
    });
});
