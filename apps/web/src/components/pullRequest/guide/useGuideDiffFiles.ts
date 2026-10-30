import type { FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, PullRequestRef } from "@supaterm/contracts";
import { useState } from "react";

import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { pullRequestReviewKey } from "../pullRequestReviewStore";

interface LoadedDiff {
  readonly key: string;
  readonly cursor: string | null;
  readonly done: boolean;
  readonly files: ReadonlyMap<string, FileDiffMetadata>;
}

const NO_FILES: ReadonlyMap<string, FileDiffMetadata> = new Map();

export function useGuideDiffFiles({
  environmentId,
  reference,
  headSha,
  wantedPaths,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  headSha: string;
  wantedPaths: ReadonlyArray<string>;
}) {
  const key = `${environmentId}:${pullRequestReviewKey(reference)}:${headSha}`;
  const [loaded, setLoaded] = useState<LoadedDiff>({
    key,
    cursor: null,
    done: false,
    files: NO_FILES,
  });
  const current: LoadedDiff =
    loaded.key === key ? loaded : { key, cursor: null, done: false, files: NO_FILES };
  const missing = wantedPaths.some((path) => !current.files.has(path));
  const loading = missing && !current.done;
  const query = useEnvironmentQuery(
    loading
      ? pullRequestEnvironment.diff({
          environmentId,
          input: { ...reference, ...(current.cursor === null ? {} : { cursor: current.cursor }) },
        })
      : null,
  );

  // Each page is absorbed once: the next render asks for the following cursor, whose query has
  // its own result.
  const data = query.data;
  if (
    data !== null &&
    loading &&
    (data.nextCursor === null || data.nextCursor !== current.cursor)
  ) {
    const parsed = getRenderablePatch(
      data.patch,
      `pull-request-guide:${key}:${current.cursor ?? "first"}`,
    );
    const files = new Map(current.files);
    if (parsed?.kind === "files") {
      for (const file of parsed.files) files.set(resolveFileDiffPath(file), file);
    }
    setLoaded({ key, cursor: data.nextCursor, done: data.nextCursor === null, files });
  }

  return {
    files: current.files,
    loading: loading && query.error === null,
    error: loading ? query.error : null,
    retry: query.refresh,
  };
}
