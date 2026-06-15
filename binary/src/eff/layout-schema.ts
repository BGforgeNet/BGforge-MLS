/**
 * EFF declarative layout. EFF v2 is a single standalone effect (8-byte header + 264-byte body), so the
 * editor renders it as one dense page via the generic layout renderer instead of the legacy Header/Body
 * tabs. One variant ("effect"), stamped by the parser.
 *
 * Field refs are the semantic keys the EFF adapter produces for the body fields (`eff.body.<camelCase>`,
 * verified against the model). The two signature/version magic fields (header and body) and the reserved
 * padding (`unused1`..`unused7`) are intentionally omitted - they are constants/padding, not user data;
 * leaving them out of the layout does not affect round-trip (the serializer rebuilds from the model). The
 * ~300-entry `opcode` enum renders as a searchable combobox (every enum does); being `enumOpen` it also
 * accepts a custom numeric value.
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";
import { effV2BodyLabels, effV2BodyRows } from "./effect-body-layout";

// The EFF v2 body layout is shared with CRE's embedded v2 effects (`cre.effects[].v2.`) via the fragment in
// `effect-body-layout.ts`, so a standalone `.eff` and a CRE-embedded effect render identical panels. Here the
// standalone effect IS the body, at the `eff.body.` prefix.
const EFF_BODY_PREFIX = "eff.body";

export const effLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "eff",
    maxContentWidthPx: 1000,
    labels: effV2BodyLabels(EFF_BODY_PREFIX),
    variants: {
        effect: { rows: effV2BodyRows(EFF_BODY_PREFIX) },
    },
});
