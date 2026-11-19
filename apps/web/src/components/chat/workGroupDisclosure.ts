export const WORK_GROUP_OPEN_MS = 200;
export const WORK_GROUP_CLOSE_MS = 150;

/**
 * An expanded tool group's rows: sliding open, at rest, or sliding shut before
 * they leave the list. A collapsed group has no disclosure.
 */
export type WorkGroupDisclosure = "opening" | "open" | "closing";
export type WorkGroupTransition = Exclude<WorkGroupDisclosure, "open">;
export type WorkGroupDisclosures = ReadonlyMap<string, WorkGroupDisclosure>;

export function workGroupIsExpanded(disclosure: WorkGroupDisclosure | undefined) {
  return disclosure === "opening" || disclosure === "open";
}

export function restoredWorkGroupDisclosures(
  expandedGroupIds: ReadonlySet<string> | undefined,
): WorkGroupDisclosures;
export function restoredWorkGroupDisclosures(expandedGroupIds: ReadonlySet<string> | undefined) {
  return new Map(
    Array.from(expandedGroupIds ?? [], (groupId) => [groupId, "open"]),
  ) satisfies WorkGroupDisclosures;
}

export function expandedWorkGroupIds(disclosures: WorkGroupDisclosures) {
  const expanded = new Set<string>();
  for (const [groupId, disclosure] of disclosures) {
    if (workGroupIsExpanded(disclosure)) expanded.add(groupId);
  }
  return expanded;
}

export function nextWorkGroupTransition(disclosure: WorkGroupDisclosure | undefined) {
  return workGroupIsExpanded(disclosure) ? "closing" : "opening";
}

export function startWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
): WorkGroupDisclosures;
export function startWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
) {
  return new Map(disclosures).set(groupId, transition) satisfies WorkGroupDisclosures;
}

export function settleWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
): WorkGroupDisclosures;
export function settleWorkGroupTransition(
  disclosures: WorkGroupDisclosures,
  groupId: string,
  transition: WorkGroupTransition,
) {
  if (disclosures.get(groupId) !== transition) return disclosures satisfies WorkGroupDisclosures;
  const next = new Map(disclosures);
  if (transition === "opening") next.set(groupId, "open");
  else next.delete(groupId);
  return next satisfies WorkGroupDisclosures;
}
