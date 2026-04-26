/**
 * typed-binary schema definitions for PRO file format.
 * Replaces pro-parsers.ts (binary-parser). Each schema is bidirectional:
 * the same definition drives both read() and write().
 *
 * Endianness is set on the BufferReader/BufferWriter, not in the schema.
 * PRO files are big-endian: use { endianness: 'big' }.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { ammoSpec } from "./specs/ammo";
import { armorSpec } from "./specs/armor";
import { containerSpec } from "./specs/container";
import { critterSpec } from "./specs/critter";
import { doorSpec } from "./specs/door";
import { drugSpec } from "./specs/drug";
import { elevatorSpec } from "./specs/elevator";
import { genericScenerySpec } from "./specs/generic-scenery";
import { headerSpec } from "./specs/header";
import { itemCommonSpec } from "./specs/item-common";
import { keySpec } from "./specs/key";
import { ladderSpec } from "./specs/ladder";
import { miscItemSpec } from "./specs/misc-item";
import { miscSpec } from "./specs/misc";
import { sceneryCommonSpec } from "./specs/scenery-common";
import { stairsSpec } from "./specs/stairs";
import { tileSpec } from "./specs/tile";
import { wallSpec } from "./specs/wall";
import { weaponSpec } from "./specs/weapon";

// -- Header (24 bytes, 0x00-0x17) -------------------------------------------

export const headerSchema = toTypedBinarySchema(headerSpec);

// -- Item common (33 bytes, 0x18-0x38) --------------------------------------

export const itemCommonSchema = toTypedBinarySchema(itemCommonSpec);

// -- Item subtypes ----------------------------------------------------------

export const armorSchema = toTypedBinarySchema(armorSpec);

export const containerSchema = toTypedBinarySchema(containerSpec);

export const drugSchema = toTypedBinarySchema(drugSpec);

export const weaponSchema = toTypedBinarySchema(weaponSpec);

export const ammoSchema = toTypedBinarySchema(ammoSpec);

export const miscItemSchema = toTypedBinarySchema(miscItemSpec);

export const keySchema = toTypedBinarySchema(keySpec);

// -- Critter (392 bytes at 0x18-0x19F, total file 416) ----------------------

export const critterSchema = toTypedBinarySchema(critterSpec);

// -- Scenery common (17 bytes, 0x18-0x28) -----------------------------------

export const sceneryCommonSchema = toTypedBinarySchema(sceneryCommonSpec);

// -- Scenery subtypes -------------------------------------------------------

export const doorSchema = toTypedBinarySchema(doorSpec);
export const stairsSchema = toTypedBinarySchema(stairsSpec);
export const elevatorSchema = toTypedBinarySchema(elevatorSpec);
export const ladderSchema = toTypedBinarySchema(ladderSpec);
export const genericScenerySchema = toTypedBinarySchema(genericScenerySpec);

// -- Wall (12 bytes, 0x18-0x23) ---------------------------------------------

export const wallSchema = toTypedBinarySchema(wallSpec);

// -- Tile (4 bytes, 0x18-0x1B) ----------------------------------------------

export const tileSchema = toTypedBinarySchema(tileSpec);

// -- Misc (4 bytes, 0x18-0x1B) ----------------------------------------------

export const miscSchema = toTypedBinarySchema(miscSpec);

// -- Exported data types (inferred from schemas) ----------------------------

export type { HeaderData } from "./specs/header";
export type { ItemCommonData } from "./specs/item-common";
export type { ArmorData } from "./specs/armor";
export type { ContainerData } from "./specs/container";
export type { DrugData } from "./specs/drug";
export type { WeaponData } from "./specs/weapon";
export type { AmmoData } from "./specs/ammo";
export type { MiscItemData } from "./specs/misc-item";
export type { KeyData } from "./specs/key";
export type { CritterData } from "./specs/critter";
export type { SceneryCommonData } from "./specs/scenery-common";
export type { DoorData } from "./specs/door";
export type { StairsData } from "./specs/stairs";
export type { ElevatorData } from "./specs/elevator";
export type { LadderData } from "./specs/ladder";
export type { GenericSceneryData } from "./specs/generic-scenery";
export type { WallData } from "./specs/wall";
export type { TileData } from "./specs/tile";
export type { MiscData } from "./specs/misc";
