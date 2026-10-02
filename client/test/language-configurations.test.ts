import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo-root";

const CONFIG_DIR = "language-configurations";
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const referenced: string[] = (pkg.contributes.languages as { configuration?: string }[])
    .flatMap((lang) => (lang.configuration === undefined ? [] : [path.normalize(lang.configuration)]))
    .filter((ref, i, all) => all.indexOf(ref) === i);
const onDisk = readdirSync(path.join(REPO_ROOT, CONFIG_DIR))
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(CONFIG_DIR, name));

describe("language configurations (contributes.languages[].configuration)", () => {
    it("points every language at a file that exists", () => {
        // Guards the guard: an empty manifest read would make every assertion here vacuous.
        expect(referenced.length).toBeGreaterThan(1);
        for (const ref of referenced) expect(existsSync(path.join(REPO_ROOT, ref)), ref).toBe(true);
    });

    it("leaves no configuration file unreferenced", () => {
        expect(onDisk.filter((file) => !referenced.includes(file))).toStrictEqual([]);
    });

    it("shares one file between languages whose rules are identical, rather than keeping a copy", () => {
        const byContent = new Map<string, string[]>();
        for (const file of onDisk) {
            const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
            byContent.set(text, [...(byContent.get(text) ?? []), file]);
        }
        expect([...byContent.values()].filter((files) => files.length > 1)).toStrictEqual([]);
    });
});
