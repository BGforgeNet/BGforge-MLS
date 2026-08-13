/**
 * Re-derive the capture sets vendored in editor-captures.ts from their upstream sources and report drift.
 *
 * Manual, not part of any gate: it needs the network, and the Zed set comes from a ~150 MB release
 * download. Run it when an editor releases, or when a query change is rejected by a set that looks stale;
 * apply what it prints by hand, so the curated provenance comments survive.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/check-editor-captures.ts [--zed]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { HELIX_SCOPES, NEOVIM_CAPTURES, ZED_THEME_KEYS } from "./editor-captures.ts";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const NEOVIM_DOC = "https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/treesitter.txt";
const HELIX_DOC = "https://raw.githubusercontent.com/helix-editor/helix/master/book/src/themes.md";
const ZED_RELEASE = "https://zed.dev/api/releases/stable/latest/zed-linux-x86_64.tar.gz";

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.text();
}

/** The `@`-prefixed names Neovim documents, one per line in treesitter-highlight-groups. */
function deriveNeovim(doc: string): string[] {
    return [...new Set([...doc.matchAll(/^\s*@([a-z][a-z0-9_.]*)/gm)].map((m) => m[1] ?? ""))].filter(Boolean).sort();
}

/** Helix lists scopes as an indented bullet hierarchy; the theme key is the dotted path to a node. */
function deriveHelix(doc: string): string[] {
    const found = new Set<string>();
    const stack = new Map<number, string>();
    for (const line of doc.split("\n")) {
        const m = /^(\s*)- `([a-z0-9_.]+)`/.exec(line);
        if (!m) continue;
        const depth = (m[1] ?? "").length / 2;
        stack.set(depth, m[2] ?? "");
        for (const d of stack.keys()) if (d > depth) stack.delete(d);
        found.add(
            [...stack.keys()]
                .sort((a, b) => a - b)
                .map((d) => stack.get(d))
                .join("."),
        );
    }
    return [...found].sort();
}

/**
 * Zed's theme keys come from the theme JSON embedded in its binary - a `"<name>": {` followed by a
 * `"color":` line - because the published capture table omits keys the shipped themes define.
 */
function deriveZed(binary: string): string[] {
    const strings = execFileSync("strings", ["-n", "4", binary], {
        encoding: "utf-8",
        maxBuffer: 512 * 1024 * 1024,
        timeout: SPAWN_TIMEOUT_MS,
    });
    const found = new Set<string>();
    let pending: string | undefined;
    for (const line of strings.split("\n")) {
        const m = /^\s*"([a-z0-9_.]+)": \{$/.exec(line);
        if (m) {
            pending = m[1];
            continue;
        }
        if (line.includes('"color":') && pending !== undefined) found.add(pending);
        pending = undefined;
    }
    return [...found].sort();
}

function report(name: string, vendored: readonly string[], derived: readonly string[]): boolean {
    const added = derived.filter((c) => !vendored.includes(c));
    const removed = vendored.filter((c) => !derived.includes(c));
    if (added.length === 0 && removed.length === 0) {
        console.log(`${name}: ${vendored.length} captures, no drift`);
        return false;
    }
    console.log(`${name}: DRIFT (vendored ${vendored.length}, upstream ${derived.length})`);
    if (added.length > 0) console.log(`  upstream added:   ${added.join(", ")}`);
    if (removed.length > 0) console.log(`  no longer listed: ${removed.join(", ")}`);
    return true;
}

async function main(): Promise<void> {
    const { values } = parseArgs({ options: { zed: { type: "boolean", default: false } } });
    let drifted = false;

    drifted = report("neovim", NEOVIM_CAPTURES, deriveNeovim(await fetchText(NEOVIM_DOC))) || drifted;
    drifted = report("helix", HELIX_SCOPES, deriveHelix(await fetchText(HELIX_DOC))) || drifted;

    if (values.zed) {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "zed-captures-"));
        try {
            const tarball = path.join(work, "zed.tar.gz");
            const release = await fetch(ZED_RELEASE);
            fs.writeFileSync(tarball, Buffer.from(await release.arrayBuffer()));
            execFileSync("tar", ["xzf", tarball, "-C", work, "--no-same-owner", "zed.app/libexec/zed-editor"], {
                timeout: SPAWN_TIMEOUT_MS,
            });
            drifted =
                report("zed", ZED_THEME_KEYS, deriveZed(path.join(work, "zed.app/libexec/zed-editor"))) || drifted;
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    } else {
        console.log("zed: skipped (pass --zed to download the release and read its embedded themes)");
    }

    // Drift is information, not a failure: an editor adding a capture breaks nothing here. The exit code
    // is there so a wrapper can notice.
    if (drifted) process.exitCode = 1;
}

await main();
