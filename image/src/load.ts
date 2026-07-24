import { type Animation } from "./model/animation.ts";
import { parseFrm } from "./frm/parse.ts";
import { parseBamV1 } from "./bam/parse.ts";
import { isBamc, decodeBamc } from "./bam/bamc.ts";

function sig(bytes: Uint8Array): string {
    return String.fromCodePoint(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
}

export function loadImage(bytes: Uint8Array, name: string): Animation {
    if (isBamc(bytes)) {
        const anim = parseBamV1(decodeBamc(bytes));
        anim.meta.sourceFormat = "bamc";
        return anim;
    }
    if (sig(bytes) === "BAM ") return parseBamV1(bytes);
    if (name.toLowerCase().endsWith(".frm")) return parseFrm(bytes);
    throw new Error(`Unrecognized image format for "${name}" (signature "${sig(bytes)}")`);
}
