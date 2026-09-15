/**
 * The gallery over the open workspace: drawable files a mod tree actually contains.
 *
 * The counterpart to the game source - a modder's own art is not in any archive yet, and this is the view
 * that shows it.
 */
import * as fs from "fs";
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
}

/** Directories never worth walking for art, and expensive to walk in a real checkout. */
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "coverage"]);

function walk(root: string, rel: string, into: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
        return; // an unreadable directory is not a reason to fail the whole listing
    }
    for (const entry of entries) {
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(root, childRel, into);
        } else if (canThumbnail(path.extname(entry.name).replace(".", ""))) {
            into.push(childRel);
        }
    }
}

export function workspaceSource(folders: readonly GalleryFolder[], deps: WorkspaceSourceDeps): GallerySource {
    // One root needs no prefix; several do, or two folders' `art/icon.bam` would collide as one tile.
    const prefixed = folders.length > 1;
    let index: Map<string, string> | undefined; // label -> absolute path
    function files(): Map<string, string> {
        if (index) return index;
        index = new Map();
        for (const folder of folders) {
            const found: string[] = [];
            walk(folder.path, "", found);
            for (const rel of found) {
                index.set(prefixed ? `${folder.name}/${rel}` : rel, path.join(folder.path, rel));
            }
        }
        return index;
    }

    return {
        kind: "workspace",
        list(): GalleryItem[] {
            return [...files()].map(([id, abs]) => ({
                id,
                label: id,
                ext: path.extname(abs).replace(".", "").toLowerCase(),
            }));
        },
        locate(id: string): Locator | undefined {
            const abs = files().get(id);
            return abs === undefined ? undefined : { kind: "file", path: abs };
        },
        stamp(id: string): string | undefined {
            const abs = files().get(id);
            if (abs === undefined) return;
            // A workspace file is editable while the gallery is open, so the stamp has to move when the bytes
            // do - otherwise an edited icon keeps showing the thumbnail of its previous contents.
            try {
                const stat = fs.statSync(abs);
                return `file:${stat.mtimeMs}:${stat.size}`;
            } catch {
                return undefined;
            }
        },
        locateAux(name: string, forItem: string): Locator | undefined {
            const owner = files().get(forItem);
            if (owner === undefined) return undefined;
            // Beside the file that names it - how a mod folder ships its own pages, and the same priority the
            // animation editor's resolver uses. Matched case-insensitively: IE ships uppercase names and a
            // case-sensitive host would otherwise miss them.
            const dir = path.dirname(owner);
            let entries: string[];
            try {
                entries = fs.readdirSync(dir);
            } catch {
                return undefined;
            }
            const hit = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
            return hit === undefined ? undefined : { kind: "file", path: path.join(dir, hit) };
        },
        async reveal(id: string): Promise<void> {
            const abs = files().get(id);
            if (abs === undefined) return;
            await deps.reveal(abs);
        },
    };
}
