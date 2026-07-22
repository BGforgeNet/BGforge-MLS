// Versioned on-disk manifest for an exported animation directory (indexed PNG frames +
// manifest.json). This is a FROZEN wire format, deliberately decoupled from the internal
// `Animation` IR so the IR can evolve without breaking directories exported by older builds.
// No palette here - palettes live in the exported PNGs (Task 7, directory layer).
import type { Animation, AnimationMeta, DirectionLayout, Facing, Sequence, SourceFormat } from "../model/animation.ts";

export interface ManifestV1 {
    manifestVersion: 1;
    kind: "bgforge-animation";
    meta: AnimationMeta;
    sequences: { id: string; facing: Facing; offsets: [number, number][] }[];
}

type ManifestSequence = ManifestV1["sequences"][number];

// Sets typed <string> (not <Facing>/etc.) so membership checks accept an arbitrary
// unknown-derived string without a cast; Facing[] -> Iterable<string> is a safe widening.
const FACINGS = new Set<string>(["NE", "E", "SE", "SW", "W", "NW", "N", "S", "none"] satisfies Facing[]);
const SOURCE_FORMATS = new Set<string>(["frm", "bam", "bamc"] satisfies SourceFormat[]);
const DIRECTION_LAYOUTS = new Set<string>(["frm6", "ie8", "non-directional"] satisfies DirectionLayout[]);

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

function isFacing(v: unknown): v is Facing {
    return typeof v === "string" && FACINGS.has(v);
}

function isSourceFormat(v: unknown): v is SourceFormat {
    return typeof v === "string" && SOURCE_FORMATS.has(v);
}

function isDirectionLayout(v: unknown): v is DirectionLayout {
    return typeof v === "string" && DIRECTION_LAYOUTS.has(v);
}

function isNumberArray(v: unknown): v is number[] {
    return Array.isArray(v) && v.every((x) => typeof x === "number");
}

function isOffsetPair(v: unknown): v is [number, number] {
    return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
}

function isAnimationMeta(v: unknown): v is AnimationMeta {
    if (!isRecord(v)) return false;
    if (!isSourceFormat(v.sourceFormat)) return false;
    if (v.fps !== undefined && typeof v.fps !== "number") return false;
    if (v.actionFrame !== undefined && typeof v.actionFrame !== "number") return false;
    if (v.transparentIndex !== undefined && typeof v.transparentIndex !== "number") return false;
    if (v.directionLayout !== undefined && !isDirectionLayout(v.directionLayout)) return false;
    if (v.frmVersion !== undefined && typeof v.frmVersion !== "number") return false;
    if (v.dirOffsetsX !== undefined && !isNumberArray(v.dirOffsetsX)) return false;
    if (v.dirOffsetsY !== undefined && !isNumberArray(v.dirOffsetsY)) return false;
    return true;
}

function isManifestSequence(v: unknown): v is ManifestSequence {
    if (!isRecord(v)) return false;
    if (typeof v.id !== "string") return false;
    if (!isFacing(v.facing)) return false;
    return Array.isArray(v.offsets) && v.offsets.every(isOffsetPair);
}

// Zero-padded to 3 digits (000.png .. 999.png). padStart never truncates, so a sequence
// that somehow exceeds 999 frames widens naturally (1000.png) rather than losing digits.
export function frameFileName(index: number): string {
    return `${String(index).padStart(3, "0")}.png`;
}

export function sequenceDirId(seq: Sequence, index: number): string {
    return seq.facing !== "none" ? seq.facing : String(index).padStart(2, "0");
}

export function writeManifest(anim: Animation): ManifestV1 {
    return {
        manifestVersion: 1,
        kind: "bgforge-animation",
        meta: anim.meta,
        sequences: anim.sequences.map((seq, index) => ({
            id: sequenceDirId(seq, index),
            facing: seq.facing,
            offsets: seq.frameRefs.map((ref): [number, number] => {
                const frame = anim.frames[ref];
                if (!frame) throw new Error(`sequence references out-of-range frame index ${ref}`);
                return [frame.offsetX, frame.offsetY];
            }),
        })),
    };
}

export function readManifest(m: unknown): { meta: AnimationMeta; sequences: ManifestV1["sequences"] } {
    if (!isRecord(m)) throw new Error("manifest must be a JSON object");
    if (m.manifestVersion !== 1) {
        // Seam for the next format bump: add `migrateV1toV2(m)` here once a v2 schema exists,
        // and widen the version check instead of always rejecting non-1 values.
        throw new Error(`unsupported manifest version: ${JSON.stringify(m.manifestVersion)}`);
    }
    if (m.kind !== "bgforge-animation") {
        throw new Error(`unsupported manifest kind: ${JSON.stringify(m.kind)}`);
    }
    if (!isAnimationMeta(m.meta)) throw new Error("manifest meta is malformed");
    if (!Array.isArray(m.sequences) || !m.sequences.every(isManifestSequence)) {
        throw new Error("manifest sequences are malformed");
    }
    return { meta: m.meta, sequences: m.sequences };
}
