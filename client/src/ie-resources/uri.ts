import * as path from "path";
import * as vscode from "vscode";

/**
 * A game resource is addressed by a `bgforge-ie-resource:` URI whose path is `<resref>.<ext>` (so the binary custom
 * editor matches by extension) and whose query carries the game directory (so the FileSystemProvider can route
 * back to the right open Game). The FS provider bridges read -> game.read and write -> game.write (override).
 */
export const GAME_RESOURCE_SCHEME = "bgforge-ie-resource";

export function resourceUri(gameDir: string, resref: string, ext: string): vscode.Uri {
    const query = new URLSearchParams({ g: gameDir }).toString();
    return vscode.Uri.from({
        scheme: GAME_RESOURCE_SCHEME,
        path: `/${resref.toLowerCase()}.${ext.toLowerCase()}`,
        query,
    });
}

export interface ParsedResourceUri {
    gameDir: string;
    resref: string;
    ext: string;
}

/**
 * The parts of a URI the decoders below read - satisfied by `vscode.Uri`, and by anything carrying the two
 * strings. Decoding is pure string work, so demanding the whole class would only make it harder to call.
 */
export type ResourceUriParts = Pick<vscode.Uri, "path" | "query">;

/**
 * The extension an animation-set URI carries.
 *
 * Not an Infinity Engine resource type - no archive holds a `.animset` - which is exactly why it is safe to
 * claim: a set is several files, so it has no single resource to name, and this address stands for all of
 * them. It keeps the resource scheme rather than minting a second one, which would mean auditing every site
 * that filters on scheme; the cost is this shape, which every decoder of the scheme has to know about.
 */
const ANIMATION_SET_EXT = "animset";

/** The query key carrying a set's id. */
const ANIMATION_SET_ID = "a";

/**
 * Address a whole animation set, labelled by `name` where the install declares one.
 *
 * The path is the label because it is what the editor tab shows, and a tab reading `6004.animset` names
 * nothing a reader recognises. Identity stays in the query: the label is stripped to the characters a
 * declaration table uses, so two sets could in principle share a path, and only the id decides which one
 * opens. Four hex digits is how an install names an animation's own declaration file, so it reads like one.
 */
export function animationSetUri(gameDir: string, id: number, name?: string): vscode.Uri {
    const hex = id.toString(16).padStart(4, "0");
    const label = (name ?? "").replaceAll(/[^A-Za-z0-9_-]/g, "");
    return vscode.Uri.from({
        scheme: GAME_RESOURCE_SCHEME,
        path: `/${label === "" ? hex : label}.${ANIMATION_SET_EXT}`,
        query: new URLSearchParams({ g: gameDir, [ANIMATION_SET_ID]: hex }).toString(),
    });
}

export interface ParsedAnimationSetUri {
    gameDir: string;
    id: number;
}

/**
 * The set a URI addresses, or undefined where it addresses a single resource instead.
 *
 * Decode and predicate in one: a caller branching on "is this a set" reads the same answer that tells it
 * which set, so the two cannot disagree.
 */
export function parseAnimationSetUri(uri: ResourceUriParts): ParsedAnimationSetUri | undefined {
    const { gameDir, ext } = parseResourceUri(uri);
    if (ext !== ANIMATION_SET_EXT) return undefined;
    const hex = new URLSearchParams(uri.query).get(ANIMATION_SET_ID) ?? "";
    // Anchored, so a stray non-hex character refuses the whole address rather than parsing a prefix of it -
    // `parseInt` alone reads "6zz" as 6 and would open the wrong set.
    if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
    return { gameDir, id: Number.parseInt(hex, 16) };
}

export function parseResourceUri(uri: ResourceUriParts): ParsedResourceUri {
    const gameDir = new URLSearchParams(uri.query).get("g") ?? "";
    const base = path.posix.basename(uri.path);
    const dot = base.lastIndexOf(".");
    return {
        gameDir,
        resref: dot === -1 ? base : base.slice(0, dot),
        ext: dot === -1 ? "" : base.slice(dot + 1),
    };
}
