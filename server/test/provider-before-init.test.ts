/**
 * A provider compiled before its init. The registry inits every provider before it serves a request, so this
 * is a wiring bug - and a bug that logs and returns shows an interactive compile doing nothing at all.
 * Its own file, so that nothing here has initialised the provider singletons.
 */

import { describe, expect, it, vi } from "vitest";

// The log needs a live connection; without one it would throw for its own reason and hide the provider's.
vi.mock("../src/logger", () => ({ conlog: vi.fn() }));

import { normalizeUri } from "../src/core/normalized-uri";
import { falloutSslProvider } from "../src/fallout-ssl/provider";
import { weiduBafProvider } from "../src/weidu-baf/provider";
import { weiduDProvider } from "../src/weidu-d/provider";
import { weiduTp2Provider } from "../src/weidu-tp2/provider";

describe("a provider compiled before its init", () => {
    it.each([
        ["Fallout SSL", falloutSslProvider, "file:///x.ssl"],
        ["WeiDU BAF", weiduBafProvider, "file:///x.baf"],
        ["WeiDU D", weiduDProvider, "file:///x.d"],
        ["WeiDU TP2", weiduTp2Provider, "file:///x.tp2"],
    ] as const)("%s refuses by name", async (name, provider, uri) => {
        await expect(provider.compile!(normalizeUri(uri), "", true)).rejects.toThrow(
            `${name} provider was used before its init`,
        );
    });
});
