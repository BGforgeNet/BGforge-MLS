/**
 * The committed oracle manifest: for every corpus script, the digest of what the bundled compiler
 * produced from OUR preprocessed text at each optimisation level, or `refused` where it refused.
 *
 * The corpus differential used to obtain these live - ~4500 synchronous child processes per run, each
 * paying a runtime boot for a compile that takes milliseconds - which made the close-out gate's dominant
 * cost re-deriving answers that cannot change while the inputs are pinned. Both inputs ARE pinned in
 * committed files: the compiler as a dependency URL in `server/package.json` (content-guarded by the
 * lockfile's integrity hash), the corpus as per-repo commit SHAs in `external/fallout.txt`. So the
 * oracles are committed as data, the sweep compares digests in-process, and `pnpm ssl-oracles` re-runs
 * the live differential to regenerate them.
 *
 * Staleness fails LOUD in both directions. A corpus change moves our own output, so old digests mismatch
 * and the sweep goes red on its own; a compiler bump would NOT move our output, so the sweep would stay
 * silently green against a dead oracle - which is why the manifest records the pins it was generated
 * from and the sweep's first assertion is that they still match. The compiler pin is recorded as a
 * digest of the dependency URL rather than the URL itself, keeping this package's convention that the
 * bundled compiler goes unnamed in prose while still pinning its exact identity.
 *
 * One convention rides on the generator rather than a pin: the digests describe the compiler's output
 * for OUR preprocessor's text (the differential has always fed both sides the same preprocessed source,
 * to isolate codegen). A preprocessing change that alters the bytes reddens the sweep and a regeneration
 * settles it against the live compiler; regenerate after any deliberate preprocessor behaviour change.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// Anchored to this file rather than through the shared `repo-root` helper: that helper reads
// `__dirname`, which the `pnpm ssl-oracles` ES-module entry chain does not have - the sibling
// `ssl-verdicts.mts` computes its own for the same reason.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

export const LEVELS = [0, 1, 2] as const;

/** A script's oracle at one level: the sha256 of the compiled bytes, or a refusal. */
export type OracleDigest = string | "refused";

export interface OracleManifest {
    /** `sha256:<hex>` over the compiler dependency's pin string. */
    compilerPin: string;
    /** The pinned corpus repos, verbatim `<url> <sha>` lines from external/fallout.txt. */
    corpusPins: string[];
    /** Script path relative to external/fallout, to `[o0, o1, o2]`. */
    entries: Map<string, [OracleDigest, OracleDigest, OracleDigest]>;
}

/** Where the manifest lives, beside the sweeps that read it. */
export const MANIFEST_PATH = path.join(REPO_ROOT, "compilers/ssl/test/integration/reference-oracles.txt");

/** The dependency that carries the bundled compiler; its pin string is what identifies a build. */
export const COMPILER_DEPENDENCY = "sslc-emscripten-noderawfs";

/**
 * The pinned repos the oracles depend on: the three that contribute scripts, and sfall, whose headers
 * global-setup links into the corpus before anything preprocesses.
 */
export const CORPUS_REPOS = ["Fallout2_Restoration_Project", "FO2tweaks", "Fallout2_Party_Orders", "sfall"] as const;

const HEADER = [
    "# Corpus oracle digests: sha256 of the compiled bytes per script per level (-O0 -O1 -O2), or",
    "# 'refused'. Generated against the pinned compiler and corpus by: pnpm ssl-oracles",
    "# The integration sweeps compare against these and refuse to run when the pins below have moved.",
].join("\n");

export function formatManifest(manifest: OracleManifest): string {
    const lines = [HEADER, `compiler ${manifest.compilerPin}`];
    for (const pin of manifest.corpusPins) lines.push(`corpus ${pin}`);
    for (const [script, digests] of [...manifest.entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${script} ${digests.join(" ")}`);
    }
    return `${lines.join("\n")}\n`;
}

export function parseManifest(text: string): OracleManifest {
    let compilerPin = "";
    const corpusPins: string[] = [];
    const entries: OracleManifest["entries"] = new Map();
    for (const line of text.split("\n")) {
        if (line === "" || line.startsWith("#")) continue;
        const fields = line.split(" ");
        if (fields[0] === "compiler" && fields.length === 2) {
            compilerPin = fields[1] as string;
        } else if (fields[0] === "corpus") {
            corpusPins.push(fields.slice(1).join(" "));
        } else if (fields.length === 4) {
            entries.set(fields[0] as string, [fields[1] as string, fields[2] as string, fields[3] as string]);
        } else {
            // A dropped line silently shrinks the comparison while every count stays plausible.
            throw new Error(`malformed oracle manifest line: ${line}`);
        }
    }
    return { compilerPin, corpusPins, entries };
}

/**
 * What has moved since the manifest was generated - empty means fresh. Each finding names the pin, so
 * the failure reads as "regenerate", not as a compiler defect.
 */
export function staleness(manifest: OracleManifest, compilerPin: string, corpusPins: readonly string[]): string[] {
    const stale: string[] = [];
    if (manifest.compilerPin !== compilerPin) {
        stale.push("the compiler dependency's pin has moved since the manifest was generated");
    }
    for (const pin of corpusPins) {
        if (!manifest.corpusPins.includes(pin)) stale.push(`corpus pin moved: ${pin}`);
    }
    for (const pin of manifest.corpusPins) {
        if (!corpusPins.includes(pin)) stale.push(`manifest was generated against: ${pin}`);
    }
    return stale;
}

/** `sha256:<hex>` over the named dependency's pin string in a package.json - identity without the name. */
export function compilerPinKey(packageJsonText: string, dependency: string): string {
    const manifest = JSON.parse(packageJsonText) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        // Where the compiler actually sits: optional, so an install without the tarball still resolves.
        optionalDependencies?: Record<string, string>;
    };
    const pin =
        manifest.dependencies?.[dependency] ??
        manifest.devDependencies?.[dependency] ??
        manifest.optionalDependencies?.[dependency];
    if (pin === undefined) throw new Error(`'${dependency}' is not a dependency in the given package.json`);
    return `sha256:${createHash("sha256").update(pin).digest("hex")}`;
}

/** The pinned `<url> <sha>` lines for the named repos, in the order asked for. */
export function corpusPinsOf(pinFileText: string, repos: readonly string[]): string[] {
    const lines = pinFileText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
    return repos.map((repo) => {
        const line = lines.find((candidate) => {
            const [url, sha] = candidate.split(/\s+/);
            return url?.endsWith(`/${repo}`) === true && /^[0-9a-f]{40}$/.test(sha ?? "");
        });
        if (line === undefined) throw new Error(`'${repo}' is not pinned in the corpus pin file`);
        return line.replaceAll(/\s+/g, " ");
    });
}

/** The pins as they stand in the working tree, the shape `staleness` compares a manifest against. */
export function currentPins(): { compilerPin: string; corpusPins: string[] } {
    return {
        compilerPin: compilerPinKey(
            fs.readFileSync(path.join(REPO_ROOT, "server/package.json"), "utf-8"),
            COMPILER_DEPENDENCY,
        ),
        corpusPins: corpusPinsOf(fs.readFileSync(path.join(REPO_ROOT, "external/fallout.txt"), "utf-8"), CORPUS_REPOS),
    };
}

/** Loads the committed manifest; absent means it was never generated on this branch. */
export function loadManifest(): OracleManifest | null {
    if (!fs.existsSync(MANIFEST_PATH)) return null;
    return parseManifest(fs.readFileSync(MANIFEST_PATH, "utf-8"));
}

export function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
