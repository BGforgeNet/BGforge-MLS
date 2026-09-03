/**
 * The gallery over an installed game: every drawable resource the KEY and override folders resolve.
 */
import * as fs from "fs";
import { type Game, type GameResourceRef } from "@bgforge/binary";
import { canThumbnail } from "../ie-resources/thumbnails";
import { type GalleryItem, type GallerySource, type Locator } from "./source";

/** The slice of `Game` a gallery needs - narrow enough that a test can stand one up without an install. */
export type GalleryGame = Pick<Game, "list" | "locate">;

export interface GameSourceDeps {
    /** Show the resource in the resource tree. Injected so this module stays free of `vscode`. */
    reveal(resref: string, ext: string): Promise<void>;
}

export function gameSource(game: GalleryGame, deps: GameSourceDeps): GallerySource {
    // Built once: `Game.list()` walks the whole resolution tree, and the grid asks for the same items
    // repeatedly as it scrolls.
    let index: Map<string, GameResourceRef> | undefined;
    function refs(): Map<string, GameResourceRef> {
        if (index) return index;
        index = new Map();
        for (const ref of game.list()) {
            if (ref.ext === undefined || !canThumbnail(ref.ext)) continue;
            index.set(`${ref.resref}.${ref.ext.toLowerCase()}`, ref);
        }
        return index;
    }

    function locate(id: string): Locator | undefined {
        const ref = refs().get(id);
        return ref === undefined ? undefined : game.locate(ref.resref, ref.type);
    }

    return {
        kind: "game",
        list(): GalleryItem[] {
            return [...refs()].map(([id, ref]) => ({ id, label: ref.resref, ext: ref.ext!.toLowerCase() }));
        },
        locate,
        stamp(id: string): string | undefined {
            const at = locate(id);
            if (at === undefined) return;
            // A biffed resource cannot change while the game is open, so its address is its stamp. A loose
            // override file can, so that one is stamped by the metadata a write moves.
            if (at.kind === "bif") return `bif:${at.archivePath}#${at.entry}${at.tileset ? ":tis" : ""}`;
            try {
                const stat = fs.statSync(at.path);
                return `file:${stat.mtimeMs}:${stat.size}`;
            } catch {
                return undefined; // deleted between the listing and now - the caller draws nothing
            }
        },
        async reveal(id: string): Promise<void> {
            const ref = refs().get(id);
            if (ref?.ext === undefined) return;
            await deps.reveal(ref.resref, ref.ext.toLowerCase());
        },
    };
}
