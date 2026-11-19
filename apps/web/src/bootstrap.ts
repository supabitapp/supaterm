import interfaceFontUrl from "allo-font/fonts/webfonts/AlloVariableFriendly.woff2?url";
import { showBootError } from "./lib/bootError";

document.head.append(
  Object.assign(document.createElement("link"), {
    rel: "preload",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
    href: interfaceFontUrl,
  }),
);

void import("./main").then(({ startup }) => startup).catch(showBootError);
