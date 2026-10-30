import type { PullRequestFilesViewedResult } from "@supaterm/contracts";

export type FilesViewedRead = PullRequestFilesViewedResult | null;

export interface ViewedPress {
  readonly viewed: boolean;
  readonly version: number;

  readonly awaitingReadAfter: { readonly read: FilesViewedRead } | undefined;
}

export interface ViewedState {
  readonly key: string;
  readonly presses: Readonly<Record<string, ViewedPress>>;
  readonly error: string | null;
}

export function viewedOverlay(
  presses: Readonly<Record<string, ViewedPress>>,
  read: FilesViewedRead,
): Record<string, boolean> {
  const overlay: Record<string, boolean> = {};
  for (const [path, press] of Object.entries(presses))
    if (press.awaitingReadAfter === undefined || press.awaitingReadAfter.read === read)
      overlay[path] = press.viewed;
  return overlay;
}
