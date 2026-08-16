/**
 * Vitest globalSetup for the SSL integration suites.
 *
 * Every mod in the corpus includes headers that ship with a DIFFERENT mod, and expects its own build to
 * have vendored them into its tree first - RP wants sfall's under `scripts_src/sfall`, FO2tweaks wants
 * three sets under `source/headers`, and Party_Orders ships those as committed symlinks into an `external`
 * directory its build populates by cloning. A bare checkout has all the content and none of the
 * arrangement, so the scripts do not preprocess until the links exist.
 *
 * Doing it here rather than per test file is the fix for a real fault: two files creating and removing the
 * same link in parallel made one of them fail intermittently. Each link is created only if absent and
 * removed only if this created it, so a tree that already has one is left alone.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";

const FALLOUT = path.join(REPO_ROOT, "external/fallout");
const RP_SCRIPTS = path.join(FALLOUT, "Fallout2_Restoration_Project/scripts_src");
const SFALL_HEADERS = path.join(FALLOUT, "sfall/artifacts/scripting/headers");
const FO2TWEAKS = path.join(FALLOUT, "FO2tweaks");
const PARTY_ORDERS = path.join(FALLOUT, "Fallout2_Party_Orders");

/**
 * Where a header set has to appear, and what it should point at. Taken from each mod's own build script
 * rather than inferred, so a mod that rearranges its tree upstream shows up as a preprocessing failure
 * here instead of a silently smaller corpus.
 *
 * Party_Orders' entries are the odd ones: the symlinks under its `source/headers` are COMMITTED and point
 * at `external/<name>`, which its build creates by cloning. So the links to create are the targets of
 * those, one level further out.
 */
const LINKS: { readonly at: string; readonly to: string }[] = [
    { at: path.join(RP_SCRIPTS, "sfall"), to: SFALL_HEADERS },

    { at: path.join(FO2TWEAKS, "source/headers/rp"), to: path.join(RP_SCRIPTS, "headers") },
    { at: path.join(FO2TWEAKS, "source/headers/sfall"), to: SFALL_HEADERS },
    {
        at: path.join(FO2TWEAKS, "source/headers/party_orders"),
        to: path.join(PARTY_ORDERS, "source/headers/party_orders"),
    },

    { at: path.join(PARTY_ORDERS, "external/rp/scripts_src/headers"), to: path.join(RP_SCRIPTS, "headers") },
    { at: path.join(PARTY_ORDERS, "external/sfall/artifacts/scripting/headers"), to: SFALL_HEADERS },
    {
        at: path.join(PARTY_ORDERS, "external/fo2tweaks/source/headers"),
        to: path.join(FO2TWEAKS, "source/headers"),
    },
];

export default function setup(): () => void {
    const links: string[] = [];
    const dirs: string[] = [];
    for (const { at, to } of LINKS) {
        // Skipped when the link is already there - a checkout may carry one - and when there is nothing
        // to point it at, which is how a corpus that was never fetched stays a skip rather than an error.
        if (fs.existsSync(at) || !fs.existsSync(to)) continue;
        // The topmost directory this had to invent, so teardown can take back the tree it grew rather
        // than leaving empty scaffolding behind in someone's checkout.
        const grew = fs.mkdirSync(path.dirname(at), { recursive: true });
        if (grew !== undefined) dirs.push(grew);
        fs.symlinkSync(path.relative(path.dirname(at), to), at);
        links.push(at);
    }
    return () => {
        for (const at of links) fs.rmSync(at, { force: true });
        // Only paths `mkdirSync` reported creating, so this can never reach a directory that was here
        // first - and the links inside them are already gone.
        for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    };
}
