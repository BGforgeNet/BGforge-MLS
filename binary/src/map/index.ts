/**
 * MAP file format parser for Fallout 1/2.
 * Implements BinaryParser interface for the binary editor.
 *
 * Format structure:
 * 1. Header (268 bytes + 176 unknown = 444 bytes total)
 * 2. Global variables (4 bytes each)
 * 3. Local variables (4 bytes each)
 * 4. Tiles per elevation (80,000 bytes each: 20,000 roof+floor pairs)
 * 5. Scripts (strict parsing currently uses 4 groups for RP maps)
 * 6. Objects per elevation (variable count)
 */

import type { BinaryParser, ParseOpaqueRange, ParseOptions, ParseResult } from "../types";
import { rebuildMapCanonicalDocument } from "./canonical";
import { serializeMap } from "./serializer";
import { encodeOpaqueRange } from "../opaque-range";
import { HEADER_SIZE, parseHeader } from "./schemas";
import { makeGroup, HEADER_PADDING_OFFSET, HEADER_OPAQUE_END, STRICT_MAP_SCRIPT_TYPE_COUNT } from "./parse-helpers";
import { parseHeaderSection, parseVariablesSection, parseTiles, parseScripts } from "./parse-sections";
import { parseObjects } from "./parse-objects";
import { scoreParsedTail, isConfidentObjectsGroup, buildOpaqueObjectsGroup } from "./parse-scoring";

class MapParser implements BinaryParser {
    readonly id = "map";
    readonly name = "Fallout MAP";
    readonly extensions = ["map"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: makeGroup("MAP File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, options?: ParseOptions): ParseResult {
        try {
            const result = this.parseInternal(data, options);
            Object.defineProperty(result, "sourceData", {
                value: new Uint8Array(data),
                enumerable: false,
                configurable: true,
                writable: false,
            });
            return result;
        } catch (err) {
            return this.fail(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeMap(result);
    }

    private parseInternal(data: Uint8Array, options?: ParseOptions): ParseResult {
        const errors: string[] = [];
        const opaqueRanges: ParseOpaqueRange[] = [];

        if (data.length < HEADER_SIZE) {
            return this.fail(`File too small: ${data.length} bytes, need at least ${HEADER_SIZE}`);
        }

        const header = parseHeader(data);

        if (header.version !== 19 && header.version !== 20) {
            errors.push(`Unknown MAP version: ${header.version} (expected 19 or 20)`);
        }

        const rootFields: (import("../types").ParsedField | import("../types").ParsedGroup)[] = [];

        rootFields.push(parseHeaderSection(data, errors));
        const filenameBytes = data.subarray(0x04, 0x14);
        const filenameTerminator = filenameBytes.indexOf(0);
        if (filenameTerminator !== -1) {
            const trailingStart = 0x04 + filenameTerminator + 1;
            const trailingBytes = data.subarray(trailingStart, 0x14);
            if (trailingBytes.some((byte) => byte !== 0)) {
                const filenameTailRange = encodeOpaqueRange("header-filename-tail", data, trailingStart, 0x14);
                if (filenameTailRange) {
                    opaqueRanges.push(filenameTailRange);
                }
            }
        }
        const headerPaddingRange = encodeOpaqueRange("header-padding", data, HEADER_PADDING_OFFSET, HEADER_OPAQUE_END);
        if (headerPaddingRange) {
            opaqueRanges.push(headerPaddingRange);
        }

        const varOffset = HEADER_SIZE;
        rootFields.push(...parseVariablesSection(data, header));

        let currentOffset = varOffset + header.numGlobalVars * 4 + header.numLocalVars * 4;
        const {
            tiles,
            offset: tileEndOffset,
            skippedRange,
        } = parseTiles(data, header, currentOffset, options?.skipMapTiles);
        tiles.forEach((elevTiles) => rootFields.push(...elevTiles));
        currentOffset = tileEndOffset;
        if (skippedRange) {
            opaqueRanges.push(skippedRange);
        }

        // TODO(map): Fallout 2 CE uses SCRIPT_TYPE_COUNT == 5 in
        // tmp/fallout2-ce/src/scripts.cc and tmp/fallout2-ce/src/scripts.h, but
        // real RP maps under external/fallout/Fallout2_Restoration_Project/data/maps
        // appear to place objects after 4 script lists. Strict parsing follows the
        // real RP files for now. The NMA format notes also differ in places from
        // the CE code:
        // https://nma-fallout.com/resources/fallout-2-memory-maps-and-file-formats.181/
        if (options?.gracefulMapBoundaries) {
            const scriptTailCandidates = [0, 1, 2, 3, 4, 5].map((scriptTypeCount) => {
                const candidateErrors: string[] = [];
                const { scripts, offset: scriptOffset } = parseScripts(
                    data,
                    currentOffset,
                    candidateErrors,
                    scriptTypeCount,
                );
                const { group: objectsGroup, opaqueTailOffset } = parseObjects(
                    data,
                    header,
                    scriptOffset,
                    candidateErrors,
                );

                return {
                    scripts,
                    scriptOffset,
                    objectsGroup,
                    opaqueTailOffset,
                    candidateErrors,
                    score: scoreParsedTail(scriptTypeCount, candidateErrors, objectsGroup),
                };
            });

            scriptTailCandidates.sort((a, b) => b.score - a.score);
            const chosenTail =
                scriptTailCandidates.find((candidate) => isConfidentObjectsGroup(candidate.objectsGroup)) ??
                scriptTailCandidates[0]!;

            rootFields.push(...chosenTail.scripts);
            currentOffset = chosenTail.scriptOffset;
            errors.push(...chosenTail.candidateErrors);

            const chosenTailIsConfident = isConfidentObjectsGroup(chosenTail.objectsGroup);
            const objectsGroup = chosenTailIsConfident
                ? chosenTail.objectsGroup
                : buildOpaqueObjectsGroup(chosenTail.scriptOffset);
            rootFields.push(objectsGroup);

            const opaqueRange = encodeOpaqueRange(
                "objects-tail",
                data,
                chosenTailIsConfident ? (chosenTail.opaqueTailOffset ?? data.length) : chosenTail.scriptOffset,
            );
            if (opaqueRange) {
                opaqueRanges.push(opaqueRange);
            }
        } else {
            const { scripts, offset: scriptOffset } = parseScripts(
                data,
                currentOffset,
                errors,
                STRICT_MAP_SCRIPT_TYPE_COUNT,
            );
            const { group: objectsGroup, opaqueTailOffset } = parseObjects(data, header, scriptOffset, errors);

            rootFields.push(...scripts);
            currentOffset = scriptOffset;
            rootFields.push(objectsGroup);

            const opaqueRange = encodeOpaqueRange("objects-tail", data, opaqueTailOffset ?? data.length);
            if (opaqueRange) {
                opaqueRanges.push(opaqueRange);
            }
        }

        const result: ParseResult = {
            format: this.id,
            formatName: this.name,
            root: makeGroup("MAP File", rootFields),
            opaqueRanges: opaqueRanges.length > 0 ? opaqueRanges : undefined,
            errors: errors.length > 0 ? errors : undefined,
        };

        // Lazy canonical document: rebuildMapCanonicalDocument is expensive (Zod validation,
        // O(n) field lookups per object) and the 6x gracefulMapBoundaries parse candidates
        // multiply the cost. Deferring to first access keeps parse() fast for display-only
        // consumers (editor tree, symbol outline). The document is materialized when the
        // binary editor opens a MAP for editing, or when serializing to JSON/bytes.
        //
        // Design notes:
        // - `resolved` is set true BEFORE the try block to prevent infinite recursion if
        //   rebuildMapCanonicalDocument reads result.document internally.
        // - On failure, document stays undefined permanently (no retry) — matches the
        //   original eager behavior where a failed rebuild left document as undefined.
        // - enumerable: true so JSON.stringify (used by cloneParseResult) triggers the
        //   getter and includes the property. The clone gets a plain property, not a getter.
        // - configurable: true so binaryEditor-document.ts can reassign via the setter
        //   after field edits (refreshCanonicalDocument) or reset to undefined.
        let cachedDocument: ParseResult["document"];
        let resolved = false;
        Object.defineProperty(result, "document", {
            get() {
                if (!resolved) {
                    resolved = true;
                    try {
                        cachedDocument = rebuildMapCanonicalDocument(result);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        result.warnings = [
                            ...(result.warnings ?? []),
                            `Canonical MAP document unavailable: ${message}`,
                        ];
                    }
                }
                return cachedDocument;
            },
            set(value: ParseResult["document"]) {
                cachedDocument = value;
                resolved = true;
            },
            enumerable: true,
            configurable: true,
        });
        return result;
    }
}

export const mapParser = new MapParser();
