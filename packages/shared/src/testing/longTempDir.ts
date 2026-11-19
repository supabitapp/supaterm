// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as HostProcess from "../HostProcess.ts";

if (HostProcess.Platform.defaultValue() === "win32") {
  try {
    const longForm = NodeFS.realpathSync.native(NodeOS.tmpdir());
    process.env.TEMP = longForm;
    process.env.TMP = longForm;
  } catch {}
}
