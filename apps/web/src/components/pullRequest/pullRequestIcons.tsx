import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LayersIcon,
  LinkHorizontalIcon,
  TriangleAlertIcon,
  UnlinkIcon,
} from "@supaterm/icons";
import type { PullRequestState } from "@supaterm/contracts";

export const PullRequestGlyph = {
  pullRequest: GitPullRequestIcon,
  reopen: GitPullRequestIcon,
  draft: GitPullRequestDraftIcon,
  closed: GitPullRequestClosedIcon,
  merged: GitMergeIcon,
  conflicting: TriangleAlertIcon,
  stack: LayersIcon,
  link: LinkHorizontalIcon,
  unlink: UnlinkIcon,
} as const;

export type PullRequestGlyphIcon = (typeof PullRequestGlyph)[keyof typeof PullRequestGlyph];

export interface PullRequestStatePresentation {
  readonly label: string;
  readonly toneClassName: string;
  readonly Icon: PullRequestGlyphIcon;
}

export const PULL_REQUEST_STATE_PRESENTATION = {
  open: {
    label: "Open",
    toneClassName: "text-emerald-600 dark:text-emerald-300/90",
    Icon: PullRequestGlyph.pullRequest,
  },
  draft: {
    label: "Draft",
    toneClassName: "text-zinc-500 dark:text-zinc-400/80",
    Icon: PullRequestGlyph.draft,
  },
  closed: {
    label: "Closed",
    toneClassName: "text-red-600 dark:text-red-300/90",
    Icon: PullRequestGlyph.closed,
  },
  merged: {
    label: "Merged",
    toneClassName: "text-violet-600 dark:text-violet-300/90",
    Icon: PullRequestGlyph.merged,
  },
} as const satisfies Record<PullRequestState | "draft", PullRequestStatePresentation>;
