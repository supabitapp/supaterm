import {
  SUPATERM_PROJECT_FILE_NAME,
  type EnvironmentId,
  type SupatermProjectFile,
  type SupatermProjectFileScript,
} from "@supaterm/contracts";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<SupatermProjectFileScript> = [];

export interface SupatermProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: SupatermProjectFile | null;
  scripts: ReadonlyArray<SupatermProjectFileScript>;
}

export function useSupatermProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): SupatermProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    SUPATERM_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseSupatermProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useSupatermProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<SupatermProjectFileScript> {
  return useSupatermProjectFileState(environmentId, cwd).scripts;
}
