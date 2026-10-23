import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor, ORCHESTRATION_PROTOCOL_VERSION } from "./environment.ts";
import {
  OtlpEndpointCheckInput,
  resolveEnvironmentMachineKind,
  ServerConfig,
  ServerConfigStreamEvent,
  ServerConfigStreamSettingsUpdatedEvent,
  ServerConfigUpdatedPayload,
  ServerObservability,
  ServerProvider,
  ServerProviders,
} from "./server.ts";
import { ServerSettings } from "./settings.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeServerConfigSettings = Schema.decodeUnknownSync(ServerConfig.fields.settings);
const decodeConfigUpdate = Schema.decodeUnknownSync(ServerConfigUpdatedPayload);
const decodeSettingsUpdate = Schema.decodeUnknownSync(ServerConfigStreamSettingsUpdatedEvent);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("preserves installed-version presence through the provider wire codec", () => {
    const encode = Schema.encodeSync(ServerProvider);
    for (const installation of [{}, { installedVersion: null }, { installedVersion: "1.2.3" }]) {
      const decoded = decodeServerProvider({ ...baseProviderSnapshot, ...installation });
      const wire = JSON.parse(JSON.stringify(encode(decoded)));
      expect(wire).toMatchObject({ version: "1.0.0", ...installation });
      expect(Object.hasOwn(wire, "installedVersion")).toBe(
        Object.hasOwn(installation, "installedVersion"),
      );
      expect(decodeServerProvider(wire)).toEqual(decoded);
    }
  });
});

describe("server config forward compatibility", () => {
  it.each([undefined, true, false])(
    "preserves older servers' question dismissal state: %s",
    (autoDismissQuestions) => {
      const settings = autoDismissQuestions === undefined ? {} : { autoDismissQuestions };
      const snapshotSettings = decodeServerConfigSettings(settings);
      const configUpdate = decodeConfigUpdate({
        issues: [],
        providers: [],
        settings,
      });
      const settingsUpdate = decodeSettingsUpdate({
        version: 1,
        type: "settingsUpdated",
        payload: { settings },
      });

      expect(snapshotSettings.autoDismissQuestions).toBe(autoDismissQuestions);
      expect(configUpdate.settings?.autoDismissQuestions).toBe(autoDismissQuestions);
      expect(settingsUpdate.payload.settings.autoDismissQuestions).toBe(autoDismissQuestions);
    },
  );

  it("decodes config event types from a newer server as skippable events", () => {
    const codec = Schema.toCodecJson(ServerConfigStreamEvent);
    const decodeEvent = Schema.decodeUnknownSync(codec);
    const keybindingsUpdated = {
      version: 1,
      type: "keybindingsUpdated",
      payload: { keybindings: [], issues: [] },
    };

    expect(
      decodeEvent({ version: 1, type: "workspaceIndexUpdated", payload: { files: 12 } }),
    ).toEqual({ type: "unknown-event", eventType: "workspaceIndexUpdated" });
    expect(decodeEvent({ version: 1, type: "usageLimitSourcesUpdated", payload: {} })).toEqual({
      type: "unknown-event",
      eventType: "usageLimitSourcesUpdated",
    });
    expect(() => decodeEvent({ version: 1, type: "settingsUpdated", payload: {} })).toThrow();
    expect(Schema.encodeUnknownSync(codec)(decodeEvent(keybindingsUpdated))).toEqual(
      keybindingsUpdated,
    );
    expect(() =>
      Schema.encodeUnknownSync(codec)({
        type: "unknown-event",
        eventType: "workspaceIndexUpdated",
      }),
    ).toThrow();
  });

  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });

  it("drops usage windows this build cannot decode instead of failing the provider", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      usageLimits: {
        checkedAt: "2026-04-10T00:00:00.000Z",
        windows: [
          { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
          { id: "future", kind: "some-future-kind", label: "Future", usedPercent: 1 },
          { id: "bad", kind: "weekly", label: "Weekly", usedPercent: 120 },
        ],
      },
    });

    expect(parsed.usageLimits?.windows).toEqual([
      { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
    ]);
  });
});

describe("ServerObservability", () => {
  const decodeServerObservability = Schema.decodeUnknownSync(ServerObservability);

  it("rejects an unknown endpoint source", () => {
    expect(() =>
      decodeServerObservability({
        logsDirectoryPath: "/tmp/supaterm/logs",
        localTracingEnabled: true,
        otlpTracesUrl: "https://collector.example.com/v1/traces",
        otlpTracesSource: "cli",
        otlpTracesEnabled: true,
        otlpMetricsEnabled: false,
      }),
    ).toThrow();
  });
});

describe("resolveEnvironmentMachineKind", () => {
  const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
  const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
  const descriptor = (platform: Record<string, unknown>) =>
    decodeDescriptor({
      environmentId: "env-1",
      label: "Box",
      platform: { os: "linux", arch: "x64", ...platform },
      serverVersion: "1.0.0",
      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      capabilities: {},
    });

  it("prefers the user's pick over what the server detected", () => {
    expect(
      resolveEnvironmentMachineKind({
        environment: descriptor({ machine: "mac-mini" }),
        settings: decodeSettings({ environmentIcon: "laptop" }),
      }),
    ).toBe("laptop");
  });

  it("drops a machine kind this build does not know instead of failing the descriptor", () => {
    const parsed = descriptor({ machine: "toaster" });

    expect(parsed.platform.machine).toBeUndefined();
    expect(
      resolveEnvironmentMachineKind({ environment: parsed, settings: decodeSettings({}) }),
    ).toBe("server");
  });
});

describe("OtlpEndpointCheckInput", () => {
  const decode = Schema.decodeUnknownSync(OtlpEndpointCheckInput);

  it("accepts HTTP receivers only", () => {
    expect(decode({ signal: "traces", url: "https://collector.example.com/v1/traces" }).url).toBe(
      "https://collector.example.com/v1/traces",
    );
    for (const url of ["data:text/plain,ok", "file:///etc/hosts", "collector:4318/v1/traces"]) {
      expect(() => decode({ signal: "traces", url })).toThrow();
    }
  });
});
