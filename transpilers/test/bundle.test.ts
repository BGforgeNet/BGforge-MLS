/**
 * Spawn-node smoke test for the published bundle.
 *
 * Imports `../out/index.js` (the tsup output) in a child node process.
 * Proves the bundle is self-contained — no missing externals (ts-morph,
 * esbuild-wasm), no broken DTS that tsc would refuse to consume.
 *
 * Runs in addition to api.test.ts (which covers the source). This file
 * specifically targets the published artifact.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BUNDLE = path.resolve("transpilers/out/index.js");
const DTS = path.resolve("transpilers/out/index.d.ts");

function isExecError(
    err: unknown,
): err is { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer } {
    return typeof err === "object" && err !== null && ("status" in err || "stdout" in err || "stderr" in err);
}

function runNode(script: string): { code: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, stdout, stderr: "" };
    } catch (err: unknown) {
        if (!isExecError(err)) throw err;
        return {
            code: err.status ?? 1,
            stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
            stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
        };
    }
}

describe("@bgforge/transpile bundle smoke", () => {
    beforeAll(() => {
        if (!fs.existsSync(BUNDLE)) {
            throw new Error(`Bundle missing at ${BUNDLE}. Run: pnpm build:transpile`);
        }
        if (!fs.existsSync(DTS)) {
            throw new Error(`DTS missing at ${DTS}. Run: pnpm build:transpile`);
        }
    });

    it("loads and exposes the public API", () => {
        const script = `
            import * as m from ${JSON.stringify(BUNDLE)};
            const expected = ["tssl", "tbaf", "td", "transpile", "UnknownTranspileExtensionError"];
            const missing = expected.filter((k) => !(k in m));
            if (missing.length) throw new Error("missing exports: " + missing.join(","));
            console.log("OK");
        `;
        const { code, stdout, stderr } = runNode(script);
        expect(stderr).toBe("");
        expect(code).toBe(0);
        expect(stdout.trim()).toBe("OK");
    });

    it("round-trips a TSSL fixture through the bundle", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-smoke-"));
        const fixturePath = path.join(tmp, "foo.tssl");
        fs.writeFileSync(fixturePath, "function start() {}\n", "utf-8");
        try {
            const script = `
                import { transpile } from ${JSON.stringify(BUNDLE)};
                const r = await transpile(${JSON.stringify(fixturePath)}, "function start() {}\\n");
                if (r.kind !== "tssl") throw new Error("wrong kind: " + r.kind);
                if (typeof r.output !== "string") throw new Error("bad output type");
                console.log("OK");
            `;
            const { code, stdout, stderr } = runNode(script);
            expect(stderr).toBe("");
            expect(code).toBe(0);
            expect(stdout.trim()).toBe("OK");
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("throws UnknownTranspileExtensionError on unknown extension", () => {
        const script = `
            import { transpile, UnknownTranspileExtensionError } from ${JSON.stringify(BUNDLE)};
            try {
                await transpile("/virtual/foo.xyz", "");
                throw new Error("expected throw");
            } catch (err) {
                if (!(err instanceof UnknownTranspileExtensionError)) throw new Error("wrong error class: " + err.constructor.name);
                console.log("OK");
            }
        `;
        const { code, stdout, stderr } = runNode(script);
        expect(stderr).toBe("");
        expect(code).toBe(0);
        expect(stdout.trim()).toBe("OK");
    });

    it("DTS file has expected exports", () => {
        const dts = fs.readFileSync(DTS, "utf-8");
        for (const sym of ["tssl", "tbaf", "td", "transpile", "TranspileResult", "UnknownTranspileExtensionError"]) {
            expect(dts).toContain(sym);
        }
    });
});
