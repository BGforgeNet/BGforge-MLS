import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TMP_BASE = "tmp";

beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("sort-yaml-stanzas-and-items CLI", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".sort-yaml-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("sorts a YAML file in place", () => {
        const inputFile = path.join(tmpDir, "input.yml");
        fs.writeFileSync(inputFile, `b:\n  value: 2\n\na:\n  value: 1\n`, "utf8");

        execSync(`pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts "${inputFile}"`, {
            cwd: process.cwd(),
        });

        expect(fs.readFileSync(inputFile, "utf8")).toBe(`a:
  value: 1

b:
  value: 2
`);
    });

    it("sorts a specific YAML sequence path in place", () => {
        const inputFile = path.join(tmpDir, "input.yml");
        fs.writeFileSync(
            inputFile,
            `repository:
  fallout-base-functions:
    patterns:
      - match: z
      - match: a
`,
            "utf8",
        );

        execSync(
            `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts "${inputFile}" --sequence-path repository.fallout-base-functions.patterns --sort-key match`,
            { cwd: process.cwd() },
        );

        expect(fs.readFileSync(inputFile, "utf8")).toBe(`repository:
  fallout-base-functions:
    patterns:
      - match: a
      - match: z
`);
    });

    it("sorts patterns in all map entries via --map-path and --sequence-key", () => {
        const inputFile = path.join(tmpDir, "input.yml");
        fs.writeFileSync(
            inputFile,
            `repository:
  beta:
    patterns:
      - match: z
      - match: a
  alpha:
    patterns:
      - match: y
      - match: b
`,
            "utf8",
        );

        execSync(
            `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts "${inputFile}" --map-path repository --sequence-key patterns --sort-key match`,
            { cwd: process.cwd() },
        );

        expect(fs.readFileSync(inputFile, "utf8")).toBe(`repository:
  beta:
    patterns:
      - match: a
      - match: z
  alpha:
    patterns:
      - match: b
      - match: y
`);
    });

    it("sorts a specific YAML sequence path with blank lines removed", () => {
        const inputFile = path.join(tmpDir, "input.yml");
        fs.writeFileSync(
            inputFile,
            `repository:
  fallout-base-functions:
    patterns:
      - match: z

      - match: a
`,
            "utf8",
        );

        execSync(
            `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts "${inputFile}" --sequence-path repository.fallout-base-functions.patterns --sort-key match`,
            { cwd: process.cwd() },
        );

        expect(fs.readFileSync(inputFile, "utf8")).toBe(`repository:
  fallout-base-functions:
    patterns:
      - match: a
      - match: z
`);
    });
});
