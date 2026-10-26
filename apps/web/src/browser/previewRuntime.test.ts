import { EnvironmentId } from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  desktop: false,
  primary: null as string | null,
  serverBrowser: new Set<string>(),
  relay: new Set<string>(),
}));

vi.mock("~/state/session", () => ({
  readPreparedConnection: (id: string) => ({
    connectionMethod: state.relay.has(id) ? "relay" : "direct",
  }),
}));

vi.mock("~/env", () => ({
  get isElectron() {
    return state.desktop;
  },
}));
vi.mock("~/previewStateStore", () => ({ isPreviewSupportedInRuntime: () => state.desktop }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => state.primary } }));
vi.mock("~/state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: {} }));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: (id: string) => state.serverBrowser.has(id),
  useEnvironmentSupportsServerBrowser: () => false,
}));

import {
  alternatePreviewRuntime,
  previewRuntimeFor,
  rendersServerTabNatively,
} from "./previewRuntime";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

afterEach(() => {
  state.desktop = false;
  state.primary = null;
  state.serverBrowser = new Set();
  state.relay = new Set();
});

describe("previewRuntimeFor", () => {
  it("keeps relay-host previews on the host browser in the desktop app", () => {
    state.desktop = true;
    state.primary = local;
    state.serverBrowser = new Set([remote]);
    state.relay = new Set([remote]);
    expect(previewRuntimeFor(remote)).toBe("server");
    expect(alternatePreviewRuntime(remote, local, true, { runtime: "server" })).toBeNull();
    expect(alternatePreviewRuntime(remote, local, true, {})).toBeNull();
  });
});

const primary = EnvironmentId.make("primary-environment");

describe("rendersServerTabNatively", () => {
  beforeEach(() => {
    state.desktop = true;
  });
  it("streams a headless-backed server tab even in the primary desktop environment", () => {
    expect(
      rendersServerTabNatively(primary, primary, {
        runtime: "server",
        browserBacking: "headless",
      }),
    ).toBe(false);
  });

  it("keeps native rendering for an attached primary-environment server tab", () => {
    expect(
      rendersServerTabNatively(primary, primary, {
        runtime: "server",
        browserBacking: "desktop",
      }),
    ).toBe(true);
  });

  it("preserves legacy native behavior when the backing is absent", () => {
    expect(rendersServerTabNatively(primary, primary, { runtime: "server" })).toBe(true);
  });
});
