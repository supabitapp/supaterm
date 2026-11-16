export const WORK_GROUP_OPEN_MS = 200;
export const WORK_GROUP_CLOSE_MS = 150;

/**
 * An expanded tool group's rows: sliding open, at rest, or sliding shut before
 * they leave the list. A collapsed group has no disclosure.
 */
export type WorkGroupDisclosure = "opening" | "open" | "closing";
export type WorkGroupTransition = Exclude<WorkGroupDisclosure, "open">;
export type WorkGroupDisclosures = ReadonlyMap<string, WorkGroupDisclosure>;

export function workGroupIsExpanded(disclosure: WorkGroupDisclosure | undefined): boolean {
  return disclosure === "opening" || disclosure === "open";
}

/** Groups restored from a remembered list are already open, so none animates. */
export function restingWorkGroupDisclosures(
  expandedGroupIds: ReadonlySet<string> | undefined,
): WorkGroupDisclosures {
  return new Map(Array.from(expandedGroupIds ?? [], (groupId) => [groupId, "open"]));
}

export function expandedWorkGroupIds(disclosures: WorkGroupDisclosures): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const [groupId, disclosure] of disclosures) {
    if (workGroupIsExpanded(disclosure)) expanded.add(groupId);
  }
  return expanded;
}

export function toggledWorkGroupTransition(
  disclosure: WorkGroupDisclosure | undefined,
): WorkGroupTransition {
  return workGroupIsExpanded(disclosure) ? "closing" : "opening";
}

export function startWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
): WorkGroupDisclosures {
  return new Map(disclosures).set(groupId, transition);
}

/** Ends a transition only while it is still the group's current one, so a later toggle wins. */
export function settleWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
): WorkGroupDisclosures {
  if (disclosures.get(groupId) !== transition) return disclosures;
  const next = new Map(disclosures);
  if (transition === "opening") next.set(groupId, "open");
  else next.delete(groupId);
  return next;
}
