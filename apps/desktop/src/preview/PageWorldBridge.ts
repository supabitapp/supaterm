import { contextBridge } from "electron";

import { installPageWorld } from "./PageWorld.ts";

/** Installed before any page script runs; calls cross into the page's world and back. */
export const pageWorld: ReturnType<typeof installPageWorld> = contextBridge.executeInMainWorld({
  func: installPageWorld,
});
