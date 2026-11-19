import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import {
  excerptExpansionOldContents,
  type DiffRow,
} from "@supaterm/client-runtime/review-guide-tour";
import type { PullRequestReviewGuideExcerpt } from "@supaterm/contracts";

export function excerptLoader(
  excerpt: PullRequestReviewGuideExcerpt,
  file: FileDiffMetadata,
  sliceRows: ReadonlyArray<DiffRow>,
  loadDiffFiles: FileDiffContentsLoader,
): FileDiffContentsLoader | null;
export function excerptLoader(
  excerpt: PullRequestReviewGuideExcerpt,
  file: FileDiffMetadata,
  sliceRows: ReadonlyArray<DiffRow>,
  loadDiffFiles: FileDiffContentsLoader,
) {
  if (
    file.type === "new" ||
    file.type === "deleted" ||
    sliceRows.some((row) => row.hunk !== sliceRows[0]?.hunk)
  ) {
    return null satisfies FileDiffContentsLoader | null;
  }
  return (async () => {
    const loaded = await loadDiffFiles(file);
    const oldContents = excerptExpansionOldContents(loaded.newFile.contents, sliceRows);
    if (oldContents === null) return loaded;
    return {
      newFile: loaded.newFile,
      oldFile: {
        name: loaded.oldFile?.name ?? loaded.newFile.name,
        contents: oldContents,
        cacheKey: `${loaded.newFile.cacheKey ?? loaded.newFile.name}:excerpt:${excerpt.side}:${excerpt.start}-${excerpt.end}`,
      },
    };
  }) satisfies FileDiffContentsLoader | null;
}
