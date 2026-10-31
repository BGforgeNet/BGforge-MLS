/**
 * Guard: each published Action's `version` input defaults to the version its CLI package's manifest declares.
 *
 * The Action installs its CLI from npm at run time, so the default is a hand-written copy of the package version.
 * A library release bumps the manifest; without this check the Action would keep installing the previous CLI, or,
 * with a stale default left as `latest`, an unpinned one.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** Each Action directory and the package directory whose CLI it installs. */
const ACTION_PACKAGES = [
    { action: "binary", pkgDir: "binary" },
    { action: "format", pkgDir: "format" },
    { action: "transpile", pkgDir: "transpilers" },
    { action: "tssl", pkgDir: "compilers/tssl" },
] as const;

interface ActionYaml {
    inputs: { version: { default: unknown } };
    runs: { steps: { run?: unknown }[] };
}

// Unchecked casts over committed files: a shape that differs throws or fails an assertion below, which is the guard.
const readJson = (file: string): { name: string; version: string } =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")) as { name: string; version: string };

const readAction = (action: string): ActionYaml =>
    YAML.parse(fs.readFileSync(path.join(repoRoot, "actions", action, "action.yml"), "utf8")) as ActionYaml;

describe("published Actions' CLI version default", () => {
    it("covers every Action directory", () => {
        const actionDirs = fs
            .readdirSync(path.join(repoRoot, "actions"), { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() && fs.existsSync(path.join(repoRoot, "actions", entry.name, "action.yml")),
            )
            .map((entry) => entry.name)
            .sort();
        expect(actionDirs).toEqual(ACTION_PACKAGES.map((entry) => entry.action).sort());
    });

    for (const { action, pkgDir } of ACTION_PACKAGES) {
        it(`actions/${action} defaults to the ${pkgDir} package version and installs that package`, () => {
            const pkg = readJson(`${pkgDir}/package.json`);
            const parsed = readAction(action);
            expect(parsed.inputs.version.default).toBe(pkg.version);
            // The default only pins what the install step installs: the step must name the same package.
            const installs = parsed.runs.steps.some(
                (step) => typeof step.run === "string" && step.run.includes(`"${pkg.name}@\${PKG_VERSION}"`),
            );
            expect(installs, `no step installs "${pkg.name}@\${PKG_VERSION}"`).toBe(true);
        });
    }
});
