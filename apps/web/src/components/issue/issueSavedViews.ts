import * as Schema from "effect/Schema";
import { SavedViewIdentity } from "@supaterm/client-runtime/saved-views";

import type { SavedView, SavedViewsKind } from "../SavedViewsMenu";
import {
  issueListPreferences,
  IssueListPreferencesSchema,
  type IssueListPreferences,
} from "./issueListPreferences";
import { msg } from "gt-react";

export function issueViewMatches(
  view: SavedView<typeof IssueListPreferencesSchema.Type>,
  preferences: IssueListPreferences,
): boolean {
  const key = (value: IssueListPreferences) => {
    const normalized = issueListPreferences(value);
    return JSON.stringify({
      ...normalized,
      label: normalized.label?.toSorted(),
      hideProjects: normalized.hideProjects?.map((pair) => JSON.stringify(pair)).toSorted(),
    });
  };
  return key(issueListPreferences(view.preferences)) === key(preferences);
}

export const ISSUE_SAVED_VIEWS = {
  storageKey: "supaterm.issues.savedViews",
  schema: Schema.Array(
    Schema.Struct({ ...SavedViewIdentity.fields, preferences: IssueListPreferencesSchema }),
  ),
  empty: [],
  noun: "issue",
  shortNoun: "issue",
  placeholder: msg("Issues Assigned to Me"),
  suggestedName: (preferences) => (preferences.who === "assigned" ? "Issues Assigned to Me" : ""),
  normalize: issueListPreferences,
  matches: issueViewMatches,
} as const satisfies SavedViewsKind<
  IssueListPreferences,
  typeof IssueListPreferencesSchema.Type,
  unknown
>;
