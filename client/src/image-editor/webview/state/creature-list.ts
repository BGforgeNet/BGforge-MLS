/**
 * When the creature picker asks the host for the install's creatures.
 *
 * Its own module rather than a condition inside the component: the picker is fetch-on-demand, and getting the
 * "already asked" bookkeeping wrong is invisible in every render.
 */

/**
 * Whether opening the picker should ask the host for the list.
 *
 * Asked-and-answered stops the repeat, and what counts as an answer is a GAME having answered - not the
 * list being non-empty. Until one has, the note beside the picker asks the reader to open an install, so
 * the next open must pick up the one they just opened rather than serving the pre-game emptiness for the
 * rest of the document's life. Keying on emptiness instead also re-asked, forever, for an install that
 * genuinely lists no creatures.
 */
export function shouldFetchCreatures(asked: boolean, gameOpen: boolean): boolean {
    return !asked || !gameOpen;
}
