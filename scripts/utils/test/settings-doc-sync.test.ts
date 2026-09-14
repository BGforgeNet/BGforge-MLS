/**
 * docs/settings.md against the manifest's `contributes.configuration`.
 *
 * The settings table is the reference every editor guide sends users to, and it is a hand-kept copy of the
 * manifest: a setting added, renamed, removed or re-defaulted in package.json leaves the table describing
 * a setting that behaves otherwise. This pins the key set and each default.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

interface ConfigurationBlock {
    readonly properties: Record<string, { readonly default?: unknown }>;
}

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    contributes: { configuration: ConfigurationBlock | ConfigurationBlock[] };
};
const { configuration } = pkg.contributes;
const blocks = Array.isArray(configuration) ? configuration : [configuration];
const manifest = new Map(blocks.flatMap((block) => Object.entries(block.properties)));

const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/settings.md"), "utf8");
const documented = new Map(
    [...doc.matchAll(/^\| `(bgforge\.[\w.]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]),
);

/** How the table writes a default: an empty string as `""`, any other string bare, everything else as JSON. */
function asDocumented(value: unknown): string {
    if (typeof value === "string") return value === "" ? '`""`' : `\`${value}\``;
    return `\`${JSON.stringify(value)}\``;
}

describe("docs/settings.md matches package.json contributes.configuration", () => {
    it("documents exactly the settings the manifest contributes", () => {
        expect([...documented.keys()].sort()).toEqual([...manifest.keys()].sort());
    });

    it.each([...manifest.entries()])("%s: documented default matches the manifest", (key, property) => {
        expect(documented.get(key), `docs/settings.md default for ${key}`).toBe(asDocumented(property.default));
    });
});
