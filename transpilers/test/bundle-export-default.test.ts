/**
 * A dialog declared through `export default` survives bundling.
 *
 * With an import present the bundler rewrites the entry's `export default begin(...)` as a `var` binding plus
 * `export { x as default }`, and TD skips `var` statements - so the whole dialog vanished with no error, while the
 * same file without an import transpiled. The unbundled twin is the reference output.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { transpile } from "../src/index";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "transpilers/test/fixtures/export-default");

/** The emitted D without its first line, which names the source file and so differs between the twins. */
async function body(entryName: string): Promise<string> {
    const entry = path.join(FIXTURE, entryName);
    const result = await transpile(entry, fs.readFileSync(entry, "utf-8"));
    return (result.output as string).split("\n").slice(1).join("\n");
}

describe("export default in a bundled .td", () => {
    it("emits the dialog", async () => {
        expect(await body("bundled.td")).toContain("BEGIN TDDEF");
    });

    it("emits the same D as the unbundled twin", async () => {
        expect(await body("bundled.td")).toBe(await body("plain.td"));
    });
});
