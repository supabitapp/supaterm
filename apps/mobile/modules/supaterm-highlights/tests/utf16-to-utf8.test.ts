import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { it } from "vite-plus/test";

it("transcodes UTF-16 the way jsi::String::utf8 does", () => {
  NodeChildProcess.execFileSync(
    "bash",
    [NodeURL.fileURLToPath(new URL("./run.sh", import.meta.url))],
    {
      stdio: "pipe",
    },
  );
});
