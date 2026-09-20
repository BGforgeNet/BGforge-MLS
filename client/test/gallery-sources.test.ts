/**
 * The two corpora the gallery can browse. Both are driven through the `GallerySource` interface the panel
 * uses, so a difference between them that the panel would trip on shows up here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { type GameResourceRef, type ResourceLocation } from "@bgforge/binary";
import { gameSource } from "../src/gallery/game-source";
import { workspaceSource } from "../src/gallery/workspace-source";

const BAM = 0x03e8;
const ITM = 0x03ed;
const BMP = 0x0001;

function ref(resref: string, ext: string, type: number): GameResourceRef {
    return { resref, type, ext, bif: "data/test.bif" };
}

const tmpDirs: string[] = [];
afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(files: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-gallery-"));
    tmpDirs.push(dir);
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
    }
    return dir;
}

describe("gameSource", () => {
    const locations = new Map<string, ResourceLocation>([
        ["ICON.bam", { kind: "bif", archivePath: "/game/data/test.bif", entry: 7, tileset: false }],
        ["PORTRAIT.bmp", { kind: "file", path: "/game/override/portrait.bmp" }],
    ]);
    function fakeGame(refs: GameResourceRef[]) {
        return {
            list: vi.fn(() => refs),
            locate: vi.fn((resref: string, type?: number | string) => {
                const ext = refs.find((r) => r.resref === resref && r.type === type)?.ext;
                return ext === undefined ? undefined : locations.get(`${resref}.${ext}`);
            }),
        };
    }

    it("lists only the types that can be drawn", () => {
        const src = gameSource(fakeGame([ref("ICON", "bam", BAM), ref("SWORD", "itm", ITM)]), { reveal: vi.fn() });
        expect(src.list()).toEqual([{ id: "ICON.bam", label: "ICON", ext: "bam" }]);
    });

    it("locates through the game rather than rebuilding a path", () => {
        const game = fakeGame([ref("ICON", "bam", BAM)]);
        const src = gameSource(game, { reveal: vi.fn() });
        expect(src.locate("ICON.bam")).toEqual({
            kind: "bif",
            archivePath: "/game/data/test.bif",
            entry: 7,
            tileset: false,
        });
        expect(game.locate).toHaveBeenCalledWith("ICON", BAM);
    });

    /**
     * The cache key must not cost a read - hashing bytes to decide whether the read could be skipped is the
     * cost the cache exists to avoid. A biffed resource cannot change while the game is open, so its
     * identity IS its stamp.
     */
    it("stamps a biffed resource from the archive, reading nothing", () => {
        const game = fakeGame([ref("ICON", "bam", BAM)]);
        const src = gameSource(game, { reveal: vi.fn() });
        expect(src.stamp("ICON.bam")).toBe(src.stamp("ICON.bam"));
        expect(src.stamp("ICON.bam")).toContain("/game/data/test.bif");
    });

    it("has no stamp and no locator for an item the game does not hold", () => {
        const src = gameSource(fakeGame([]), { reveal: vi.fn() });
        expect(src.stamp("GONE.bam")).toBeUndefined();
        expect(src.locate("GONE.bam")).toBeUndefined();
    });

    // An override file CAN change while the gallery is open, unlike a biffed resource, so its stamp is read
    // from the metadata a write moves rather than from its address.
    it("stamps a loose override file from its metadata, and drops the stamp once it is gone", () => {
        const dir = tmpDir({ "portrait.bmp": "x" });
        const loosePath = path.join(dir, "portrait.bmp");
        const game = {
            list: vi.fn(() => [ref("PORTRAIT", "bmp", BMP)]),
            locate: vi.fn(() => ({ kind: "file", path: loosePath }) as ResourceLocation),
        };
        const src = gameSource(game, { reveal: vi.fn() });
        const before = src.stamp("PORTRAIT.bmp");
        expect(before).toMatch(/^file:/);
        fs.writeFileSync(loosePath, "much longer contents");
        expect(src.stamp("PORTRAIT.bmp")).not.toBe(before);
        fs.rmSync(loosePath);
        expect(src.stamp("PORTRAIT.bmp")).toBeUndefined();
    });

    it("locates a PVRZ page through the archive, splitting the resource name", () => {
        const game = fakeGame([ref("ICON", "bam", BAM)]);
        const src = gameSource(game, { reveal: vi.fn() });
        src.locateAux("MOS0012.PVRZ", "ICON.bam");
        expect(game.locate).toHaveBeenCalledWith("MOS0012", "pvrz");
    });

    it("has no page for a name carrying no extension to split on", () => {
        const src = gameSource(fakeGame([]), { reveal: vi.fn() });
        expect(src.locateAux("MOS0012", "ICON.bam")).toBeUndefined();
    });

    it("reveals through the injected action, by resref and type", async () => {
        const reveal = vi.fn(async () => {});
        const src = gameSource(fakeGame([ref("ICON", "bam", BAM)]), { reveal });
        await src.reveal("ICON.bam");
        expect(reveal).toHaveBeenCalledWith("ICON", "bam");
    });
});

/**
 * Every file under `root`, absolute, unfiltered - what the host's `findFiles` hands the source.
 *
 * The real implementation asks the editor; this one reads the temp tree the case just wrote, so the cases
 * still exercise the source against a real directory shape rather than a list typed by hand.
 */
function allFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const abs = path.join(root, entry.name);
        if (entry.isDirectory()) out.push(...allFiles(abs));
        else out.push(abs);
    }
    return out;
}

/** The host side of the source's deps, with the two hooks a case needs to move a file's revision. */
function hostDeps(reveal: (fsPath: string) => Promise<void> = vi.fn(async () => {})) {
    const revisions = new Map<string, number>();
    const deleted = new Set<string>();
    return {
        deps: {
            reveal,
            listFiles: (root: string): Promise<readonly string[]> => Promise.resolve(allFiles(root)),
            revision: (fsPath: string): number | undefined =>
                deleted.has(fsPath) ? undefined : (revisions.get(fsPath) ?? 0),
        },
        /** What the host's watcher does on a change event. */
        changed: (fsPath: string): void => {
            revisions.set(fsPath, (revisions.get(fsPath) ?? 0) + 1);
        },
        /** What it does on a delete event. */
        removed: (fsPath: string): void => {
            deleted.add(fsPath);
        },
    };
}

describe("workspaceSource", () => {
    it("labels by path relative to the folder root and lists only drawables", async () => {
        const dir = tmpDir({ "art/icon.bam": "x", "art/notes.txt": "x", "sprite.frm": "x" });
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps().deps);
        expect(
            src
                .list()
                .map((i) => i.label)
                .sort(),
        ).toEqual(["art/icon.bam", "sprite.frm"]);
    });

    it("prefixes the folder name only when the workspace has more than one root", async () => {
        const one = tmpDir({ "icon.bam": "x" });
        const two = tmpDir({ "other.bam": "x" });
        const single = await workspaceSource([{ name: "mod", path: one }], hostDeps().deps);
        expect(single.list().map((i) => i.label)).toEqual(["icon.bam"]);

        const multi = await workspaceSource(
            [
                { name: "mod", path: one },
                { name: "other", path: two },
            ],
            hostDeps().deps,
        );
        expect(
            multi
                .list()
                .map((i) => i.label)
                .sort(),
        ).toEqual(["mod/icon.bam", "other/other.bam"]);
    });

    it("locates an item at its real path on disk", async () => {
        const dir = tmpDir({ "icon.bam": "x" });
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps().deps);
        const [item] = src.list();
        expect(src.locate(item!.id)).toEqual({ kind: "file", path: path.join(dir, "icon.bam") });
    });

    // A workspace file is editable while the gallery is open, so unlike a biffed resource its stamp has to
    // move when the bytes do - otherwise an edited icon keeps showing its old thumbnail.
    it("changes an item's stamp when the host reports the file changed", async () => {
        const dir = tmpDir({ "icon.bam": "x" });
        const host = hostDeps();
        const src = await workspaceSource([{ name: "mod", path: dir }], host.deps);
        const [item] = src.list();
        const before = src.stamp(item!.id);
        expect(before).toBeDefined();
        host.changed(path.join(dir, "icon.bam"));
        expect(src.stamp(item!.id)).not.toBe(before);
    });

    it("keeps an item's stamp still while nothing reports a change", async () => {
        const dir = tmpDir({ "icon.bam": "x", "other.bam": "x" });
        const host = hostDeps();
        const src = await workspaceSource([{ name: "mod", path: dir }], host.deps);
        const [item] = src.list();
        const before = src.stamp(item!.id);
        // A neighbour moving must not move this item's stamp, or every edit re-decodes the whole grid.
        host.changed(path.join(dir, "other.bam"));
        expect(src.stamp(item!.id)).toBe(before);
    });

    it("has no stamp for a file the host reports deleted", async () => {
        const dir = tmpDir({ "icon.bam": "x" });
        const host = hostDeps();
        const src = await workspaceSource([{ name: "mod", path: dir }], host.deps);
        const [item] = src.list();
        host.removed(path.join(dir, "icon.bam"));
        expect(src.stamp(item!.id)).toBeUndefined();
    });

    /**
     * A mod folder ships its BAM v2 pages beside the `.bam` that names them, and IE names them in uppercase
     * while a modder's folder may not - so the match has to ignore case or every v2 in the workspace goes
     * blank on a case-sensitive host.
     */
    it("finds a PVRZ page beside the file that names it, whatever its case", async () => {
        const dir = tmpDir({ "art/icon.bam": "x", "art/mos0012.pvrz": "page" });
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps().deps);
        expect(src.locateAux("MOS0012.PVRZ", "art/icon.bam")).toEqual({
            kind: "file",
            path: path.join(dir, "art", "mos0012.pvrz"),
        });
    });

    // The page is not a drawable, so it is absent from the item index - a listing filtered to gallery items
    // could not answer this at all.
    it("has no page when none sits beside the file, or the item is unknown", async () => {
        const dir = tmpDir({ "art/icon.bam": "x", "elsewhere/mos0012.pvrz": "page" });
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps().deps);
        expect(src.locateAux("MOS0012.PVRZ", "art/icon.bam")).toBeUndefined();
        expect(src.locateAux("MOS0012.PVRZ", "nosuch.bam")).toBeUndefined();
    });

    it("reveals nothing for an item it does not have", async () => {
        const dir = tmpDir({ "icon.bam": "x" });
        const reveal = vi.fn(async () => {});
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps(reveal).deps);
        await src.reveal("nosuch.bam");
        expect(reveal).not.toHaveBeenCalled();
    });

    it("skips directories that never hold art", async () => {
        const dir = tmpDir({ "node_modules/pkg/icon.bam": "x", ".git/icon.bam": "x", "real.bam": "x" });
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps().deps);
        expect(src.list().map((i) => i.label)).toEqual(["real.bam"]);
    });

    it("reveals through the injected action, by path", async () => {
        const dir = tmpDir({ "icon.bam": "x" });
        const reveal = vi.fn(async () => {});
        const src = await workspaceSource([{ name: "mod", path: dir }], hostDeps(reveal).deps);
        const [item] = src.list();
        await src.reveal(item!.id);
        expect(reveal).toHaveBeenCalledWith(path.join(dir, "icon.bam"));
    });
});
