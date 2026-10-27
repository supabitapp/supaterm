import type { PullRequestInvolvement, PullRequestListState } from "@supaterm/contracts";
import {
  ClockIcon,
  ExpandIcon,
  EyeIcon,
  LayersIcon,
  ListChecksIcon,
  PenLineIcon,
  ShrinkIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  UserLockIcon,
} from "@supaterm/icons";

import type { PullRequestFilterOption } from "./PullRequestListFilters";
import type { PullRequestListSort } from "./pullRequestListPreferences";
import { PullRequestGlyph } from "./pullRequestIcons";

export const INVOLVEMENT_TABS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "reviewing", label: "Reviewing", Icon: EyeIcon },
  { value: "authored", label: "Authored", Icon: PenLineIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;

export const STATE_TABS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "open", label: "Open", Icon: PullRequestGlyph.pullRequest },
  { value: "closed", label: "Closed", Icon: PullRequestGlyph.closed },
  { value: "merged", label: "Merged", Icon: PullRequestGlyph.merged },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;

export const SORT_OPTIONS = [
  { value: "ready", label: "Merge readiness", Icon: ListChecksIcon },
  { value: "blocked", label: "Blocked on me", Icon: UserLockIcon },
  { value: "updated", label: "Recently updated", Icon: ClockIcon },
  { value: "newest", label: "Newest shown", Icon: SortDescendingIcon },
  { value: "oldest", label: "Oldest shown", Icon: SortAscendingIcon },
  { value: "largest", label: "Largest shown", Icon: ExpandIcon },
  { value: "smallest", label: "Smallest shown", Icon: ShrinkIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<PullRequestListSort>>;
