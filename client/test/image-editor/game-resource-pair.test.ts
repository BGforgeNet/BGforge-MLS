/**
 * A BAM opened out of an Infinity Engine game's archives, rather than off the filesystem. Its URI
 * carries the scheme and the game query that route a read or a write back to that game, and nothing
 * about it exists as a file - `uri.fsPath` is a bare `/<resref>.bam`, i.e. the filesystem ROOT.
 *
 * So the base/east pair has to be derived from the URI. Deriving it from the path sent the companion
 * probe to `/usar1cae.bam` on the local disk, where it never resolved: a paired creature animation
 * opened as its base member alone, and a save would have written the combined animation over it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { combineIeBamPair, serializeBamV1 } from "@bgforge/image";
import { makeIeBamBase, makeIeBamEast } from "./fixtures";

const GAME_SCHEME = "bgforge-ie-resource";
const GAME_QUERY = "g=%2Fgames%2Fbgee";

const { readFileMock, writeFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn(), writeFileMock: vi.fn() }));

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    const make = (scheme: string, uriPath: string, query: string): Record<string, unknown> => ({
        scheme,
        path: uriPath,
        query,
        fsPath: uriPath,
        toString: () => `${scheme}:${uriPath}?${query}`,
        with: (change: { path?: string }) => make(scheme, change.path ?? uriPath, query),
    });
    return {
        EventEmitter,
        Uri: {
            file: (fsPath: string) => make("file", fsPath, ""),
            parse: (value: string) => make("file", value, ""),
        },
        window: { showWarningMessage: vi.fn(), showOpenDialog: vi.fn() },
        workspace: { fs: { readFile: readFileMock, writeFile: writeFileMock } },
    };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;
const token = {} as vscode.CancellationToken;

function gameUri(uriPath: string): vscode.Uri {
    const make = (p: string): unknown => ({
        scheme: GAME_SCHEME,
        path: p,
        query: GAME_QUERY,
        fsPath: p,
        toString: () => `${GAME_SCHEME}:${p}?${GAME_QUERY}`,
        with: (change: { path?: string }) => make(change.path ?? p),
    });
    return make(uriPath) as vscode.Uri;
}

function openContext(): vscode.CustomDocumentOpenContext {
    return { backupId: undefined, untitledDocumentData: undefined } as vscode.CustomDocumentOpenContext;
}

describe("an IE BAM pair served from a game", () => {
    // Keyed by the full URI string, so a probe that dropped the scheme or the game query misses.
    let resources: Map<string, Uint8Array>;

    beforeEach(() => {
        resources = new Map([
            [`${GAME_SCHEME}:/usar1ca.bam?${GAME_QUERY}`, serializeBamV1(makeIeBamBase())],
            [`${GAME_SCHEME}:/usar1cae.bam?${GAME_QUERY}`, serializeBamV1(makeIeBamEast())],
        ]);
        readFileMock.mockReset();
        writeFileMock.mockReset();
        readFileMock.mockImplementation((target: { toString: () => string }) => {
            const bytes = resources.get(target.toString());
            return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`no such resource: ${target}`));
        });
    });

    it("combines the companion found in the same game", async () => {
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(gameUri("/usar1ca.bam"), openContext(), token);

        expect(document.iePair).toBeDefined();
        // The combined rose, not the base member alone: the two overlay into one 8-slot-per-block set,
        // so the frames - not the cycle count - are what tells them apart.
        const combined = combineIeBamPair(makeIeBamBase(), makeIeBamEast());
        if (!combined) throw new Error("fixture pair did not combine");
        expect(document.animation.frames.length).toBe(combined.frames.length);
        expect(combined.frames.length).toBeGreaterThan(makeIeBamBase().frames.length);
    });

    it("pairs from the companion member too, resolving its base in the same game", async () => {
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(gameUri("/usar1cae.bam"), openContext(), token);

        expect(document.iePair).toBeDefined();
        // Whichever member was opened, the document takes the base file's identity.
        expect(document.saveUri.toString()).toBe(`${GAME_SCHEME}:/usar1ca.bam?${GAME_QUERY}`);
    });

    // The half that would corrupt data rather than merely underdeliver: a save has to go back to the
    // game through both member URIs, never to `/usar1ca.bam` on the local filesystem.
    it("saves both members back through the game, not to the filesystem root", async () => {
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(gameUri("/usar1ca.bam"), openContext(), token);

        await provider.saveCustomDocument(document, token);

        const targets = writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(targets).toEqual([
            `${GAME_SCHEME}:/usar1ca.bam?${GAME_QUERY}`,
            `${GAME_SCHEME}:/usar1cae.bam?${GAME_QUERY}`,
        ]);
    });
});
