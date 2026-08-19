/**
 * Serialises work that shares a working directory.
 *
 * A compile writes intermediate files whose names are fixed for a given directory - our own copy of the
 * document, and the compiler's preprocessor scratch file, whose name is a constant it derives once per
 * run. Two compiles started in one directory therefore write the same paths at the same time. The
 * failures that produces are worse than a lost run: the loser reads back a file the winner is midway
 * through writing and reports syntax errors positioned in whatever it read, so the user sees an error in
 * a header they never touched, on a build that is actually fine.
 *
 * Serialising by directory rather than by document is what matches the resource: the clash is between two
 * different files that happen to sit side by side, which a per-document guard cannot see.
 */

import * as path from "path";

/** The tail of each directory's queue. Absent means nothing is running there. */
const tails = new Map<string, Promise<void>>();

/**
 * Runs `body` once every earlier body for `directory` has settled, and resolves with whatever it returned.
 *
 * A body that throws releases the directory like any other: the queue is a mutual-exclusion device, not an
 * error barrier, so a failed compile must not wedge every later compile beside it.
 */
export function withDirectoryGate<T>(directory: string, body: () => Promise<T>): Promise<T> {
    const key = path.resolve(directory);
    const previous = tails.get(key) ?? Promise.resolve();

    const result = previous.then(body);
    const tail = result.then(
        () => {},
        () => {},
    );
    tails.set(key, tail);

    // Drop the key once this run is the last one queued, so a long session does not accumulate an entry
    // per directory ever compiled in.
    void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });

    return result;
}
