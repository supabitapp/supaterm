// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - test process protocol for native endpoints.
import * as NodeReadline from "node:readline";
import { startNativeFixture } from "./relay.fixture.ts";
const fixture = await startNativeFixture();
try {
  console.log(JSON.stringify(fixture.config));
  for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
    const { op } = JSON.parse(line) as { op: string };
    if (op === "stop") break;
    console.log(JSON.stringify(await fixture.command(op)));
  }
} finally {
  await fixture.stop();
}
