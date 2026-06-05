// Browser side of the primitives showcase. Mounts the Showcase component (which renders the Select
// wrapper) into #app. Loaded by render-primitives.mts inside a page that enforces the real webview CSP,
// so any CSP violation from bits-ui surfaces as a browser console error the driver can catch.
import { mount } from "svelte";
import Showcase from "./Showcase.svelte";

const target = document.querySelector("#app");
if (target) mount(Showcase, { target });
