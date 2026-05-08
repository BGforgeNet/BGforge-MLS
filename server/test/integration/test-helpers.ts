/**
 * Shared helpers for integration tests using real fixture files.
 *
 * Provides fixture loading, position finding, and assertion helpers
 * for golden-value integration tests.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Position } from "vscode-languageserver/node";

/** Root of the project repository. */
const ROOT_DIR = resolve(__dirname, "../../..");

/** Base paths for external fixture repos. */
export const FALLOUT_FIXTURES = join(ROOT_DIR, "external/fallout");
export const IE_FIXTURES = join(ROOT_DIR, "external/infinity-engine");

/** A loaded fixture file with its URI and text content. */
interface FixtureFile {
    readonly uri: string;
    readonly text: string;
    readonly absPath: string;
}

/**
 * Load a fixture file by relative path from a base directory.
 * Converts the filesystem path to an LSP-compatible file:// URI.
 */
export function loadFixture(basePath: string, relPath: string): FixtureFile {
    const absPath = join(basePath, relPath);
    const uri = pathToFileURL(absPath).toString();
    const text = readFileSync(absPath, "utf-8");
    return { uri, text, absPath };
}

/**
 * Load multiple fixture files and return them as a map keyed by URI.
 */
export function loadFixtures(basePath: string, relPaths: readonly string[]): Map<string, FixtureFile> {
    const files = new Map<string, FixtureFile>();
    for (const relPath of relPaths) {
        const fixture = loadFixture(basePath, relPath);
        files.set(fixture.uri, fixture);
    }
    return files;
}

/**
 * Find position of a symbol specifically as an identifier (not inside a larger word).
 * Searches for the pattern surrounded by word boundaries.
 */
export function findIdentifierPosition(text: string, identifier: string, occurrence = 1): Position | null {
    const regex = new RegExp(`\\b${identifier.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = regex.exec(text)) !== null) {
        count++;
        if (count === occurrence) {
            const before = text.slice(0, match.index);
            const line = before.split("\n").length - 1;
            const lastNewline = before.lastIndexOf("\n");
            const character = lastNewline === -1 ? match.index : match.index - lastNewline - 1;
            return { line, character };
        }
    }
    return null;
}
