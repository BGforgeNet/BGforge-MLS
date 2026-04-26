import { u32, i32 } from "typed-binary";
import type { StructSpec } from "../../spec/types";
import type { ArmorData } from "../schemas";

export const armorSpec: StructSpec<ArmorData> = {
    ac: { codec: u32 },
    drNormal: { codec: u32 },
    drLaser: { codec: u32 },
    drFire: { codec: u32 },
    drPlasma: { codec: u32 },
    drElectrical: { codec: u32 },
    drEmp: { codec: u32 },
    drExplosion: { codec: u32 },
    dtNormal: { codec: u32 },
    dtLaser: { codec: u32 },
    dtFire: { codec: u32 },
    dtPlasma: { codec: u32 },
    dtElectrical: { codec: u32 },
    dtEmp: { codec: u32 },
    dtExplosion: { codec: u32 },
    perk: { codec: u32 },
    maleFrmId: { codec: i32 },
    femaleFrmId: { codec: i32 },
};
