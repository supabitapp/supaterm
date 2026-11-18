import interfaceFontUrl from "allo-font/fonts/webfonts/AlloVariableFriendly.woff2?url";
import { showBootError } from "./lib/bootError";

// A static <link> in index.html would preload a different dev URL than the stylesheet requests.
document.head.append(
  Object.assign(document.createElement("link"), {
    rel: "preload",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
    href: interfaceFontUrl,
  }),
);

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
void import("./main").then(({ startup }) => startup).catch(showBootError);
