/**
 * Editor-side ParseOptions builder.
 *
 * Composes `ParseOptions` for the binary custom editor by combining:
 *   - File-derived options (`buildFileDerivedParseOptions`) — shared with
 *     the CLI; today this is the sibling proto/ pidResolver auto-load.
 *   - Editor-preference options — `skipMapTiles: true` to skip tile field
 *     materialization, which would otherwise cost ~40k field allocations
 *     per tree render.
 *
 * Centralising this here means the parity contract test can call exactly
 * the same builder the editor uses, and any future file-derived option
 * added to the library propagates to the editor with no code change.
 */

import * as path from "path";
import { buildFileDerivedParseOptions, type ParseOptions } from "@bgforge/binary";

export function buildEditorParseOptions(filePath: string): ParseOptions | undefined {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".map") return undefined;
    const fileDerived = buildFileDerivedParseOptions(filePath);
    return {
        skipMapTiles: true,
        ...(fileDerived.pidResolver ? { pidResolver: fileDerived.pidResolver } : {}),
    };
}
