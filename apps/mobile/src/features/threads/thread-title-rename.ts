export type ThreadTitleRenameResolution =
  | { readonly action: "rename"; readonly title: string }
  | { readonly action: "noop" }
  | { readonly action: "reject-empty" };

export function resolveThreadTitleRename(input: {
  readonly title: string;
  readonly originalTitle: string;
}) {
  const title = input.title.trim();
  if (title.length === 0) return { action: "reject-empty" } satisfies ThreadTitleRenameResolution;
  if (title === input.originalTitle)
    return { action: "noop" } satisfies ThreadTitleRenameResolution;
  return { action: "rename", title } satisfies ThreadTitleRenameResolution;
}
