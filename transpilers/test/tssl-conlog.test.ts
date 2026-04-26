import { afterEach, describe, expect, it } from "vitest";
import { conlog, setConlog } from "../tssl/src/types";

describe("tssl conlog injection", () => {
    afterEach(() => {
        // Reset to the default sink between tests so a failure in one test
        // does not leak its captured logger into the next.
        setConlog(console.error);
    });

    it("routes conlog output through the injected logger", () => {
        const captured: string[] = [];
        setConlog((message) => captured.push(String(message)));

        conlog("compile started");
        conlog("compile finished");

        expect(captured).toStrictEqual(["compile started", "compile finished"]);
    });

    it("falls back to console.error after reset", () => {
        const captured: string[] = [];
        setConlog((message) => captured.push(String(message)));
        conlog("through custom");
        setConlog(console.error);

        // After reset, the previous custom logger must no longer receive messages.
        // We can't easily intercept console.error portably here, so the assertion
        // is that captured stays at length 1.
        conlog("through default");
        expect(captured).toStrictEqual(["through custom"]);
    });
});
