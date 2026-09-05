/**
 * When the creature picker asks the host for the install's creatures.
 *
 * Its own module rather than a condition inside the component: the picker is fetch-on-demand, and getting the
 * "already asked" bookkeeping wrong is invisible in every render.
 */

/**
 * Whether opening the picker should ask the host for the list.
 *
 * Asked-and-answered stops the repeat. An EMPTY answer is not an answer to keep: it means no game is open,
 * which the note beside the picker tells the reader to fix - so the next open must ask again rather than
 * serve the pre-game emptiness for the rest of the document's life.
 */
export function shouldFetchCreatures(asked: boolean, listed: number): boolean {
    return !asked || listed === 0;
}
