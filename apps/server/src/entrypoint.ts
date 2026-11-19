// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

/** Fallback for supported Node 22.16, 22.17 and 23.11, where import.meta.main is undefined. */
export const isEntrypoint = (input: {
  readonly moduleUrl: string;
  readonly entryPath: string | undefined;
  readonly runtimeMain: boolean | undefined;
}) => {
  if (input.runtimeMain !== undefined) {
    return input.runtimeMain;
  }
  if (input.entryPath === undefined || input.entryPath === "") {
    return false;
  }
  if (input.moduleUrl === NodeURL.pathToFileURL(input.entryPath).href) {
    return true;
  }
  try {
    return input.moduleUrl === NodeURL.pathToFileURL(NodeFS.realpathSync(input.entryPath)).href;
  } catch {
    return false;
  }
};
