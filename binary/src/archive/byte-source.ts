/**
 * A random-access byte source. `read` returns exactly `length` bytes at `offset`
 * or throws - never a short read. Backs both an in-memory buffer and an on-disk
 * file so a large BIF is read one resource at a time (positioned reads) rather
 * than loaded whole.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface ByteSource {
    readonly size: number;
    read(offset: number, length: number): Uint8Array;
    close(): void;
}

function checkRange(offset: number, length: number, size: number): void {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) {
        throw new RangeError(`Invalid read: offset=${offset} length=${length}`);
    }
    if (offset + length > size) {
        throw new RangeError(`Read out of bounds: offset=${offset} length=${length} exceeds size=${size}`);
    }
}

/** In-memory source. `read` returns a view over the same memory (no copy); callers must not mutate it. */
export function bufferSource(bytes: Uint8Array): ByteSource {
    return {
        size: bytes.byteLength,
        read(offset, length) {
            checkRange(offset, length, bytes.byteLength);
            return bytes.subarray(offset, offset + length);
        },
        close() {},
    };
}

/**
 * Write `data` to `absPath` atomically: a temp file in the SAME directory (same filesystem, so the rename is
 * atomic) then rename over the destination. A crash mid-write leaves the prior file intact - never a truncated
 * one. Used by the mutable resource tree so an install/uninstall never exposes a half-written resource.
 */
export function atomicWriteFileSync(absPath: string, data: Uint8Array): void {
    const dir = path.dirname(absPath);
    const tempPath = path.join(dir, `.${path.basename(absPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, absPath);
}

/** File-descriptor source doing positioned `fs.readSync`, so only the requested ranges are ever read. */
export function fileSource(filePath: string): ByteSource {
    const fd = fs.openSync(filePath, "r");
    let size: number;
    try {
        size = fs.fstatSync(fd).size;
    } catch (error) {
        fs.closeSync(fd);
        throw error;
    }
    return {
        size,
        read(offset, length) {
            checkRange(offset, length, size);
            const buf = Buffer.allocUnsafe(length);
            let done = 0;
            while (done < length) {
                const n = fs.readSync(fd, buf, done, length - done, offset + done);
                if (n === 0) throw new RangeError(`Unexpected EOF reading ${length} bytes at ${offset}`);
                done += n;
            }
            return buf;
        },
        close() {
            fs.closeSync(fd);
        },
    };
}
