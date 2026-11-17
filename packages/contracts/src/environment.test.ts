import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor, ORCHESTRATION_PROTOCOL_VERSION } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
  capabilities: {},
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("decodes old, recognized and future manual installation descriptors", () => {
    expect(decodeDescriptor(descriptor).capabilities.serverInstallation).toBeUndefined();
    for (const installation of [
      { kind: "npx" },
      { kind: "npm-global", prefix: "/opt/node" },
      { kind: "supaterm-launcher", launcher: "/opt/bin/supaterm", baseDir: "/data/supaterm" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toEqual(installation);
    }
    const spaced = {
      kind: "supaterm-launcher",
      launcher: "/opt/bin/supaterm ",
      baseDir: " /data/supaterm ",
    };
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, serverInstallation: spaced },
      }).capabilities.serverInstallation,
    ).toEqual(spaced);
    for (const installation of [
      { kind: "future-manager" },
      { kind: "npm-global" },
      { kind: "supaterm-launcher", launcher: "supaterm" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toBeUndefined();
    }
  });

  it("reads platforms and update paths from a newer server instead of failing", () => {
    const parsed = decodeDescriptor({
      ...descriptor,
      platform: { os: "freebsd", arch: "riscv64" },
      capabilities: { serverSelfUpdate: "package-manager" },
    });

    expect(parsed.platform).toEqual({ os: "unknown", arch: "other" });
    expect(parsed.capabilities.serverSelfUpdate).toBeUndefined();
    expect(
      decodeDescriptor({ ...descriptor, capabilities: { serverSelfUpdate: "desktop-managed" } })
        .capabilities.serverSelfUpdate,
    ).toBe("desktop-managed");
  });
});
