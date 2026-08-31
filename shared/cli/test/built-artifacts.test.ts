/**
 * Tests for the built-artifact gate.
 *
 * The behaviour worth pinning is the asymmetry: absence is a skip in the dev loop and a failure in the
 * close-out gate. A guard that silently returned false under MLS_REQUIRE_BUILT_ARTIFACTS would restore
 * the exact hole it was written to close, and nothing else in the suite would notice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "path";
import { builtArtifactsPresent } from "./built-artifacts.ts";
import { REPO_ROOT } from "./repo-root.ts";

/** Two paths that certainly exist, and one that certainly does not. */
const PRESENT = path.join(REPO_ROOT, "package.json");
const ALSO_PRESENT = path.join(REPO_ROOT, "pnpm-workspace.yaml");
const ABSENT = path.join(REPO_ROOT, "no-such-build-artifact.json");

const STRICT_ENV = "MLS_REQUIRE_BUILT_ARTIFACTS";

describe("builtArtifactsPresent", () => {
    let previous: string | undefined;

    beforeEach(() => {
        previous = process.env[STRICT_ENV];
        delete process.env[STRICT_ENV];
    });

    afterEach(() => {
        if (previous === undefined) delete process.env[STRICT_ENV];
        else process.env[STRICT_ENV] = previous;
        vi.restoreAllMocks();
    });

    it("reports present when every artifact exists", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(builtArtifactsPresent([PRESENT, ALSO_PRESENT], "pnpm build:grammar")).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it("skips loudly outside the gate, naming the missing path and the build command", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(builtArtifactsPresent([PRESENT, ABSENT], "pnpm build:grammar")).toBe(false);

        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0]![0] as string;
        expect(message).toContain(ABSENT);
        expect(message).toContain("pnpm build:grammar");
        // The present one is not reported as missing.
        expect(message).not.toContain(PRESENT);
    });

    it("fails inside the gate instead of shrinking the run", () => {
        process.env[STRICT_ENV] = "1";

        expect(() => builtArtifactsPresent([ABSENT], "pnpm build:grammar")).toThrow(ABSENT);
    });

    it("still reports present inside the gate when the artifacts are there", () => {
        process.env[STRICT_ENV] = "1";

        expect(builtArtifactsPresent([PRESENT], "pnpm build:grammar")).toBe(true);
    });
});
