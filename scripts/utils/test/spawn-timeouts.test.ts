/**
 * Every synchronous child-process spawn passes a timeout.
 *
 * `execFileSync`/`execSync`/`spawnSync` block the calling thread until the child exits, and nothing outside
 * that thread can interrupt them - a vitest per-test timeout is enforced from an event loop the blocked worker
 * never yields to, so a wedged child hangs the whole run with no failing test and no reporter output. A corpus
 * differential once sat for 45 minutes that way, on one bad input out of ~1500, having passed in four minutes
 * the run before.
 *
 * The per-site option is the only bound available, so this pins it repo-wide rather than leaving it to whoever
 * writes the next spawn. Scanning tracked source keeps it honest for files no suite happens to import.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const SYNC_SPAWN = /\b(execFileSync|execSync|spawnSync)\s*\(/g;

/**
 * TypeScript sources, excluding this file - its own regex literals would match.
 *
 * `--others --exclude-standard` includes files not yet committed: a bare `ls-files` sees only tracked
 * paths, so a newly written file is invisible to this guard until it lands - which is precisely when the
 * mistake is being made and cheapest to catch.
 */
function sources(): string[] {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.mts"], {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
    })
        .split("\n")
        .filter(Boolean)
        .filter((file) => !file.endsWith("scripts/utils/test/spawn-timeouts.test.ts"));
}

/**
 * The call's argument list, by scanning from the opening paren to its match. A regex cannot do this: the
 * arguments contain their own parens (template literals, nested calls), and the options object routinely spans
 * several lines.
 */
function callText(text: string, openParen: number): string {
    let depth = 0;
    for (let i = openParen; i < text.length; i++) {
        const ch = text[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
            depth--;
            if (depth === 0) return text.slice(openParen, i + 1);
        }
    }
    return text.slice(openParen);
}

interface Site {
    file: string;
    line: number;
    call: string;
}

function spawnSites(): Site[] {
    const out: Site[] = [];
    for (const file of sources()) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(SYNC_SPAWN)) {
            const openParen = match.index + match[0].length - 1;
            out.push({
                file,
                line: text.slice(0, match.index).split("\n").length,
                call: callText(text, openParen),
            });
        }
    }
    return out;
}

const sites = spawnSites();

describe("synchronous child-process spawns are bounded", () => {
    it("finds the spawn sites at all, so a broken scan cannot read as a clean repo", () => {
        expect(sites.length).toBeGreaterThan(20);
    });

    it.each(sites.map((s) => [`${s.file}:${s.line}`, s] as const))("%s passes a timeout", (_where, site) => {
        expect(site.call, `add \`timeout: SPAWN_TIMEOUT_MS\` - a sync spawn cannot be interrupted`).toMatch(
            /\btimeout\s*:/,
        );
    });
});
