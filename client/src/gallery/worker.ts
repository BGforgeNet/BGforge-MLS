/**
 * The gallery worker thread: every archive read, decode and PNG encode for the thumbnail grid.
 *
 * Runs off the extension host so scrolling a game-wide grid cannot stall the UI. It holds two caches that
 * only make sense here, because both are per-thread state a pure job function cannot keep: open BIF handles,
 * and decoded PVRZ pages.
 */
import * as fs from "fs";
import { parentPort } from "node:worker_threads";
import { type BifArchive, type ResourceLocation, fileSource, openBif } from "@bgforge/binary";
import { type GalleryIo, type GalleryRequest, makePageCache, runJob } from "./worker-core";

/** Open archives, keyed by path. A classic install answers most of a grid from a handful of BIFs, and
 *  re-opening one per tile would re-read its header - or, for a compressed BIF, re-inflate the whole file. */
const archives = new Map<string, BifArchive>();
function archiveAt(path: string): BifArchive {
    const open = archives.get(path);
    if (open) return open;
    const archive = openBif(fileSource(path));
    archives.set(path, archive);
    return archive;
}

function readRaw(at: ResourceLocation): Uint8Array {
    if (at.kind === "file") return new Uint8Array(fs.readFileSync(at.path));
    const archive = archiveAt(at.archivePath);
    return at.tileset ? archive.readTileset(at.entry) : archive.readFile(at.entry);
}

/**
 * Where each PVRZ page lives, learned from the host as requests arrive.
 *
 * A page name resolves to one location for the life of a game session, so remembering it lets the cache key
 * on the name alone - which is the point: a real install's v2 BAMs share far fewer pages than they have
 * files, so a per-item read would decode the same page over and over.
 */
const pageLocations = new Map<string, ResourceLocation>();
const pageBytes = makePageCache((name: string): Uint8Array | undefined => {
    const at = pageLocations.get(name);
    return at === undefined ? undefined : readRaw(at);
});

const io: GalleryIo = {
    readBytes: readRaw,
    readPage(name, at) {
        pageLocations.set(name, at);
        return pageBytes.get(name);
    },
};

if (!parentPort) throw new Error("gallery worker must be spawned with a parentPort");
const port = parentPort;

port.on("message", (request: GalleryRequest) => {
    port.postMessage(runJob(request, io));
});
