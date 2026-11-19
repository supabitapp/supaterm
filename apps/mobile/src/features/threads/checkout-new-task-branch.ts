import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { VcsRef } from "@supaterm/client-runtime/state/vcs";
import {
  type AtomCommandResult,
  mapAtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import type {
  VcsListRefsInput,
  VcsListRefsResult,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
} from "@supaterm/contracts";
import { deriveLocalBranchNameFromRemoteRef } from "@supaterm/shared/git";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

const VCS_REF_QUERY_MAX_LENGTH = 256;

export async function checkoutNewTaskBranch<E>(input: {
  readonly branch: VcsRef;
  readonly project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot"> | null;
  readonly workspaceMode: "local" | "worktree";
  readonly readRefs: (request: {
    readonly environmentId: EnvironmentProject["environmentId"];
    readonly input: VcsListRefsInput;
  }) => Promise<AtomCommandResult<VcsListRefsResult, E>>;
  readonly switchRef: (request: {
    readonly environmentId: EnvironmentProject["environmentId"];
    readonly input: VcsSwitchRefInput;
  }) => Promise<AtomCommandResult<VcsSwitchRefResult, E>>;
}) {
  if (!input.project) {
    return AsyncResult.failure(
      Cause.fail(new Error("The selected project is unavailable. Reconnect and try again.")),
    ) satisfies AtomCommandResult<VcsRef, E | Error>;
  }
  if (input.workspaceMode === "worktree")
    return AsyncResult.success(input.branch) satisfies AtomCommandResult<VcsRef, E | Error>;

  const localName = localBranchName(input.branch);
  let cursor: number | undefined;
  for (;;) {
    const refs = await input.readRefs({
      environmentId: input.project.environmentId,
      input: {
        cwd: input.project.workspaceRoot,
        query: localName.slice(0, VCS_REF_QUERY_MAX_LENGTH),
        refKind: "local",
        ...(cursor === undefined ? { refresh: true } : { cursor }),
      },
    });
    if (refs._tag === "Failure")
      return AsyncResult.failure(refs.cause) satisfies AtomCommandResult<VcsRef, E | Error>;
    const local = refs.value.refs.find((ref) => ref.name === localName);
    if (
      local &&
      (!input.branch.isRemote || local.upstreamRef === `refs/remotes/${input.branch.name}`) &&
      (local.current || local.worktreePath)
    ) {
      if (local.current)
        return AsyncResult.success({ ...local, worktreePath: null }) satisfies AtomCommandResult<
          VcsRef,
          E | Error
        >;
      if (refs.value.isAtRepositoryRoot === undefined) {
        return AsyncResult.failure(
          Cause.fail(
            new Error(
              "The server did not report whether this project is at the repository root, so this worktree cannot be reused safely. Update the server or choose another branch.",
            ),
          ),
        ) satisfies AtomCommandResult<VcsRef, E | Error>;
      }
      if (!refs.value.isAtRepositoryRoot) {
        return AsyncResult.failure(
          Cause.fail(
            new Error(
              "This project is a repository subdirectory. Choose another branch or add the repository root as a project to reuse this worktree.",
            ),
          ),
        ) satisfies AtomCommandResult<VcsRef, E | Error>;
      }
      return AsyncResult.success(local) satisfies AtomCommandResult<VcsRef, E | Error>;
    }
    if (local || refs.value.nextCursor === null) break;
    cursor = refs.value.nextCursor;
  }

  const result = await input.switchRef({
    environmentId: input.project.environmentId,
    input: { cwd: input.project.workspaceRoot, refName: input.branch.name },
  });
  return mapAtomCommandResult(result, (value) => ({
    ...input.branch,
    current: true,
    isRemote: false,
    name: value.refName ?? input.branch.name,
    worktreePath: null,
  })) satisfies AtomCommandResult<VcsRef, E | Error>;
}

function localBranchName(branch: VcsRef) {
  if (!branch.isRemote) return branch.name;
  const prefix = branch.remoteName ? `${branch.remoteName}/` : null;
  return prefix && branch.name.startsWith(prefix)
    ? branch.name.slice(prefix.length)
    : deriveLocalBranchNameFromRemoteRef(branch.name);
}
