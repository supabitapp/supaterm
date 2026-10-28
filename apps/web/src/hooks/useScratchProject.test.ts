import type { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickScratchEnvironmentId } from "./useScratchProject";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;
const other = "other" as EnvironmentId;

function pick(
  primary: EnvironmentId | null,
  fallback: EnvironmentId | null,
  localRoot: string | null,
  remoteRoot: string | null = "/remote/scratch",
) {
  const roots = new Map([
    [local, localRoot],
    [remote, remoteRoot],
    [other, "/other/scratch"],
  ]);
  return pickScratchEnvironmentId({
    primary,
    fallback,
    environmentIds: [...roots.keys()],
    scratchWorkspaceRootFor: (id) => roots.get(id) ?? null,
  });
}

describe("pickScratchEnvironmentId", () => {
  it("prefers the primary environment over the one on screen", () => {
    expect(pick(local, remote, "/local/scratch")).toBe(local);
    expect(pick(local, null, "/local/scratch")).toBe(local);
  });

  it("falls back when the primary environment offers no scratch root", () => {
    expect(pick(local, remote, null)).toBe(remote);
    expect(pick(null, remote, null)).toBe(remote);
    expect(pick(null, remote, null, null)).toBe(other);
    expect(pick(local, null, null)).toBeNull();
  });
});
