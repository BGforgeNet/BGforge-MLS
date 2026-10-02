/** A program the INT format cannot hold. Its own module so the tables `emit.ts` builds on can raise it. */
export class EmitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmitError";
    }
}
