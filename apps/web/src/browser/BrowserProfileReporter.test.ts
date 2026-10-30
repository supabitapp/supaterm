import type { EnvironmentServerConfig } from "@supaterm/client-runtime/connection";
import {
  AuthPreviewOperateScope,
  AuthSessionState,
  ServerConfig,
  EnvironmentId,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  type ProfileReport,
  type ReportedProfiles,
  takeDueProfileReports,
  selectBrowserProfileReportTargets,
} from "./BrowserProfileReporter";

const first = EnvironmentId.make("environment-1");
const second = EnvironmentId.make("environment-2");
const config = (label: string) => ({ label }) as unknown as EnvironmentServerConfig;
const input = (recordingFrameRate: number) =>
  ({ profiles: [], defaultProfileId: "default", recordingFrameRate }) as unknown as ProfileReport;

describe("takeDueProfileReports", () => {
  it("reports each environment once per config and input", () => {
    const reported: ReportedProfiles = new Map();
    const configA = config("a");
    const configB = config("b");
    const settings = input(10);
    const targets = new Map([
      [first, configA],
      [second, configB],
    ]);

    expect(takeDueProfileReports(reported, targets, settings)).toEqual([first, second]);
    expect(takeDueProfileReports(reported, new Map(targets), settings)).toEqual([]);

    const restarted = config("a-restarted");
    expect(
      takeDueProfileReports(
        reported,
        new Map([
          [first, restarted],
          [second, configB],
        ]),
        settings,
      ),
    ).toEqual([first]);
  });

  it("reports every target again when the profile settings change", () => {
    const reported: ReportedProfiles = new Map();
    const targets = new Map([
      [first, config("a")],
      [second, config("b")],
    ]);
    takeDueProfileReports(reported, targets, input(10));

    expect(takeDueProfileReports(reported, targets, input(30))).toEqual([first, second]);
  });

  it("reports an environment again once it becomes operable again", () => {
    const reported: ReportedProfiles = new Map();
    const configA = config("a");
    const settings = input(10);
    takeDueProfileReports(reported, new Map([[first, configA]]), settings);

    expect(takeDueProfileReports(reported, new Map(), settings)).toEqual([]);
    expect(takeDueProfileReports(reported, new Map([[first, configA]]), settings)).toEqual([first]);
  });
});

it("reports to current servers with preview access and stops when that access is absent", () => {
  const auth = {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "supaterm_session",
  };
  const current = Schema.decodeUnknownSync(ServerConfig)({
    environment: {
      environmentId: first,
      label: "Current server",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "26.10.6",
      orchestrationProtocolVersion: 2,
      capabilities: {},
    },
    auth,
    cwd: "/workspace",
    keybindingsConfigPath: "/workspace/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {},
  });
  const configs = new Map([
    [first, current],
    [second, current],
  ]);
  const allowed = AsyncResult.success(
    Schema.decodeUnknownSync(AuthSessionState)({
      authenticated: true,
      auth,
      scopes: [AuthPreviewOperateScope],
    }),
  );
  const denied = AsyncResult.success(
    Schema.decodeUnknownSync(AuthSessionState)({ authenticated: true, auth, scopes: [] }),
  );
  expect(
    selectBrowserProfileReportTargets(configs, (id) => (id === first ? allowed : denied)),
  ).toEqual(new Map([[first, current]]));
  expect(selectBrowserProfileReportTargets(configs, () => AsyncResult.initial())).toEqual(
    new Map(),
  );
});
