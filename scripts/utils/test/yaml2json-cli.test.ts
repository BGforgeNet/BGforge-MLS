/**
 * Integration tests for yaml2json CLI: exercises the full file I/O path.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("yaml2json CLI", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".y2j-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("converts YAML to JSON with name inheritance", () => {
        const inputYaml = `scopeName: source.test
repository:
  keywords:
    name: keyword.control
    patterns:
      - match: "\\\\b(begin)\\\\b"
      - match: "\\\\b(end)\\\\b"
        name: keyword.special
`;
        const inputFile = path.join(tmpDir, "input.yml");
        const outputFile = path.join(tmpDir, "output.json");
        fs.writeFileSync(inputFile, inputYaml, "utf8");

        execSync(`pnpm exec tsx scripts/utils/src/yaml2json.ts "${inputFile}" "${outputFile}"`, {
            cwd: process.cwd(),
            timeout: SPAWN_TIMEOUT_MS,
        });

        const result = JSON.parse(fs.readFileSync(outputFile, "utf8"));
        expect(result.scopeName).toBe("source.test");
        expect(result.repository.keywords.patterns[0].name).toBe("keyword.control");
        expect(result.repository.keywords.patterns[1].name).toBe("keyword.special");
    });
});
