/**
 * The runtime half of iets 0.5.0's `src/index.ts`, as a bundle inlines it: a real class, a real `obj`, and the
 * scope constants bound to their strings. The transpiler has to read `obj(...)` as the reference builder it
 * stands for and never evaluate the class, which has no compile-time value.
 */

export class ObjectSpec {
    id: string;
    constructor(id: string) {
        this.id = id;
    }
}

export function obj(spec: string): ObjectSpec {
    return new ObjectSpec(spec);
}

export const GLOBAL = "GLOBAL";
export const LOCALS = "LOCALS";
