import { type IndexedAnimation } from "./model/animation.ts";
import { parseFrm } from "./frm/parse.ts";
import { parseBamV1 } from "./bam/parse.ts";
import { isBamc, decodeBamc } from "./bam/bamc.ts";
import { pvrzResourceName } from "./bam/v2-parse.ts";
import { readBamV2Structure } from "./bam/v2-structure.ts";

function sig(bytes: Uint8Array): string {
    return String.fromCodePoint(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
}

export function loadImage(bytes: Uint8Array, name: string): IndexedAnimation {
    if (isBamc(bytes)) {
        const anim = parseBamV1(decodeBamc(bytes));
        anim.meta.sourceFormat = "bamc";
        return anim;
    }
    if (sig(bytes) === "BAM ") {
        // v1 and v2 share the "BAM " signature - the version is the NEXT four bytes - so dispatching
        // on the signature alone would hand a v2 file to the v1 parser.
        if (bytes.byteLength >= 8 && String.fromCodePoint(...bytes.subarray(4, 8)) === "V2  ") {
            const needed = readBamV2Structure(bytes).requiredPages.map(pvrzResourceName);
            throw new Error(
                `loadImage: "${name}" is BAM V2, whose frames live in separate PVRZ pages (${needed.join(", ")}). ` +
                    `loadImage cannot fetch them - read it with readBamV2Structure + decodeBamV2 and a resolver.`,
            );
        }
        return parseBamV1(bytes);
    }
    if (name.toLowerCase().endsWith(".frm")) return parseFrm(bytes);
    throw new Error(`Unrecognized image format for "${name}" (signature "${sig(bytes)}")`);
}
