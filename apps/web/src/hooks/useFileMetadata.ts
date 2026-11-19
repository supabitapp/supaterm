import {
  AuthFilesystemReadScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import {
  parseFileUrlHref,
  resolvePathLinkTarget,
  splitFilePathPosition,
} from "@supaterm/shared/fileLinks";
import {
  isAbsolutePath,
  isNetworkPath,
  normalizeProjectPathForComparison,
} from "@supaterm/shared/path";
import { safeDecodeURIComponent } from "@supaterm/shared/markdownLinks";
import { useContext } from "react";

import { useEnvironmentScope } from "../state/session";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { FileMetadataThreadContext } from "./FileMetadataThreadProvider";

export function getFileMetadataQueryAtom(
  environmentId: EnvironmentId,
  path: string,
  cwd?: string,
  threadRef?: ScopedThreadRef | null,
) {
  const uri = /^file:\/\//iu.test(path) ? parseFileUrlHref(path) : null;
  const hostPath = splitFilePathPosition(path).path;
  const targetPath = normalizeProjectPathForComparison(
    uri
      ? safeDecodeURIComponent(uri.path)
      : hostPath.startsWith("~/") || !cwd
        ? hostPath
        : resolvePathLinkTarget(hostPath, cwd),
  );
  const absolute = isAbsolutePath(targetPath) || targetPath.startsWith("~/");
  return absolute && !isNetworkPath(targetPath) && targetPath.length <= 512
    ? projectEnvironment.fileMetadata({
        environmentId,
        input: {
          path: targetPath,
          ...(threadRef?.environmentId === environmentId ? { threadId: threadRef.threadId } : {}),
        },
      })
    : null;
}

export function useFileMetadata(
  environmentId: EnvironmentId | null | undefined,
  path: string,
  cwd?: string,
) {
  const canRead = useEnvironmentScope(environmentId ?? null, AuthFilesystemReadScope);
  const threadRef = useContext(FileMetadataThreadContext);
  return useEnvironmentQuery(
    environmentId && canRead ? getFileMetadataQueryAtom(environmentId, path, cwd, threadRef) : null,
  ).data;
}
