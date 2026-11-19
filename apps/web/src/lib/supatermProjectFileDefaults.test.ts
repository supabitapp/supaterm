import { EnvironmentId, type ProjectReadFileResult } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  connected: false,
  cached: null as unknown,
  queried: null as unknown,
  query: vi.fn<(...args: ReadonlyArray<unknown>) => void>(),
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: string) =>
      atom === "presentation"
        ? { connection: { phase: fixture.connected ? "connected" : "reconnecting" } }
        : fixture.cached,
  },
}));
vi.mock("~/state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("~/components/files/projectFilesQueryState", () => ({
  getProjectFileQueryAtom: () => "file",
  resolveProjectFileQueryData: (
    _environment: unknown,
    _cwd: unknown,
    _path: unknown,
    data: unknown,
  ) => data,
}));
vi.mock("@supaterm/client-runtime/state/runtime", () => ({
  executeAtomQuery: async (...args: ReadonlyArray<unknown>) => {
    fixture.query(...args);
    return fixture.queried;
  },
}));

import { readSupatermProjectFile } from "./supatermProjectFileDefaults";

const environmentId = EnvironmentId.make("offline-host");
const file: ProjectReadFileResult = {
  relativePath: "supaterm.json",
  contents: '{"defaultThreadEnvMode":"worktree"}',
  byteLength: 35,
  truncated: false,
};

beforeEach(() => {
  fixture.connected = false;
  fixture.cached = AsyncResult.initial();
  fixture.queried = AsyncResult.success(file);
  fixture.query.mockReset();
});

describe("new-thread project defaults", () => {
  it("opens offline without waiting for an uncached filesystem request", async () => {
    expect(await readSupatermProjectFile(environmentId, "/repo")).toBeNull();
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("uses cached project defaults while disconnected", async () => {
    fixture.cached = AsyncResult.success(file);
    expect(await readSupatermProjectFile(environmentId, "/repo")).toEqual({
      defaultThreadEnvMode: "worktree",
    });
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("reads project defaults through the query when connected", async () => {
    fixture.connected = true;
    expect(await readSupatermProjectFile(environmentId, "/repo")).toEqual({
      defaultThreadEnvMode: "worktree",
    });
    expect(fixture.query).toHaveBeenCalledOnce();
  });
});
