/**
 * `getMapCanonicalDocument` validates a document once per document object: every serialize and structure op
 * reads it again, and re-walking the schema on each read returned the same result.
 */

import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapParser } from "../src/map";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "../src/map/canonical-reader";
import { mapCanonicalDocumentSchema } from "../src/map/canonical-schemas";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "client/testFixture/maps/arcaves.map");
const parse = () => mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)), { skipMapTiles: true });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("getMapCanonicalDocument validation", () => {
    it("walks the schema once for a parsed document however often it is read", () => {
        const pr = parse();
        const walks = vi.spyOn(mapCanonicalDocumentSchema, "safeParse");

        const first = getMapCanonicalDocument(pr);
        const second = getMapCanonicalDocument(pr);
        getMapCanonicalDocument(pr);

        expect(walks).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it("returns the document a rebuild produces", () => {
        const pr = parse();
        expect(getMapCanonicalDocument(pr)).toStrictEqual(rebuildMapCanonicalDocument(parse()));
    });

    it("validates a replacement document, once", () => {
        const pr = parse();
        const valid = structuredClone(getMapCanonicalDocument(pr));
        pr.document = valid;
        const walks = vi.spyOn(mapCanonicalDocumentSchema, "safeParse");

        expect(getMapCanonicalDocument(pr)).toStrictEqual(valid);
        getMapCanonicalDocument(pr);
        expect(walks).toHaveBeenCalledTimes(1);
    });

    it("rejects a replacement document that fails the schema", () => {
        const pr = parse();
        const invalid = structuredClone(getMapCanonicalDocument(pr));
        (invalid!.objects as { totalObjects: unknown }).totalObjects = "many";
        pr.document = invalid;

        expect(getMapCanonicalDocument(pr)).toBeUndefined();
    });
});
