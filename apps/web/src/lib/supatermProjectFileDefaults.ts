import {
  SUPATERM_PROJECT_FILE_NAME,
  type EnvironmentId,
  type SupatermProjectFile,
} from "@supaterm/contracts";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";
import { executeAtomQuery } from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentPresentations } from "~/state/presentation";

/**
 * Read and decode the project's checked-in `supaterm.json`.
 *
 * Imperative counterpart to `useSupatermProjectFileState` for the new-thread path,
 * which resolves defaults at call time rather than render time. The file
 * query atom caches per (environment, cwd), so repeat calls don't re-fetch.
 * Optimistic in-app writes overlay the query result, matching what
 * `useProjectFileQuery` renders. Missing, truncated, or invalid files
 * resolve to null.
 */
export async function readSupatermProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<SupatermProjectFile | null> {
  const query = getProjectFileQueryAtom(environmentId, workspaceRoot, SUPATERM_PROJECT_FILE_NAME);
  const connected =
    appAtomRegistry.get(environmentPresentations.presentationAtom(environmentId))?.connection
      .phase === "connected";
  // Opening a new offline thread must not wait on a filesystem RPC. Reuse any
  // cached project defaults; otherwise the normal project/server defaults apply.
  const result = connected
    ? await executeAtomQuery(appAtomRegistry, query, { reportDefect: false, reportFailure: false })
    : appAtomRegistry.get(query);
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    SUPATERM_PROJECT_FILE_NAME,
    Option.getOrNull(AsyncResult.value(result)),
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseSupatermProjectFile(data.contents);
}
