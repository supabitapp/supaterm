import { EnvironmentId, type ProjectReadFileResult } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ connected: false, read: vi.fn(), query: vi.fn() }));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: string) =>
      atom === "presentation"
        ? { connection: { phase: fixture.connected ? "connected" : "reconnecting" } }
        : fixture.read(),
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
vi.mock("@supaterm/client-runtime/state/runtime", () => ({ executeAtomQuery: fixture.query }));

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
  fixture.read.mockReset().mockReturnValue(AsyncResult.initial());
  fixture.query.mockReset().mockResolvedValue(AsyncResult.success(file));
});

describe("new-thread project defaults", () => {
  it("opens offline without waiting for an uncached filesystem request", async () => {
    expect(await readSupatermProjectFile(environmentId, "/repo")).toBeNull();
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("uses cached project defaults while disconnected", async () => {
    fixture.read.mockReturnValue(AsyncResult.success(file));
    expect(await readSupatermProjectFile(environmentId, "/repo")).toEqual({
      defaultThreadEnvMode: "worktree",
    });
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it.each([
    { name: "when connected", connected: true, signal: undefined },
    {
      name: "before the machine connects when the caller bounds the wait",
      connected: false,
      signal: new AbortController().signal,
    },
  ])("reads project defaults through the query $name", async ({ connected, signal }) => {
    fixture.connected = connected;
    expect(await readSupatermProjectFile(environmentId, "/repo", signal)).toEqual({
      defaultThreadEnvMode: "worktree",
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.anything(),
      "file",
      expect.objectContaining({ signal }),
    );
  });
});
