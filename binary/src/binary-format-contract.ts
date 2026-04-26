import { z } from "zod";

type BinaryFormat = "pro" | "map";

type NumericTypeName = "uint8" | "uint16" | "uint24" | "uint32" | "int8" | "int16" | "int24" | "int32";

interface NumericRange {
    readonly min: number;
    readonly max: number;
}

const NUMERIC_TYPE_RANGES: Record<NumericTypeName, NumericRange> = {
    uint8: { min: 0, max: 0xff },
    uint16: { min: 0, max: 0xff_ff },
    uint24: { min: 0, max: 0xff_ff_ff },
    uint32: { min: 0, max: 0xff_ff_ff_ff },
    int8: { min: -128, max: 127 },
    int16: { min: -32_768, max: 32_767 },
    int24: { min: -8_388_608, max: 8_388_607 },
    int32: { min: -2_147_483_648, max: 2_147_483_647 },
};

const DOMAIN_RANGES: Record<BinaryFormat, Readonly<Record<string, NumericRange>>> = {
    pro: {
        "pro.header.lightRadius": { min: 0, max: 8 },
        "pro.header.lightIntensity": { min: 0, max: 65_536 },
        "pro.doorProperties.walkThruFlag": { min: 0, max: 1 },
        "pro.stairsProperties.destTile": { min: 0, max: 0x03_ff_ff_ff },
        "pro.stairsProperties.destElevation": { min: 0, max: 0x3f },
        "pro.ladderProperties.destTile": { min: 0, max: 0x03_ff_ff_ff },
        "pro.ladderProperties.destElevation": { min: 0, max: 0x3f },
    },
    map: {
        "map.header.defaultElevation": { min: 0, max: 2 },
        "map.header.defaultOrientation": { min: 0, max: 5 },
        "map.objects.elevations[].objects[].exitGrid.destinationElevation": { min: 0, max: 2 },
        "map.objects.elevations[].objects[].exitGrid.destinationRotation": { min: 0, max: 5 },
    },
};

export function getNumericTypeRange(type: string): NumericRange | undefined {
    return NUMERIC_TYPE_RANGES[type as NumericTypeName];
}

export function getDomainRange(format: string, fieldKey: string): NumericRange | undefined {
    if (format !== "pro" && format !== "map") {
        return undefined;
    }
    return DOMAIN_RANGES[format][fieldKey];
}

export function validateNumericValue(
    value: number,
    type: string,
    context?: {
        readonly format?: string;
        readonly fieldKey?: string;
    },
): string | undefined {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return `Value must be an integer, got ${value}`;
    }

    const typeRange = getNumericTypeRange(type);
    if (typeRange && (value < typeRange.min || value > typeRange.max)) {
        return `Value ${value} out of range for ${type} (${typeRange.min} to ${typeRange.max})`;
    }

    const format = context?.format;
    const fieldKey = context?.fieldKey;
    if (format && fieldKey) {
        const domainRange = getDomainRange(format, fieldKey);
        if (domainRange && (value < domainRange.min || value > domainRange.max)) {
            return `Value ${value} out of allowed range for ${fieldKey} (${domainRange.min} to ${domainRange.max})`;
        }
    }

    return undefined;
}

export function clampNumericValue(
    value: number,
    type: string,
    context?: {
        readonly format?: string;
        readonly fieldKey?: string;
    },
): number {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return value;
    }

    let min = -Infinity;
    let max = Infinity;

    const typeRange = getNumericTypeRange(type);
    if (typeRange) {
        min = Math.max(min, typeRange.min);
        max = Math.min(max, typeRange.max);
    }

    const format = context?.format;
    const fieldKey = context?.fieldKey;
    if (format && fieldKey) {
        const domainRange = getDomainRange(format, fieldKey);
        if (domainRange) {
            min = Math.max(min, domainRange.min);
            max = Math.min(max, domainRange.max);
        }
    }

    return Math.min(Math.max(value, min), max);
}

export function zodNumericType(type: NumericTypeName): z.ZodNumber {
    const range = NUMERIC_TYPE_RANGES[type];
    return z.number().int().min(range.min).max(range.max);
}

export function zodFieldNumber(format: BinaryFormat, fieldKey: string, type: NumericTypeName): z.ZodNumber {
    const schema = zodNumericType(type);
    const range = getDomainRange(format, fieldKey);
    return range ? schema.min(range.min).max(range.max) : schema;
}
