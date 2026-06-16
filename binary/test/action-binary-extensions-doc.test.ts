// Guard: the actions/binary docs must name exactly the formats @bgforge/binary supports.
//
// The action discovers its format set at runtime via `fgbin --extensions`, so its
// *behavior* never drifts. Its prose does: action.yml's marketplace `description` and
// the README's "at the time of writing" line enumerate the formats by hand. When the
// binary suite expands (a new parser registered in parserRegistry), those lists go
// stale silently. This test fails until they are updated, so the doc edit ships in the
// same change as the new format.
//
// Canonical source is parserRegistry.getExtensions() - the same list `fgbin --extensions`
// prints (see bin-cli.test.ts).

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parserRegistry } from "../src/index";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ACTION_YML = path.join(REPO_ROOT, "actions", "binary", "action.yml");
const ACTION_README = path.join(REPO_ROOT, "actions", "binary", "README.md");

// Registered extensions are stored without a leading dot; the docs write them dotted.
const registered = [...parserRegistry.getExtensions()].sort();

describe("actions/binary docs stay in sync with the parser registry", () => {
    it("action.yml description parenthetical lists exactly the registered formats", () => {
        const yml = fs.readFileSync(ACTION_YML, "utf8");
        const description = yml.match(/^description:\s*"([^"]*)"/m)?.[1];
        expect(description, "action.yml must have a quoted description").toBeDefined();

        // The format list lives in the single "(...)" group of the description.
        const paren = description?.match(/\(([^)]*)\)/)?.[1];
        expect(paren, "description should enumerate formats in parentheses").toBeDefined();

        const documented = [...(paren ?? "").matchAll(/\.([a-z0-9]+)/g)].map((m) => m[1]).sort();
        // Set-equality both ways: a new format must be added, a removed one must be dropped.
        expect(documented).toEqual(registered);
    });

    it("README names every registered format (as .<ext>)", () => {
        const readme = fs.readFileSync(ACTION_README, "utf8");
        for (const ext of registered) {
            expect(readme, `README should mention .${ext}`).toContain(`.${ext}`);
        }
    });
});
