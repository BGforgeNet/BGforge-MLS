/**
 * Where a compiled Fallout script goes.
 *
 * Shared by the two front ends that produce one - SSL text and TSSL - so a `.tssl` and the `.ssl` it is
 * equivalent to land in the same place.
 */

import * as crypto from "crypto";
import * as path from "path";
import { tmpDir } from "../path-utils";

/**
 * The `.int` for a source file, or a throwaway path when this run only validates.
 *
 * `outputDirectory` defaults to empty, meaning "beside the source". That is resolved here rather than
 * left as a bare relative name: a back end that writes the file itself resolves it against the SERVER's
 * working directory, which is wherever the editor happened to start us, not the script's directory. Only
 * the back ends that hand the name to a program running in the source directory get away with it.
 */
export function intOutputPath(filepath: string, outputDirectory: string, uri: string, writing: boolean): string {
    const parsed = path.parse(filepath);
    if (!writing) {
        // Validation output nobody reads, deleted after the run. The hash keeps two documents with the
        // same basename from overwriting each other's throwaway.
        const uriHash = crypto.createHash("md5").update(uri).digest("hex").slice(0, 8);
        return path.join(tmpDir, `tmp-${uriHash}-${parsed.name}.int`);
    }
    return path.resolve(outputDirectory || parsed.dir, parsed.name + ".int");
}
