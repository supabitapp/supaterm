import interfaceFontUrl from "allo-font/fonts/webfonts/AlloVariableFriendly.woff2?url";
import { showBootError } from "./lib/bootError";

const interfaceFontPreload = document.createElement("link");
interfaceFontPreload.rel = "preload";
interfaceFontPreload.as = "font";
interfaceFontPreload.type = "font/woff2";
interfaceFontPreload.crossOrigin = "anonymous";
interfaceFontPreload.href = interfaceFontUrl;
document.head.append(interfaceFontPreload);

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
void import("./main").then(({ startup }) => startup).catch(showBootError);
