// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { gradeSample } from "./grade.ts";
import { McpToolUseCase, type SampleRun } from "./types.ts";

export const failed = (expect: Parameters<typeof gradeSample>[0], run: SampleRun) =>
  gradeSample(expect, run)
    .filter((check) => !check.pass)
    .map((check) => check.check);

const decodeDeviceCase = Schema.decodeSync(Schema.fromJsonString(McpToolUseCase));

export const deviceCases = () =>
  NodeFS.readFileSync(new URL("./cases/device-manager.ndjson", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => decodeDeviceCase(line));

export const fleetTrace = (id: string): SampleRun => {
  const c = deviceCases().find((c) => c.id === id)!;
  const target = c.expect.device?.capture ?? {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const launcher = "/home/user/.supaterm/userdata/device/targets/supaterm-acme/agent-device";
  const reports: Record<string, string> = {
    "DISC-01": "build-mac discovery failed. Used spare-mac. /tmp/proof/discovery-settings.png",
    "SESS-01": "Acme Settings: /tmp/proof/app-settings.png",
    "ACC-01": "Agent device access is off. Enable Agent device access in Settings > Integrations.",
    "CAP-01": "Empty image; could not visually verify Acme Settings.",
    "OWN-01": "Used Acme Spare iPhone on spare-mac. /tmp/proof/free-device-settings.png",
  };
  const calls: Array<SampleRun["calls"][number]> = [
    { step: 0, tool: "device_list", input: {}, failed: false, output: "{}" },
    {
      step: 1,
      tool: "device_open",
      input: target,
      failed: id === "ACC-01",
      output:
        id === "ACC-01"
          ? "Agent device access is turned off for this environment."
          : JSON.stringify({ device: { hostId: target.hostId, id: target.deviceId } }),
    },
  ];
  if (id !== "ACC-01") {
    if (id === "SESS-01")
      calls.push({
        step: 2,
        tool: "Bash",
        input: { command: `${launcher} open com.acme.app` },
        failed: false,
      });
    calls.push({
      step: 3,
      tool: "device_screenshot",
      input: target,
      failed: false,
      output: JSON.stringify({
        device: { hostId: target.hostId, id: target.deviceId },
        screenshot: {
          mimeType: "image/png",
          width: id === "CAP-01" ? 0 : 1206,
          height: id === "CAP-01" ? 0 : 2622,
        },
      }),
    });
  }
  const finalText = reports[id]!;
  return { calls, launchers: [launcher], text: finalText, finalText, stopReason: "end_turn" };
};
