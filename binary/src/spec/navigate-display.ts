/**
 * Locators for the display tree a parser emits: pick one named group or field
 * out of a `ParsedGroup`. `walk-display.ts` converts a whole group to and from
 * typed data; these find the group to hand it.
 */

import type { ParsedField, ParsedGroup } from "../types";

export function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

export interface DisplayNavigator {
    getGroup(root: ParsedGroup, name: string): ParsedGroup;
    getOptionalGroup(root: ParsedGroup, name: string): ParsedGroup | undefined;
    getField(group: ParsedGroup, name: string): ParsedField;
}

/**
 * Build the locators for one format. `formatLabel` names the format in the thrown
 * message ("Missing PRO group: Header"), the only thing that differed between the
 * per-format copies of these helpers.
 */
export function displayNavigator(formatLabel: string): DisplayNavigator {
    return {
        getGroup(root, name) {
            const group = root.fields.find((entry): entry is ParsedGroup => isGroup(entry) && entry.name === name);
            if (!group) {
                throw new Error(`Missing ${formatLabel} group: ${name}`);
            }
            return group;
        },

        getOptionalGroup(root, name) {
            return root.fields.find((entry): entry is ParsedGroup => isGroup(entry) && entry.name === name);
        },

        getField(group, name) {
            const field = group.fields.find((entry): entry is ParsedField => !isGroup(entry) && entry.name === name);
            if (!field) {
                throw new Error(`Missing ${formatLabel} field: ${group.name}.${name}`);
            }
            return field;
        },
    };
}
