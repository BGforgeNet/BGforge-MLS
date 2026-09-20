/**
 * The gallery over the open workspace: drawable files a mod tree actually contains.
 *
 * The counterpart to the game source - a modder's own art is not in any archive yet, and this is the view
 * that shows it.
 *
 * Reads no files itself. The host enumerates once and answers revision queries, which is what lets the same
 * source run against a workspace the editor serves through a FileSystemProvider - a virtual or remote folder,
 * where `node:fs` sees nothing and no file has a meaningful mtime.
 */
import * as path from "path";
import { canThumbnail } from "../ie-resources/thumbnails";
import { type GalleryItem, type GallerySource, type Locator } from "./source";

export interface GalleryFolder {
    name: string;
    path: string;
}

export interface WorkspaceSourceDeps {
    /** Reveal the file in the Explorer. Injected so this module stays free of `vscode`. */
    reveal(fsPath: string): Promise<void>;
    /**
     * Every file under `root`, absolute and unfiltered.
     *
     * Not narrowed to drawables by the host: a BAM v2's PVRZ page is not a gallery item and never appears in
     * a listing, so `locateAux` could not find one in a drawable-only index.
     */
    listFiles(root: string): Promise<readonly string[]>;
    /**
     * A counter for this path that rises whenever its bytes could have changed, and `undefined` once the file
     * is gone.
     *
     * The host owns it, because it owns the one watcher: a watcher per source would need disposing and
     * `GallerySource` has no lifecycle. Counting rather than reading metadata is also the only formulation
     * that survives a virtual filesystem, whose `stat` reports whatever its provider invents for mtime.
     */
    revision(fsPath: string): number | undefined;
}

/** Directories never worth walking for art, and expensive to walk in a real checkout. */
export const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "out", "dist", "coverage"]);

/** True for a path the gallery ignores wholesale - inside a skipped directory, or inside a dotted one. */
function skipped(relSegments: readonly string[]): boolean {
    // The last segment is the file itself: a dotfile is listed if it is drawable, a dot-DIRECTORY is not.
    return relSegments.slice(0, -1).some((segment) => SKIP_DIRS.has(segment) || segment.startsWith("."));
}

export async function workspaceSource(
    folders: readonly GalleryFolder[],
    deps: WorkspaceSourceDeps,
): Promise<GallerySource> {
    // One root needs no prefix; several do, or two folders' `art/icon.bam` would collide as one tile.
    const prefixed = folders.length > 1;
    /** label -> absolute path, drawables only: what the grid lists. */
    const byId = new Map<string, string>();
    /** Lowercased absolute path -> absolute path, every file: what an aux page is resolved through. */
    const byLowerPath = new Map<string, string>();

    // Roots enumerate together: each is a separate round trip to the editor, and a multi-root workspace would
    // otherwise pay them end to end.
    const listings = await Promise.all(
        folders.map(async (folder) => ({ folder, files: await deps.listFiles(folder.path) })),
    );

    for (const { folder, files } of listings) {
        for (const abs of files) {
            const segments = path.relative(folder.path, abs).split(path.sep);
            if (skipped(segments)) continue;
            byLowerPath.set(abs.toLowerCase(), abs);
            const rel = segments.join("/");
            if (canThumbnail(path.extname(abs).replace(".", ""))) {
                byId.set(prefixed ? `${folder.name}/${rel}` : rel, abs);
            }
        }
    }

    return {
        kind: "workspace",
        list(): GalleryItem[] {
            return [...byId].map(([id, abs]) => ({
                id,
                label: id,
                ext: path.extname(abs).replace(".", "").toLowerCase(),
            }));
        },
        locate(id: string): Locator | undefined {
            const abs = byId.get(id);
            return abs === undefined ? undefined : { kind: "file", path: abs };
        },
        stamp(id: string): string | undefined {
            const abs = byId.get(id);
            if (abs === undefined) return undefined;
            // A workspace file is editable while the gallery is open, so the stamp has to move when the bytes
            // do - otherwise an edited icon keeps showing the thumbnail of its previous contents. The counter
            // restarts per source, which costs nothing: the cache it keys is the pump's, built alongside it.
            const revision = deps.revision(abs);
            return revision === undefined ? undefined : `file:${revision}`;
        },
        locateAux(name: string, forItem: string): Locator | undefined {
            const owner = byId.get(forItem);
            if (owner === undefined) return undefined;
            // Beside the file that names it - how a mod folder ships its own pages, and the same priority the
            // animation editor's resolver uses. Matched case-insensitively: IE ships uppercase names and a
            // case-sensitive host would otherwise miss them.
            const abs = byLowerPath.get(path.join(path.dirname(owner), name).toLowerCase());
            return abs === undefined ? undefined : { kind: "file", path: abs };
        },
        async reveal(id: string): Promise<void> {
            const abs = byId.get(id);
            if (abs === undefined) return;
            await deps.reveal(abs);
        },
    };
}
