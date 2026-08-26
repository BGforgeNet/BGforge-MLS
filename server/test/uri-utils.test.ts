/**
 * URI to filesystem-path conversion.
 *
 * The scheme cases matter more than they look: every document the editor opens reaches the parser, and
 * the parser asks for a path to display symbols against. A conversion that throws on an unfamiliar
 * scheme therefore takes the whole server process down rather than degrading one document - which is
 * what a decompiled `.int`, served on its own scheme, did.
 */

import { describe, expect, it } from "vitest";
import { pathToUri, uriToPath } from "../src/uri-utils";

describe("uriToPath", () => {
    it("decodes a file URI to its path", () => {
        expect(uriToPath("file:///mods/a.ssl")).toBe("/mods/a.ssl");
    });

    it("decodes percent-encoded characters", () => {
        expect(uriToPath("file:///mods/my%20mod/a.ssl")).toBe("/mods/my mod/a.ssl");
    });

    // Not a file on disk, so nothing may be read from it - but the caller finds that out from the
    // failed read, not from an exception that unwinds past every handler and exits the process.
    it("returns the path portion of a non-file URI instead of throwing", () => {
        expect(uriToPath("bgforge-script:/mods/a.int.ssl")).toBe("/mods/a.int.ssl");
    });

    it("round-trips a path through pathToUri", () => {
        expect(uriToPath(pathToUri("/mods/my mod/a.ssl"))).toBe("/mods/my mod/a.ssl");
    });
});
