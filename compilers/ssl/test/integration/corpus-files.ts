/**
 * Listing the corpus, kept apart from `corpus.ts` so both the test suites and the standalone probes can
 * use it.
 *
 * The split exists for one mechanical reason: `corpus.ts` resolves the corpus through the repo's shared
 * `repo-root` helper, which reads `__dirname` and so cannot be imported from an ES module. The probes
 * under `scripts/` are `.mts`. Taking the directory as an argument removes that dependency, so the
 * exclusions and the debugging switches below have one definition rather than one per caller - which
 * matters because getting them wrong makes a sweep silently measure a different population.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Every `.ssl` file under `root`, sorted. `template` holds deliberately malformed inputs and `sfall` is a
 * symlink to headers, so neither is a script the corpus is making a claim about.
 */
export function scriptsUnder(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(root)) {
        if (entry === "template" || entry === "sfall") continue;
        const dir = path.join(root, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (file.toLowerCase().endsWith(".ssl")) out.push(path.join(dir, file));
        }
    }
    return out.sort();
}

/** Every `.ssl` directly in `dir`, sorted - the layout a mod that keeps its scripts in one folder uses. */
export function scriptsIn(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((file) => file.toLowerCase().endsWith(".ssl"))
        .map((file) => path.join(dir, file))
        .sort();
}

/**
 * Narrows the sweep for DEBUGGING only - `SSL_CORPUS_ONLY=gcskeetr` for one script by stem,
 * `SSL_CORPUS_LIMIT=250` for the first N. The suites that spawn the reference compiler once per script
 * take minutes, which is the wrong loop to iterate a fix against; the subset reproduces in seconds and the
 * full sweep is the confirmation.
 *
 * A narrowed run cannot pass a suite: `CORPUS_SIZE` is asserted by every one of them, so a subset fails on
 * the population check before reporting a verdict. That is deliberate - the switch is for reading the
 * report, never for getting to green.
 */
export function narrow(scripts: string[]): string[] {
    const only = process.env.SSL_CORPUS_ONLY;
    if (only) return scripts.filter((s) => path.basename(s, path.extname(s)) === only);
    const limit = Number(process.env.SSL_CORPUS_LIMIT ?? 0);
    return limit > 0 ? scripts.slice(0, limit) : scripts;
}
