import {
  SUPATERM_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectReadFileResult,
  type SupatermProjectFile,
} from "@supaterm/contracts";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";
import { executeAtomQuery } from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentPresentations } from "~/state/presentation";

function toSupatermProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  result: ProjectReadFileResult | null,
): SupatermProjectFile | null {
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    SUPATERM_PROJECT_FILE_NAME,
    result,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseSupatermProjectFile(data.contents);
}

/**
 * Imperative counterpart to `useSupatermProjectFileState`, with optimistic writes overlaid as
 * `useProjectFileQuery` renders them. Missing, truncated, or invalid files resolve to null. Without
 * a `signal` an offline machine's file comes from cache at once; with one the read waits for the
 * machine until the signal aborts.
 */
export async function readSupatermProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<SupatermProjectFile | null> {
  const query = getProjectFileQueryAtom(environmentId, workspaceRoot, SUPATERM_PROJECT_FILE_NAME);
  const connected =
    appAtomRegistry.get(environmentPresentations.presentationAtom(environmentId))?.connection
      .phase === "connected";
  // Opening a new offline thread must not wait on a filesystem RPC. Reuse any
  // cached project defaults; otherwise the normal project/server defaults apply.
  const result =
    connected || signal !== undefined
      ? await executeAtomQuery(appAtomRegistry, query, {
          reportDefect: false,
          reportFailure: false,
          signal,
        })
      : appAtomRegistry.get(query);
  return toSupatermProjectFile(
    environmentId,
    workspaceRoot,
    AsyncResult.getOrElse(result, () => null),
  );
}

/** The project's supaterm.json from an earlier read, or `undefined` when none has loaded yet. */
export function peekSupatermProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): SupatermProjectFile | null | undefined {
  const result = appAtomRegistry.get(
    getProjectFileQueryAtom(environmentId, workspaceRoot, SUPATERM_PROJECT_FILE_NAME),
  );
  return AsyncResult.isSuccess(result)
    ? toSupatermProjectFile(environmentId, workspaceRoot, result.value)
    : undefined;
}
