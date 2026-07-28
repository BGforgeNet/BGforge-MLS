/**
 * Infinity Engine KEY/BIF archive support: read an installed game's resource
 * namespace (`chitin.key` + the BIFs it indexes). Read-only; extraction is
 * streamed so large BIFs are never bulk-loaded. See `./game` for the top-level
 * `openGame(dir)` entry point.
 */

export { parseKey } from "./key";
export type { KeyIndex, KeyBifEntry, KeyResource } from "./key";
export { openBif, parseBif } from "./bif";
export type { BifArchive, BifFileEntry, BifTilesetEntry } from "./bif";
export { parseIds } from "./ids";
export { openTlk, parseTlk } from "./tlk";
export type { Tlk } from "./tlk";
export { bufferSource, fileSource } from "./byte-source";
export type { ByteSource } from "./byte-source";
export { openGame, engineOverrideFolders } from "./game";
export type { Game, GameResourceRef, OpenGameOptions } from "./game";
export { detectGameIdentity } from "./game-type";
export type { GameIdentity, IeVariant, IeScriptStyle } from "./game-type";
export { resourceTypeExt, resourceTypeCode } from "./resource-type";
