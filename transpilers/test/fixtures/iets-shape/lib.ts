/**
 * The runtime half of an iets-shaped dependency: a real class and a real function, in the same
 * dependency as the declarations next door.
 *
 * iets is this shape - `src/index.ts` exports `class ObjectSpec` while forty sibling `.d.ts` files
 * declare engine builtins - which is why the dependency cannot be externalised wholesale: doing so
 * drops these bodies out of the bundle the transpiler reads.
 */

export class ObjectRef {
    readonly id: string;

    constructor(id: string) {
        this.id = id;
    }
}

export function nearest(id: string): ObjectRef {
    return new ObjectRef(id);
}
