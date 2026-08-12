/**
 * Vitest globalSetup for the SSL integration suites.
 *
 * RP's scripts include `../sfall/sfall.h`, but the sfall headers ship with sfall rather than with RP,
 * so a bare corpus checkout cannot resolve them; RP's own build expects them linked here. Both suites
 * in this project need it, and doing it per-file raced - two files creating and removing the same
 * symlink in parallel made one of them fail intermittently. Setting it up once for the whole project
 * is the fix, and it removes only what it created.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");
const SFALL_HEADERS = path.join(REPO_ROOT, "external/fallout/sfall/artifacts/scripting/headers");
const SFALL_LINK = path.join(RP_SCRIPTS, "sfall");

export default function setup(): () => void {
    let created = false;
    if (!fs.existsSync(SFALL_LINK) && fs.existsSync(SFALL_HEADERS)) {
        fs.symlinkSync(path.relative(RP_SCRIPTS, SFALL_HEADERS), SFALL_LINK);
        created = true;
    }
    return () => {
        if (created) fs.rmSync(SFALL_LINK, { force: true });
    };
}
