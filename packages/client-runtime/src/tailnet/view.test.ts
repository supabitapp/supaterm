import type { TailnetRunning, TailnetSettings, TailnetStatus } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { tailnetAdmissionDescription, tailnetView } from "./view.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const SETTINGS: TailnetSettings = {
  enabled: true,
  hostname: "",
  admission: "owner",
  allowedLogins: [],
  controlUrl: "",
};

const RUNNING: TailnetRunning = {
  state: "running",
  dnsName: "supaterm-studio.tail1234.ts.net.",
  addresses: ["100.64.0.1"],
  owner: { type: "user", login: "ada@example.com", displayName: "Ada" },
  https: "ready",
  keyExpiry: null,
  health: [],
};

function view(status: TailnetStatus | null, settings: Partial<TailnetSettings> = {}) {
  return tailnetView({
    status,
    settings: { ...SETTINGS, ...settings },
    machineHostname: "Studio.local",
    now: NOW,
  });
}

function running(overrides: Partial<TailnetRunning> = {}) {
  const result = view({ ...RUNNING, ...overrides });
  if (result.kind !== "running") throw new Error(`expected running, got ${result.kind}`);
  return result;
}

const expiresIn = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + ms));

describe("tailnetView", () => {
  it("shows no account while off, even before the first status arrives", () => {
    expect(view(null, { enabled: false })).toMatchObject({
      kind: "off",
      hostname: "supaterm-studio",
      account: null,
    });
    expect(view({ state: "off" }, { enabled: false }).kind).toBe("off");
  });

  it("checks the status once turned on", () => {
    expect(view(null)).toMatchObject({
      kind: "loading",
      account: { title: "Checking Tailscale…", action: null },
    });
  });

  it("uses the saved machine name over the default", () => {
    expect(view({ state: "off" }, { enabled: false, hostname: "build-box" }).hostname).toBe(
      "build-box",
    );
  });

  it.each([
    ["binary-missing", "Built-in Tailscale isn't included in this build."],
    ["unsupported-platform", "Built-in Tailscale isn't supported on this system."],
  ] as const)("explains why it is unavailable: %s", (reason, summary) => {
    expect(view({ state: "unavailable", reason })).toMatchObject({
      kind: "unavailable",
      summary,
      account: null,
    });
  });

  it.each([
    [{ state: "starting" }, "starting", "Connecting…", null],
    [{ state: "off" }, "starting", "Connecting…", null],
    [{ state: "needs-login", loginReady: true }, "needs-login", "Not signed in", "sign-in"],
    [{ state: "needs-approval" }, "needs-approval", "Waiting for approval", "sign-out"],
  ] as const)("shows the account for %j", (status, kind, title, action) => {
    expect(view(status)).toMatchObject({ kind, account: { title, action } });
  });

  it("says why Tailscale stopped and that it retries", () => {
    expect(
      view({ state: "crashed", message: "The helper exited with code 1.", retryAt: NOW + 4000 }),
    ).toMatchObject({
      kind: "crashed",
      retryAt: NOW + 4000,
      account: { detail: "The helper exited with code 1. Retrying shortly.", action: null },
    });
  });

  it("shows who signed in and the HTTPS address when ready", () => {
    expect(running()).toMatchObject({
      dnsName: "supaterm-studio.tail1234.ts.net",
      address: "https://supaterm-studio.tail1234.ts.net",
      addressNote: null,
      ownerLogin: "ada@example.com",
      account: {
        title: "Signed in to Tailscale",
        detail: "Signed in as ada@example.com",
        action: "sign-out",
        warnings: [],
      },
    });
  });

  it("names the tags of a tagged node and has no owner login", () => {
    expect(running({ owner: { type: "tagged", tags: ["tag:server", "tag:ci"] } })).toMatchObject({
      ownerLogin: null,
      account: { detail: "Tagged tag:server, tag:ci" },
    });
  });

  it.each([
    ["provisioning", "https://supaterm-studio.tail1234.ts.net", "Getting an HTTPS certificate…"],
    ["unavailable", null, "HTTPS certificates are off for this tailnet."],
    ["failed", null, "Couldn't get an HTTPS certificate. rate limited"],
  ] as const)("describes HTTPS %s on the address", (https, address, addressNote) => {
    expect(running({ https, httpsError: "rate limited" })).toMatchObject({ address, addressNote });
  });

  it.each([
    [15 * DAY, []],
    [
      14 * DAY,
      [
        "Sign-in expires in 14 days. Sign in again, or turn off key expiry for this machine in Tailscale.",
      ],
    ],
    [
      12 * 60 * 60 * 1000,
      [
        "Sign-in expires within a day. Sign in again, or turn off key expiry for this machine in Tailscale.",
      ],
    ],
    [-1, ["Sign-in expired. Sign in again."]],
  ])("warns about key expiry %d ms ahead", (ms, warnings) => {
    expect(running({ keyExpiry: expiresIn(ms) }).account.warnings).toEqual(warnings);
  });

  it("ignores an unreadable key expiry and lists health warnings", () => {
    expect(
      running({ keyExpiry: "not a date", health: ["Can't reach the control server"] }).account
        .warnings,
    ).toEqual(["Can't reach the control server"]);
  });
});

describe("tailnetAdmissionDescription", () => {
  it.each([
    ["owner", "ada@example.com", "Only devices signed in as ada@example.com can connect."],
    ["owner", null, "Only devices signed in to this machine's Tailscale account can connect."],
    ["tailnet", "ada@example.com", "Any device your tailnet's access rules allow can connect."],
  ] as const)("describes %s admission", (admission, ownerLogin, description) => {
    expect(tailnetAdmissionDescription(admission, ownerLogin)).toBe(description);
  });
});
