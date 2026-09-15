/**
 * A package that can be published declares no URL, git or file dependency where consumers install it.
 *
 * pnpm refuses such a dependency inside an installed package by default (`blockExoticSubdeps`), so one in
 * `dependencies`, `optionalDependencies` or `peerDependencies` makes `pnpm add` of the published package fail
 * outright, and nothing in this repository notices: its own install resolves the workspace directly. A
 * non-registry artifact the package needs at run time is copied into its build output instead (the server's SSL
 * compiler, in scripts/build-base-server.sh), and stays a dev dependency.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Specifiers that resolve through the registry once published: a range, a tag, or a pnpm protocol it rewrites. */
const REGISTRY_SPECIFIER = /^(?:workspace:|catalog:|npm:|[\^~<>=*\d]|latest$|[a-z][\w.-]*$)/;

const MANIFESTS = execFileSync("git", ["ls-files", "package.json", "**/package.json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
})
    .split("\n")
    .filter((file) => file !== "")
    .filter((file) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")) as { private?: boolean };
        return manifest.private !== true;
    })
    .sort();

describe("publishable packages declare only registry dependencies", () => {
    it("finds the publishable manifests", () => {
        expect(MANIFESTS).toContain("server/package.json");
    });

    it("recognises a URL dependency as non-registry", () => {
        expect(REGISTRY_SPECIFIER.test("https://github.com/o/r/releases/download/t/a.tar.gz")).toBe(false);
        expect(REGISTRY_SPECIFIER.test("github:o/r")).toBe(false);
        expect(REGISTRY_SPECIFIER.test("file:../x")).toBe(false);
        expect(REGISTRY_SPECIFIER.test("^0.28.2")).toBe(true);
    });

    it.each(MANIFESTS)("%s", (file) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")) as Record<
            string,
            Record<string, string> | undefined
        >;
        const offenders = ["dependencies", "optionalDependencies", "peerDependencies"].flatMap((field) =>
            Object.entries(manifest[field] ?? {})
                .filter(([, spec]) => !REGISTRY_SPECIFIER.test(spec))
                .map(([name, spec]) => `${field}.${name}: ${spec}`),
        );
        expect(offenders, `${file} declares a dependency consumers cannot install`).toEqual([]);
    });
});
